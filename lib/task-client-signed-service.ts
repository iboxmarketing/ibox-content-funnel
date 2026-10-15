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
  TaskBackendChangeRequests,
  TaskBackendDeadlineRequest,
  TaskBackendDetails,
  TaskBackendReassignRequest,
  TaskBackendStatus,
  TaskBackendTask,
  TaskBackendUser,
  TaskClient,
} from "./task-client-types";

export { AmbiguousTransitionError, TaskBackendHttpError, TaskBackendServiceAuthConfigError, TaskBackendSignerInputError };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * TaskClient wired to marketing-team-task-bot's real, sanctioned server-to-
 * server auth protocol (docs/CONTENT_OS_SERVICE_AUTH.md on that side) --
 * the replacement for HttpTaskClient's cookie-impersonation AUTH_GAP
 * demonstration. Reuses the same TaskClient interface and the same
 * route/payload/response mapping (task-backend-wire-mapping.ts) as
 * HttpTaskClient; only the auth headers differ.
 *
 * The team-task server route constructs this through the fail-closed factory
 * below only after validating the Content OS Telegram session.
 *
 * Every request is signed fresh (signTaskBackendRequest), so the secret
 * itself never leaves this process -- only the resulting headers are sent.
 */
export class SignedServiceTaskClient implements TaskClient {
  constructor(
    private readonly config: TaskBackendServiceAuthConfig,
    /** Current public.users.id from the validated Content OS session. */
    private readonly externalSubject: string,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(method: string, path: string, bodyText = ""): Promise<unknown> {
    const signingPath = new URL(path, "https://task-backend.internal").pathname;
    const signedHeaders = signTaskBackendRequest(
      { method, path: signingPath, bodyText, externalSubject: this.externalSubject },
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

  async listTasks(scope: "my" | "all" | "archived" = "all"): Promise<readonly TaskBackendTask[]> {
    const body = await this.request("GET", `/api/tasks?scope=${encodeURIComponent(scope)}`);
    return ((body as { tasks: Record<string, unknown>[] }).tasks ?? []).map(mapBotTask);
  }

  async getDetails(taskId: string): Promise<TaskBackendDetails> {
    const body = await this.request("GET", `/api/tasks/${encodeURIComponent(taskId)}`) as Record<string, unknown>;
    return { ...body, task: mapBotTask(body.task as Record<string, unknown>) } as TaskBackendDetails;
  }

  async listUsers(): Promise<readonly TaskBackendUser[]> {
    const body = await this.request("GET", "/api/users");
    return (body as { users: TaskBackendUser[] }).users ?? [];
  }

  async listChangeRequests(status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"): Promise<TaskBackendChangeRequests> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return await this.request("GET", `/api/requests${suffix}`) as TaskBackendChangeRequests;
  }

  async editTask(taskId: string, input: { title: string; description: string | null; priority: "high" | "normal" | "low" }): Promise<TaskBackendTask> {
    const body = await this.request("PATCH", `/api/tasks/${encodeURIComponent(taskId)}`, JSON.stringify(input));
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async directReassign(taskId: string, assigneeId: string): Promise<TaskBackendTask> {
    const body = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/reassign`, JSON.stringify({ assigneeId }));
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async directDeadline(taskId: string, deadline: string): Promise<TaskBackendTask> {
    const body = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/deadline`, JSON.stringify({ deadline }));
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async requestReassign(taskId: string, requestedAssigneeId: string, reason: string): Promise<TaskBackendReassignRequest> {
    const body = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/reassign-requests`, JSON.stringify({ requestedAssigneeId, reason }));
    return (body as { reassignRequest: TaskBackendReassignRequest }).reassignRequest;
  }

  async requestDeadline(taskId: string, requestedDeadline: string, reason: string): Promise<TaskBackendDeadlineRequest> {
    const body = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/deadline-requests`, JSON.stringify({ requestedDeadline, reason }));
    return (body as { deadlineRequest: TaskBackendDeadlineRequest }).deadlineRequest;
  }

  async resolveReassign(requestId: string, approve: boolean, resolutionNote?: string): Promise<TaskBackendReassignRequest> {
    const body = await this.request("POST", `/api/reassign-requests/${encodeURIComponent(requestId)}/resolve`, JSON.stringify({ approve, ...(resolutionNote ? { resolutionNote } : {}) }));
    return (body as { reassignRequest: TaskBackendReassignRequest }).reassignRequest;
  }

  async resolveDeadline(requestId: string, approve: boolean, resolutionNote?: string): Promise<TaskBackendDeadlineRequest> {
    const body = await this.request("POST", `/api/deadline-requests/${encodeURIComponent(requestId)}/resolve`, JSON.stringify({ approve, ...(resolutionNote ? { resolutionNote } : {}) }));
    return (body as { deadlineRequest: TaskBackendDeadlineRequest }).deadlineRequest;
  }

  async archive(taskId: string, reason?: string): Promise<void> {
    await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/archive`, JSON.stringify(reason ? { reason } : {}));
  }

  async restore(taskId: string): Promise<TaskBackendTask> {
    const body = await this.request("POST", `/api/tasks/${encodeURIComponent(taskId)}/restore`, "{}");
    return mapBotTask((body as { task: Record<string, unknown> }).task);
  }

  async action(
    taskId: string,
    action: "ACCEPT" | "BLOCK" | "RESUME" | "SUBMIT_REVIEW" | "APPROVE" | "REQUEST_REVISION" | "CANCEL" | "REOPEN",
    reason?: string,
  ): Promise<TaskBackendTask> {
    return this.performAction(taskId, action, reason);
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
 * ever scheduled.
 */
export function getSignedServiceTaskClient(
  env: EnvLike,
  externalSubject: string | null | undefined,
  fetchImpl?: FetchLike,
): SignedServiceTaskClient {
  const config = resolveTaskBackendServiceAuthConfig(env);
  if (!config) {
    throw new TaskBackendServiceAuthConfigError("Task backend service auth is disabled or not configured.");
  }
  if (!externalSubject) {
    throw new TaskBackendSignerInputError("A current Telegram-session actor id is required to use the task-backend service client.");
  }
  return new SignedServiceTaskClient(config, externalSubject, fetchImpl);
}
