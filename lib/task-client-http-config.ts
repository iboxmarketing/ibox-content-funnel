/**
 * Configuration for a real HTTP TaskClient against marketing-team-task-bot.
 *
 * AUTH_GAP (see the wire-contract audit): that bot has no service-account or
 * API-key login path. Its only session mint route (`POST /api/auth/telegram`)
 * requires real Telegram `initData`, which a non-Telegram web app cannot
 * produce. `sessionCookie` therefore has no automated, legitimate source
 * today -- it can only be a value a human copies out-of-band from their own
 * already-authenticated bot session (`marketing_session` cookie), and it
 * expires after 12h (that repo's `SESSION_MAX_AGE_SECONDS`). This is not a
 * service-account credential; it impersonates one specific human.
 *
 * Nothing here defaults to a real base URL, so unless both env vars are
 * explicitly set, `resolveTaskBackendHttpConfig` returns null and no HTTP
 * TaskClient can be constructed from it.
 */
export type EnvLike = Record<string, string | undefined>;

export interface TaskBackendHttpConfig {
  readonly baseUrl: string;
  readonly sessionCookie: string;
}

export class TaskBackendHttpConfigError extends Error {
  readonly code = "TASK_BACKEND_HTTP_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "TaskBackendHttpConfigError";
  }
}

/**
 * Pure resolver. Returns null (not a throw) when unset, since "not
 * configured" is this codebase's normal, default state today -- callers
 * decide whether that is acceptable (it is, everywhere in production code
 * right now: nothing calls this except tests and the never-defaulted
 * HttpTaskClient construction path).
 */
export function resolveTaskBackendHttpConfig(env: EnvLike): TaskBackendHttpConfig | null {
  const baseUrl = env.TASK_BACKEND_BASE_URL?.trim();
  const sessionCookie = env.TASK_BACKEND_SESSION_COOKIE?.trim();

  if (!baseUrl && !sessionCookie) return null;
  if (!baseUrl || !sessionCookie) {
    throw new TaskBackendHttpConfigError(
      "TASK_BACKEND_BASE_URL and TASK_BACKEND_SESSION_COOKIE must both be set, or both left unset.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TaskBackendHttpConfigError(`TASK_BACKEND_BASE_URL="${baseUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new TaskBackendHttpConfigError("TASK_BACKEND_BASE_URL must be https:// outside local development.");
  }

  return { baseUrl, sessionCookie };
}
