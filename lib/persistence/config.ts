/**
 * Pure resolver for the Content OS persistence configuration (same pattern
 * as lib/data-source-config.ts): takes an env-like object, reads nothing
 * itself, imports no runtime. Disabled unless CONTENT_OS_PERSISTENCE_ENABLED
 * is exactly "true"; a partial configuration throws instead of silently
 * half-working. Server-only values: none of these may ever be NEXT_PUBLIC_*.
 *
 * Authentication is handled separately by the Telegram-backed web-session
 * boundary. The persistence layer receives only the already-validated
 * public.users.id; it does not accept external identity assertions.
 */
import { assertSupabaseTarget, DeploymentTargetError } from "../deployment-target";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ContentOsPersistenceConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
}

export class ContentOsPersistenceConfigError extends Error {
  readonly code = "CONTENT_OS_PERSISTENCE_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ContentOsPersistenceConfigError";
  }
}

export const CONTENT_OS_PERSISTENCE_ENV = {
  enabled: "CONTENT_OS_PERSISTENCE_ENABLED",
  supabaseUrl: "CONTENT_OS_SUPABASE_URL",
  serviceRoleKey: "CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY",
} as const;

export function resolveContentOsPersistenceConfig(env: EnvLike): ContentOsPersistenceConfig | null {
  const raw = env[CONTENT_OS_PERSISTENCE_ENV.enabled]?.trim().toLowerCase();
  if (!raw || raw === "false") return null;
  if (raw !== "true") {
    throw new ContentOsPersistenceConfigError(`${CONTENT_OS_PERSISTENCE_ENV.enabled}="${env[CONTENT_OS_PERSISTENCE_ENV.enabled]}" is not recognized. Use "true" or "false".`);
  }
  const supabaseUrl = env[CONTENT_OS_PERSISTENCE_ENV.supabaseUrl]?.trim();
  const serviceRoleKey = env[CONTENT_OS_PERSISTENCE_ENV.serviceRoleKey]?.trim();
  const missing = [
    !supabaseUrl && CONTENT_OS_PERSISTENCE_ENV.supabaseUrl,
    !serviceRoleKey && CONTENT_OS_PERSISTENCE_ENV.serviceRoleKey,
  ].filter(Boolean);
  if (missing.length) throw new ContentOsPersistenceConfigError(`Content OS persistence is enabled but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing.`);
  if (!/^https:\/\//.test(supabaseUrl as string)) throw new ContentOsPersistenceConfigError(`${CONTENT_OS_PERSISTENCE_ENV.supabaseUrl} must be an https:// URL.`);
  try {
    assertSupabaseTarget(env, supabaseUrl as string);
  } catch (error) {
    if (error instanceof DeploymentTargetError) throw new ContentOsPersistenceConfigError(error.message);
    throw error;
  }
  return { supabaseUrl: supabaseUrl as string, serviceRoleKey: serviceRoleKey as string };
}
