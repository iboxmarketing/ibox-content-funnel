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
  /**
   * Optional stable ref back into Content OS (e.g. a TPI-* package item).
   * Only meaningful once a bridge column exists on the task-backend side --
   * that column does not exist yet, so a real implementation may return
   * `null` for every task until it does.
   */
  readonly contentRef: string | null;
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
