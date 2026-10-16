/**
 * Server-side task capability policy for the Content OS team-task API
 * (Sprint 10D owner decisions). Pure: no env, no network.
 *
 * - MANUAL tasks keep the approved Sprint 10B rules (Head / creator direct
 *   management, assignee change requests, generic lifecycle).
 * - CONTENT OS WORKFLOW tasks (a content_task_runtime row exists) get NO
 *   creator rights and NO generic lifecycle: Blog / Head Review state moves
 *   only through BlogReviewFlow. Head keeps operational edit / reassign /
 *   deadline management, but never in a way that makes a Blog's author its
 *   own reviewer (or a reviewer the author of the Blog they review).
 *
 * The Task Bot remains the authority (Codex enforces the same decisions in the
 * database). This module decides what Content OS presents and what it is
 * willing to forward; it is computed from authoritative task state and
 * persisted workflow provenance, never from titles or client claims.
 */
import type { TaskBackendStatus, TaskBackendTask } from "./task-client-types";

export type TeamRole =
  | "HEAD_OF_MARKETING"
  | "CONTENT_MARKETER"
  | "DIGITAL_MARKETER"
  | "SMM_MANAGER"
  | "SEO_SPECIALIST"
  | "OPERATOR_VIDEO_EDITOR";

export interface PolicyActor {
  readonly id: string;
  readonly role: TeamRole;
}

/** From content_task_runtime (pinned Task Type code + lineage); absent row = MANUAL. */
export type TaskClassification =
  | { readonly kind: "MANUAL" }
  | {
    readonly kind: "CONTENT_OS";
    readonly code: string;
    /** HEAD_REVIEW: its source Blog task. */
    readonly sourceTaskId: string | null;
    /** The Blog's current assignee: the Blog itself (BLOG) or the reviewed Blog (HEAD_REVIEW). */
    readonly blogAuthorId: string | null;
    /** HEAD_REVIEW: status of the reviewed Blog. */
    readonly sourceStatus: TaskBackendStatus | null;
    /** BLOG: assignee of its Head Review, if one exists. */
    readonly reviewerId: string | null;
  };

export type LifecycleAction = "ACCEPT" | "BLOCK" | "RESUME" | "SUBMIT_REVIEW" | "APPROVE" | "REQUEST_REVISION" | "CANCEL" | "REOPEN";
export type WorkflowAction = "COMPLETE_BLOG" | "REVIEW_APPROVE" | "REVIEW_REQUEST_REVISION";

export interface TaskCapabilities {
  readonly classification: TaskClassification;
  readonly canEdit: boolean;
  readonly canDirectReassign: boolean;
  readonly canDirectDeadline: boolean;
  readonly canRequestChange: boolean;
  readonly lifecycleActions: readonly LifecycleAction[];
  readonly canArchive: boolean;
  readonly canRestore: boolean;
  /** Users who may never be made this task's assignee (workflow independence). */
  readonly forbiddenAssigneeIds: readonly string[];
  /** Content OS workflow actions (BlogReviewFlow API), never generic lifecycle. */
  readonly workflowActions: readonly WorkflowAction[];
}

export class TaskPolicyError extends Error {
  constructor(readonly status: 403 | 409, readonly code: string, message: string) {
    super(message);
    this.name = "TaskPolicyError";
  }
}

const TERMINAL: readonly TaskBackendStatus[] = ["DONE", "CANCELLED"];
const isHead = (actor: PolicyActor) => actor.role === "HEAD_OF_MARKETING";
const open = (task: TaskBackendTask) => !TERMINAL.includes(task.status);

function manualLifecycle(actor: PolicyActor, task: TaskBackendTask): LifecycleAction[] {
  const actions: LifecycleAction[] = [];
  const assignee = actor.id === task.assigneeId;
  const manager = isHead(actor) || actor.id === task.creatorId;
  if (assignee) {
    if (task.status === "ASSIGNED") actions.push("ACCEPT");
    if (task.status === "IN_PROGRESS") actions.push("BLOCK", "SUBMIT_REVIEW");
    if (task.status === "BLOCKED" || task.status === "REVISION") actions.push("RESUME");
  }
  if (manager && task.status === "REVIEW") actions.push("APPROVE", "REQUEST_REVISION");
  if (manager && open(task)) actions.push("CANCEL");
  if (isHead(actor) && task.status === "CANCELLED") actions.push("REOPEN");
  return actions;
}

function forbiddenAssignees(classification: TaskClassification): string[] {
  if (classification.kind !== "CONTENT_OS") return [];
  if (classification.code === "HEAD_REVIEW") return classification.blogAuthorId ? [classification.blogAuthorId] : [];
  if (classification.code === "BLOG") return classification.reviewerId ? [classification.reviewerId] : [];
  return [];
}

function workflowActions(actor: PolicyActor, task: TaskBackendTask, classification: TaskClassification, workflowApiEnabled: boolean): WorkflowAction[] {
  if (!workflowApiEnabled || classification.kind !== "CONTENT_OS") return [];
  if (classification.code === "BLOG") {
    return actor.id === task.assigneeId && (task.status === "IN_PROGRESS" || task.status === "REVISION") ? ["COMPLETE_BLOG"] : [];
  }
  if (classification.code === "HEAD_REVIEW") {
    // Head Review independence: the reviewed Blog's author never decides it, Head included.
    if (classification.blogAuthorId === actor.id || classification.sourceStatus !== "DONE") return [];
    const actions: WorkflowAction[] = [];
    const reviewer = actor.id === task.assigneeId;
    if (reviewer && ["ASSIGNED", "IN_PROGRESS", "REVIEW"].includes(task.status)) actions.push("REVIEW_APPROVE");
    // The reviewer may send back from ASSIGNED (picking it up) or IN_PROGRESS; a supervising
    // non-author Head only once the reviewer has picked it up (IN_PROGRESS) — Task Bot 10E rule.
    if ((reviewer && ["ASSIGNED", "IN_PROGRESS"].includes(task.status)) || (isHead(actor) && task.status === "IN_PROGRESS")) {
      actions.push("REVIEW_REQUEST_REVISION");
    }
    return actions;
  }
  return [];
}

export function computeTaskCapabilities(
  actor: PolicyActor,
  task: TaskBackendTask,
  archived: boolean,
  classification: TaskClassification,
  options: { readonly workflowApiEnabled: boolean } = { workflowApiEnabled: false },
): TaskCapabilities {
  const workflow = classification.kind === "CONTENT_OS";
  // Workflow tasks: Head only (no creator rights). Manual tasks: Head or creator (Sprint 10B).
  const manager = isHead(actor) || (!workflow && actor.id === task.creatorId);
  const canEdit = !archived && manager && open(task);
  return {
    classification,
    canEdit,
    canDirectReassign: canEdit,
    canDirectDeadline: canEdit,
    canRequestChange: !archived && open(task) && actor.id === task.assigneeId && actor.id !== task.creatorId && !isHead(actor),
    lifecycleActions: archived || workflow ? [] : manualLifecycle(actor, task),
    canArchive: isHead(actor) && !archived,
    canRestore: isHead(actor) && archived,
    forbiddenAssigneeIds: forbiddenAssignees(classification),
    workflowActions: archived ? [] : workflowActions(actor, task, classification, options.workflowApiEnabled),
  };
}

export type PolicyMutation =
  | { readonly action: "edit" }
  | { readonly action: "lifecycle"; readonly taskAction: LifecycleAction }
  | { readonly action: "direct-reassign"; readonly assigneeId: string }
  | { readonly action: "direct-deadline" }
  | { readonly action: "request-reassign"; readonly requestedAssigneeId: string }
  | { readonly action: "request-deadline" }
  | { readonly action: "approve-reassign"; readonly requestedAssigneeId: string }
  | { readonly action: "archive" }
  | { readonly action: "restore" };

const deny = (message: string) => { throw new TaskPolicyError(403, "FORBIDDEN", message); };
const conflict = (code: string, message: string) => { throw new TaskPolicyError(409, code, message); };

/** Throws TaskPolicyError unless Content OS may forward this mutation. */
export function assertTaskMutationAllowed(capabilities: TaskCapabilities, mutation: PolicyMutation): void {
  const workflow = capabilities.classification.kind === "CONTENT_OS";
  const independent = (assigneeId: string) => {
    if (capabilities.forbiddenAssigneeIds.includes(assigneeId)) {
      conflict("WORKFLOW_INDEPENDENCE", "A Blog's author cannot review it, and its reviewer cannot write it.");
    }
  };
  switch (mutation.action) {
    case "lifecycle":
      if (workflow) conflict("WORKFLOW_TASK", "Content OS workflow tasks change state only through the Blog review workflow.");
      if (!capabilities.lifecycleActions.includes(mutation.taskAction)) deny("This action is not available to you for this task.");
      return;
    case "edit":
    case "direct-deadline":
      if (!capabilities.canEdit) deny(workflow ? "Only Head manages Content OS workflow tasks directly." : "Only the task creator or Head may change this task directly.");
      return;
    case "direct-reassign":
      if (!capabilities.canDirectReassign) deny(workflow ? "Only Head manages Content OS workflow tasks directly." : "Only the task creator or Head may reassign this task directly.");
      independent(mutation.assigneeId);
      return;
    case "request-reassign":
      if (!capabilities.canRequestChange) deny("Only the task's assignee may request a change.");
      independent(mutation.requestedAssigneeId);
      return;
    case "request-deadline":
      if (!capabilities.canRequestChange) deny("Only the task's assignee may request a change.");
      return;
    case "approve-reassign":
      independent(mutation.requestedAssigneeId);
      return;
    case "archive":
      if (!capabilities.canArchive) deny("Only Head may archive an active task.");
      return;
    case "restore":
      if (!capabilities.canRestore) deny("Only Head may restore an archived task.");
      return;
  }
}
