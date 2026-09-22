/**
 * Configuration for the signed server-to-server task-backend auth path
 * (docs: marketing-team-task-bot's docs/CONTENT_OS_SERVICE_AUTH.md).
 * Distinct from task-client-http-config.ts's cookie-impersonation config --
 * this is the real, sanctioned protocol; that one only exists to document
 * the AUTH_GAP it replaces.
 *
 * Defaults to disabled. Pure resolver: no import of "server-only" (so it
 * stays testable under this repo's plain-Node test harness), no network,
 * no default base URL -- returns null (not configured/disabled, the normal
 * state today) or throws (a genuinely broken partial configuration), never
 * silently constructs a half-valid config.
 */
export type EnvLike = Record<string, string | undefined>;

export interface TaskBackendServiceAuthConfig {
  readonly baseUrl: string;
  readonly secret: string;
}

export class TaskBackendServiceAuthConfigError extends Error {
  readonly code = "TASK_BACKEND_SERVICE_AUTH_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "TaskBackendServiceAuthConfigError";
  }
}

export function resolveTaskBackendServiceAuthConfig(env: EnvLike): TaskBackendServiceAuthConfig | null {
  const raw = env.TASK_BACKEND_SERVICE_AUTH_ENABLED?.trim().toLowerCase();
  if (!raw || raw === "false") return null;
  if (raw !== "true") {
    throw new TaskBackendServiceAuthConfigError(
      `TASK_BACKEND_SERVICE_AUTH_ENABLED="${env.TASK_BACKEND_SERVICE_AUTH_ENABLED}" is not recognized. Use "true" or "false".`,
    );
  }

  const baseUrl = env.TASK_BACKEND_BASE_URL?.trim();
  const secret = env.CONTENT_OS_TASK_BACKEND_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new TaskBackendServiceAuthConfigError(
      "TASK_BACKEND_SERVICE_AUTH_ENABLED=true requires both TASK_BACKEND_BASE_URL and CONTENT_OS_TASK_BACKEND_SECRET to be set.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TaskBackendServiceAuthConfigError(`TASK_BACKEND_BASE_URL="${baseUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new TaskBackendServiceAuthConfigError("TASK_BACKEND_BASE_URL must be https:// outside local development.");
  }

  return { baseUrl, secret };
}
