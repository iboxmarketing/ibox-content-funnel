import type { TaskBackendStatus, TaskBackendTask } from "./task-client-types";

/**
 * Wire-mapping pieces shared by every TaskClient implementation that talks
 * to marketing-team-task-bot's real HTTP contract, regardless of how a
 * given implementation authenticates (cookie impersonation in
 * task-client-http.ts, or the signed service-auth protocol in
 * task-client-signed-service.ts). Extracted so neither implementation
 * duplicates the bot's response shape or status/action mapping -- both
 * import from here instead.
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

export const AMBIGUOUS_TRANSITION_MESSAGE =
  'Cannot determine a single task-bot action for target status "IN_PROGRESS" without the task\'s current status ' +
  '(IN_PROGRESS is reached by ACCEPT from ASSIGNED or RESUME from BLOCKED/REVISION). Call accept() directly, or extend this method with the current status.';

// Reverse of marketing-team-task-bot's src/domain/workflow.ts TARGET_STATUS.
// IN_PROGRESS is deliberately absent -- see AMBIGUOUS_TRANSITION_MESSAGE.
export const ACTION_FOR_UNAMBIGUOUS_STATUS: Partial<Record<TaskBackendStatus, string>> = {
  BLOCKED: "BLOCK",
  REVIEW: "SUBMIT_REVIEW",
  DONE: "APPROVE",
  REVISION: "REQUEST_REVISION",
  CANCELLED: "CANCEL",
  ASSIGNED: "REOPEN",
};

export function mapBotTask(raw: Record<string, unknown>): TaskBackendTask {
  return {
    id: String(raw.id),
    title: String(raw.title),
    description: (raw.description as string | null) ?? null,
    priority: raw.priority as TaskBackendTask["priority"],
    status: raw.status as TaskBackendStatus,
    assigneeId: String(raw.assigneeId),
    creatorId: String(raw.creatorId),
    deadline: String(raw.deadline),
    blockedReason: typeof raw.blockedReason === "string" ? raw.blockedReason : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    cancelledAt: typeof raw.cancelledAt === "string" ? raw.cancelledAt : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    // Not part of marketing-team-task-bot's TaskSchema today -- no bridge
    // column exists yet, so this is always null, never guessed from raw data.
    contentRef: null,
  };
}

/** Parses a task-bot HTTP response into either its JSON body or a thrown
 * TaskBackendHttpError, shared by every transport (fetch headers differ
 * between cookie and signed-service auth; response parsing does not). */
export async function parseTaskBackendResponse(response: Response): Promise<unknown> {
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
