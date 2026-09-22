import type { TaskBackendHttpConfig } from "./task-client-http-config";
import {
  ACTION_FOR_UNAMBIGUOUS_STATUS,
  AMBIGUOUS_TRANSITION_MESSAGE,
  AmbiguousTransitionError,
  TaskBackendHttpError,
  mapBotTask,
  parseTaskBackendResponse,
} from "./task-backend-wire-mapping";
import type {
  CreateTaskBackendTaskInput,
  DeadlineChangeRequestInput,
  TaskBackendStatus,
  TaskBackendTask,
  TaskClient,
} from "./task-client-types";

export { AmbiguousTransitionError, TaskBackendHttpError };

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
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
    return parseTaskBackendResponse(response);
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
      throw new AmbiguousTransitionError(AMBIGUOUS_TRANSITION_MESSAGE);
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
