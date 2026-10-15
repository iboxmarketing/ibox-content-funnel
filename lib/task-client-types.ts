/**
 * Contract for the future client that lets Content OS create/read/transition
 * tasks against the *existing* marketing-team-task-bot backend -- Content OS
 * never mints its own task storage or its own task id.
 *
 * TaskBackendStatus mirrors that repository's own committed
 * `public.tasks.status` CHECK constraint (ASSIGNED / IN_PROGRESS / BLOCKED /
 * REVIEW / REVISION / DONE / CANCELLED), read directly from its migrations
 * during the earlier read-only audit -- it is not a guess. Nothing else here
 * is assumed: no endpoint URL, no request/response wire shape, no auth
 * header. Those arrive with the live integration contract from the task
 * backend's own team (Codex track), and only then does a concrete
 * implementation of this interface get written.
 */
export type TaskBackendStatus = "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "REVISION" | "DONE" | "CANCELLED";

export type TaskBackendPriority = "high" | "normal" | "low";

export interface TaskBackendTask {
  /** marketing-team-task-bot public.tasks.id (uuid). */
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: TaskBackendPriority;
  readonly status: TaskBackendStatus;
  readonly assigneeId: string;
  readonly creatorId: string;
  readonly deadline: string;
  readonly blockedReason: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Optional stable ref back into Content OS (e.g. a TPI-* package item).
   * Only meaningful once a bridge column exists on the task-backend side --
   * that column does not exist yet, so a real implementation may return
   * `null` for every task until it does.
   */
  readonly contentRef: string | null;
}

export interface TaskBackendUser {
  readonly id: string;
  readonly telegramUsername: string | null;
  readonly displayName: string;
  readonly role: "HEAD_OF_MARKETING" | "CONTENT_MARKETER" | "DIGITAL_MARKETER" | "SMM_MANAGER" | "SEO_SPECIALIST" | "OPERATOR_VIDEO_EDITOR";
  readonly isActive: boolean;
  readonly deactivatedAt: string | null;
}

export interface TaskBackendEvent {
  readonly id: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly eventType: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export type TaskBackendRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface TaskBackendDeadlineRequest {
  readonly id: string;
  readonly taskId: string;
  readonly requestedBy: string;
  readonly currentDeadline: string;
  readonly requestedDeadline: string;
  readonly reason: string;
  readonly status: TaskBackendRequestStatus;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskBackendReassignRequest {
  readonly id: string;
  readonly taskId: string;
  readonly requestedBy: string;
  readonly currentAssigneeId: string;
  readonly requestedAssigneeId: string;
  readonly reason: string;
  readonly status: TaskBackendRequestStatus;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskBackendArchive {
  readonly taskId: string;
  readonly archivedAt: string;
  readonly archivedBy: string;
  readonly reason: string | null;
}

export interface TaskBackendDetails {
  readonly task: TaskBackendTask;
  readonly archive: TaskBackendArchive | null;
  readonly events: readonly TaskBackendEvent[];
  readonly deadlineRequests: readonly TaskBackendDeadlineRequest[];
  readonly reassignRequests: readonly TaskBackendReassignRequest[];
}

export interface TaskBackendChangeRequests {
  readonly deadlineRequests: readonly TaskBackendDeadlineRequest[];
  readonly reassignRequests: readonly TaskBackendReassignRequest[];
}

export interface CreateTaskBackendTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly priority: TaskBackendPriority;
  readonly assigneeId: string;
  readonly creatorId: string;
  readonly deadline: string;
  readonly contentRef?: string;
}

export interface DeadlineChangeRequestInput {
  readonly taskId: string;
  readonly requestedBy: string;
  readonly requestedDeadline: string;
  readonly reason: string;
}

export class TaskBackendNotConfiguredError extends Error {
  readonly code = "TASK_BACKEND_SETUP_REQUIRED";
  constructor(message = "Task backend integration is not configured yet.") {
    super(message);
    this.name = "TaskBackendNotConfiguredError";
  }
}

export interface TaskClient {
  create(input: CreateTaskBackendTaskInput): Promise<TaskBackendTask>;
  read(taskId: string): Promise<TaskBackendTask | null>;
  accept(taskId: string, actorId: string): Promise<TaskBackendTask>;
  transition(taskId: string, actorId: string, newStatus: TaskBackendStatus, reason?: string): Promise<TaskBackendTask>;
  requestDeadlineChange(input: DeadlineChangeRequestInput): Promise<void>;
  submitForReview(taskId: string, actorId: string): Promise<TaskBackendTask>;
  requestRevision(taskId: string, actorId: string, reason: string): Promise<TaskBackendTask>;
}
