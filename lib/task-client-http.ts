import type { TaskBackendHttpConfig } from "./task-client-http-config";
import type {
  CreateTaskBackendTaskInput,
  DeadlineChangeRequestInput,
  TaskBackendStatus,
  TaskBackendTask,
  TaskClient,
} from "./task-client-types";

/**
 * TaskClient wired to marketing-team-task-bot's real, read-only-audited HTTP
 * contract (routes/payloads/responses below are taken directly from that
 * repo's own `src/app/api/**` and `src/domain/*` source, not guessed).
 *
 * This class is never constructed by the default `getTaskClient()` factory
 * in task-client.ts -- that stays BlockedTaskClient. It exists so the wire
 * mapping is written down and tested (against a fake HTTP server, never a
 * real host) ahead of the still-open AUTH_GAP: the task-bot has no
 * service-account login, so every method here still requires a human's
 * short-lived session cookie supplied out-of-band (see
 * task-client-http-config.ts). Nothing in this codebase passes such a
 * cookie in, so this class has no real call site today.
 *
 * Two contract gaps discovered while wiring this (documented, not silently
 * papered over):
 *
 * 1. No actor-override parameter exists on any mutating endpoint -- the
 *    acting user is 100% derived from the session cookie. This class's
 *    `accept`/`transition`/`submitForReview`/`requestRevision`/
 *    `requestDeadlineChange` methods accept an `actorId` (per the TaskClient
 *    interface) but cannot honor it: whoever the configured session belongs
 *    to is who acts, always. Passing a different `actorId` does not
 *    impersonate them.
 * 2. `transition(..., "IN_PROGRESS", ...)` is genuinely ambiguous: the bot's
 *    action verb for reaching IN_PROGRESS is ACCEPT from ASSIGNED but RESUME
 *    from BLOCKED/REVISION, and the TaskClient interface does not carry the
 *    task's current status to disambiguate. This throws
 *    AmbiguousTransitionError rather than guessing; callers that know the
 *    current status should call `accept()` directly or extend this method.
 */
export class TaskBackendHttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
  ) {
    super(message);
    this.name = "TaskBackendHttpError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export class AmbiguousTransitionError extends Error {
  readonly code = "AMBIGUOUS_TRANSITION";
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousTransitionError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Reverse of marketing-team-task-bot's src/domain/workflow.ts TARGET_STATUS.
// IN_PROGRESS is deliberately absent -- see the class doc comment.
const ACTION_FOR_UNAMBIGUOUS_STATUS: Partial<Record<TaskBackendStatus, string>> = {
  BLOCKED: "BLOCK",
  REVIEW: "SUBMIT_REVIEW",
  DONE: "APPROVE",
  REVISION: "REQUEST_REVISION",
  CANCELLED: "CANCEL",
  ASSIGNED: "REOPEN",
};

function mapBotTask(raw: Record<string, unknown>): TaskBackendTask {
  return {
    id: String(raw.id),
    title: String(raw.title),
    description: (raw.description as string | null) ?? null,
    priority: raw.priority as TaskBackendTask["priority"],
    status: raw.status as TaskBackendStatus,
    assigneeId: String(raw.assigneeId),
    creatorId: String(raw.creatorId),
    deadline: String(raw.deadline),
    // Not part of marketing-team-task-bot's TaskSchema today -- no bridge
    // column exists yet, so this is always null, never guessed from raw data.
    contentRef: null,
  };
}

export class HttpTaskClient implements TaskClient {
  constructor(
    private readonly config: TaskBackendHttpConfig,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        cookie: `marketing_session=${this.config.sessionCookie}`,
        ...init.headers,
      },
    });

    const text = await response.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      throw new TaskBackendHttpError(
        response.status,
        typeof body.code === "string" ? body.code : "UNKNOWN_ERROR",
        typeof body.error === "string" ? body.error : `Request failed with status ${response.status}.`,
        body.issues as TaskBackendHttpError["issues"],
      );
    }
    return body;
  }

  async create(input: CreateTaskBackendTaskInput): Promise<TaskBackendTask> {
    // marketing-team-task-bot's CreateTaskInputSchema is `.strict()` -- an
    // unknown `contentRef` field would be REJECTED (400 INVALID_INPUT), not
    // ignored. Dropped here rather than sent, until a bridge column exists.
    const body = await this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        assigneeId: input.assigneeId,
        deadline: input.deadline,
        priority: input.priority,
        ...(input.description ? { description: input.description } : {}),
      }),
    });
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async read(taskId: string): Promise<TaskBackendTask | null> {
    try {
      const body = await this.request(`/api/tasks/${encodeURIComponent(taskId)}`);
      return mapBotTask((body as { task: Record<string, unknown> }).task);
    } catch (error) {
      if (error instanceof TaskBackendHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async accept(taskId: string): Promise<TaskBackendTask> {
    return this.performAction(taskId, "ACCEPT");
  }

  async transition(taskId: string, _actorId: string, newStatus: TaskBackendStatus, reason?: string): Promise<TaskBackendTask> {
    const action = ACTION_FOR_UNAMBIGUOUS_STATUS[newStatus];
    if (!action) {
      throw new AmbiguousTransitionError(
        `Cannot determine a single task-bot action for target status "${newStatus}" without the task's current status ` +
          '(IN_PROGRESS is reached by ACCEPT from ASSIGNED or RESUME from BLOCKED/REVISION). Call accept() directly, or extend this method with the current status.',
      );
    }
    return this.performAction(taskId, action, reason);
  }

  async requestDeadlineChange(input: DeadlineChangeRequestInput): Promise<void> {
    // Response includes the created deadlineRequest, but the TaskClient
    // interface's return type is void today -- not surfaced yet.
    await this.request(`/api/tasks/${encodeURIComponent(input.taskId)}/deadline-requests`, {
      method: "POST",
      body: JSON.stringify({ requestedDeadline: input.requestedDeadline, reason: input.reason }),
    });
  }

  async submitForReview(taskId: string): Promise<TaskBackendTask> {
    return this.performAction(taskId, "SUBMIT_REVIEW");
  }

  async requestRevision(taskId: string, _actorId: string, reason: string): Promise<TaskBackendTask> {
    return this.performAction(taskId, "REQUEST_REVISION", reason);
  }

  private async performAction(taskId: string, action: string, reason?: string): Promise<TaskBackendTask> {
    const body = await this.request(`/api/tasks/${encodeURIComponent(taskId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
    });
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }
}
