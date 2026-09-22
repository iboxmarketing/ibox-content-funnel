import { signTaskBackendRequest, TaskBackendSignerInputError } from "./content-os-task-backend-signer";
import {
  ACTION_FOR_UNAMBIGUOUS_STATUS,
  AMBIGUOUS_TRANSITION_MESSAGE,
  AmbiguousTransitionError,
  TaskBackendHttpError,
  mapBotTask,
  parseTaskBackendResponse,
} from "./task-backend-wire-mapping";
import { resolveTaskBackendServiceAuthConfig, TaskBackendServiceAuthConfigError } from "./task-backend-service-auth-config";
import type { EnvLike, TaskBackendServiceAuthConfig } from "./task-backend-service-auth-config";
import type {
  CreateTaskBackendTaskInput,
  DeadlineChangeRequestInput,
  TaskBackendStatus,
  TaskBackendTask,
  TaskClient,
} from "./task-client-types";

export { AmbiguousTransitionError, TaskBackendHttpError, TaskBackendServiceAuthConfigError, TaskBackendSignerInputError };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * TaskClient wired to marketing-team-task-bot's real, sanctioned server-to-
 * server auth protocol (docs/CONTENT_OS_SERVICE_AUTH.md on that side) --
 * the replacement for HttpTaskClient's cookie-impersonation AUTH_GAP
 * demonstration. Reuses the same TaskClient interface and the same
 * route/payload/response mapping (task-backend-wire-mapping.ts) as
 * HttpTaskClient; only the auth headers differ.
 *
 * Not the default TaskClient anywhere in this codebase -- task-client.ts's
 * getTaskClient() still always returns BlockedTaskClient, and nothing in
 * app/ constructs this class. See getSignedServiceTaskClient() below for
 * the fail-closed factory that is the only sanctioned way to obtain one,
 * and note it still has no production call site.
 *
 * Every request is signed fresh (signTaskBackendRequest), so the secret
 * itself never leaves this process -- only the resulting headers are sent.
 */
export class SignedServiceTaskClient implements TaskClient {
  constructor(
    private readonly config: TaskBackendServiceAuthConfig,
    /** The current SIWC external subject -- caller-supplied, never invented
     * or derived here. See docs/CONTENT_OS_SERVICE_AUTH.md's actor
     * resolution section on the bot side: this is not a public.users.id. */
    private readonly externalSubject: string,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(method: string, path: string, bodyText = ""): Promise<unknown> {
    const signedHeaders = signTaskBackendRequest(
      { method, path, bodyText, externalSubject: this.externalSubject },
      this.config.secret,
      this.now,
    );
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        ...(bodyText ? { "content-type": "application/json" } : {}),
        ...signedHeaders,
      },
      ...(bodyText ? { body: bodyText } : {}),
    });
    return parseTaskBackendResponse(response);
  }

  async create(input: CreateTaskBackendTaskInput): Promise<TaskBackendTask> {
    // marketing-team-task-bot's CreateTaskInputSchema is `.strict()` -- an
    // unknown `contentRef` field would be REJECTED (400 INVALID_INPUT), not
    // ignored. Dropped here rather than sent, until a bridge column exists.
    const bodyText = JSON.stringify({
      title: input.title,
      assigneeId: input.assigneeId,
      deadline: input.deadline,
      priority: input.priority,
      ...(input.description ? { description: input.description } : {}),
    });
    const body = await this.request("POST", "/api/tasks", bodyText);
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async read(taskId: string): Promise<TaskBackendTask | null> {
    try {
      const body = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
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
    await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(input.taskId)}/deadline-requests`,
      JSON.stringify({ requestedDeadline: input.requestedDeadline, reason: input.reason }),
    );
  }

  async submitForReview(taskId: string): Promise<TaskBackendTask> {
    return this.performAction(taskId, "SUBMIT_REVIEW");
  }

  async requestRevision(taskId: string, _actorId: string, reason: string): Promise<TaskBackendTask> {
    return this.performAction(taskId, "REQUEST_REVISION", reason);
  }

  private async performAction(taskId: string, action: string, reason?: string): Promise<TaskBackendTask> {
    const body = await this.request(
      "POST",
      `/api/tasks/${encodeURIComponent(taskId)}/actions`,
      JSON.stringify({ action, ...(reason ? { reason } : {}) }),
    );
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }
}

/**
 * The only sanctioned way to obtain a SignedServiceTaskClient. Fails closed
 * BEFORE any network attempt: no config (disabled/unset -- the default) or
 * no externalSubject both throw immediately, synchronously, with no fetch
 * ever scheduled. There is no production call site for this today.
 */
export function getSignedServiceTaskClient(
  env: EnvLike,
  externalSubject: string | null | undefined,
): SignedServiceTaskClient {
  const config = resolveTaskBackendServiceAuthConfig(env);
  if (!config) {
    throw new TaskBackendServiceAuthConfigError("Task backend service auth is disabled or not configured.");
  }
  if (!externalSubject) {
    throw new TaskBackendSignerInputError("A current SIWC external subject is required to use the task-backend service client.");
  }
  return new SignedServiceTaskClient(config, externalSubject);
}
