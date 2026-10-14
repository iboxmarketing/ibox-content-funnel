/**
 * The Content OS transition contract in TypeScript. Each function mirrors,
 * clause for clause, a SQL predicate in draft migration
 * 20261014130000_content_os_06_transition_contract.sql (the database copy is
 * what the Task Bot enforces; this copy lets Content OS check before it
 * asks, and lets tests use the in-memory adapter). Stable codes and ids
 * only — no titles, no display names.
 */
import type { ContentOsStore, OperationalTaskGateway } from "./ports";
import type { OperationalActor, OperationalTask, TaskLinkRecord, TaskRuntimeRecord, TaskTypeVersionRecord, WorkflowStepRecord } from "./records";
import { BLOG_TASK_TYPE_CODE, HEAD_REVIEW_TASK_TYPE_CODE, type TaskTypeCode } from "./task-type-codes";

/**
 * content_os_requires_review: the pinned workflow step's
 * `overrides.reviewRequired` when present and a boolean, the pinned Task
 * Type version's `review_required` when absent or JSON null, and TRUE for
 * anything malformed (fail safe: the task must go through REVIEW).
 * Same precedence as lib/workflow-template.ts effectiveReviewRequired
 * (`step.overrides?.reviewRequired ?? taskType.reviewRequired`).
 */
export function requiresReview(pinnedVersion: Pick<TaskTypeVersionRecord, "reviewRequired">, pinnedStep: Pick<WorkflowStepRecord, "overrides"> | null): boolean {
  const overrides = pinnedStep?.overrides;
  if (overrides === null || overrides === undefined) return pinnedVersion.reviewRequired;
  if (typeof overrides !== "object" || Array.isArray(overrides)) return true;
  if (!Object.prototype.hasOwnProperty.call(overrides, "reviewRequired")) return pinnedVersion.reviewRequired;
  const value = (overrides as Record<string, unknown>).reviewRequired;
  if (value === null) return pinnedVersion.reviewRequired;
  if (typeof value === "boolean") return value;
  return true;
}

/** Everything the predicates need about one Content OS task. */
export interface ContentOsTaskFacts {
  readonly task: OperationalTask;
  readonly runtime: TaskRuntimeRecord;
  readonly code: TaskTypeCode;
  readonly requiresReview: boolean;
  readonly primaryLink: TaskLinkRecord | null;
}

export async function loadContentOsTaskFacts(taskId: string, store: ContentOsStore, tasks: OperationalTaskGateway): Promise<ContentOsTaskFacts | null> {
  const [task, runtime] = await Promise.all([tasks.getTask(taskId), store.getRuntime(taskId)]);
  if (!task || !runtime) return null;
  const version = await store.getTaskTypeVersion(runtime.taskTypeVersionId);
  if (!version) return null;
  const step = runtime.workflowStepId ? await store.getWorkflowStep(runtime.workflowStepId) : null;
  const primaryLink = (await store.linksForTask(taskId)).find((link) => link.relation === "PRIMARY") ?? null;
  return { task, runtime, code: version.code, requiresReview: requiresReview(version, step), primaryLink };
}

/** content_os_is_source_blog_for_head_review */
export function isSourceBlogForHeadReview(target: ContentOsTaskFacts, review: ContentOsTaskFacts): boolean {
  return (
    review.code === HEAD_REVIEW_TASK_TYPE_CODE &&
    target.code === BLOG_TASK_TYPE_CODE &&
    review.runtime.sourceTaskId === target.task.id &&
    target.primaryLink?.entityType === "BLOG" &&
    review.primaryLink?.entityType === "BLOG" &&
    review.primaryLink.entityId === target.primaryLink.entityId
  );
}

/** content_os_revision_allowed */
export function revisionAllowed(target: ContentOsTaskFacts, review: ContentOsTaskFacts, actor: OperationalActor | null): boolean {
  return (
    isSourceBlogForHeadReview(target, review) &&
    target.task.status === "DONE" &&
    review.task.status === "IN_PROGRESS" &&
    actor !== null &&
    actor.isActive &&
    (review.task.assigneeId === actor.id || actor.role === "HEAD_OF_MARKETING")
  );
}

/** content_os_completion_allowed: a Head Review completes only while its source Blog is DONE. */
export function completionAllowed(task: ContentOsTaskFacts, sourceBlog: ContentOsTaskFacts | null): boolean {
  if (task.code !== HEAD_REVIEW_TASK_TYPE_CODE) return true;
  return sourceBlog !== null && sourceBlog.task.status === "DONE" && isSourceBlogForHeadReview(sourceBlog, task);
}

/**
 * The Task Bot transition rule for Content OS tasks once Codex applies the
 * contract (legacy matrix for every task, plus three Content OS-only
 * transitions). Used by the in-memory gateway to simulate the target
 * behavior; the authoritative copy is the Task Bot's
 * transition_task_with_events.
 */
export const LEGACY_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "REVIEW", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED"],
  REVIEW: ["DONE", "REVISION", "CANCELLED"],
  REVISION: ["IN_PROGRESS", "BLOCKED", "REVIEW", "CANCELLED"],
  DONE: ["ASSIGNED"],
  CANCELLED: ["ASSIGNED"],
};
