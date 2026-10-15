/**
 * Pure resolver for the Content OS persistence configuration (same pattern
 * as lib/data-source-config.ts): takes an env-like object, reads nothing
 * itself, imports no runtime. Disabled unless CONTENT_OS_PERSISTENCE_ENABLED
 * is exactly "true"; a partial configuration throws instead of silently
 * half-working. Server-only values: none of these may ever be NEXT_PUBLIC_*.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ContentOsPersistenceConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  /** SIWC tenant the external_identity_links rows belong to (contract §S9). */
  readonly identityTenantKey: string;
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
  identityTenantKey: "CONTENT_OS_IDENTITY_TENANT_KEY",
} as const;

export function resolveContentOsPersistenceConfig(env: EnvLike): ContentOsPersistenceConfig | null {
  const raw = env[CONTENT_OS_PERSISTENCE_ENV.enabled]?.trim().toLowerCase();
  if (!raw || raw === "false") return null;
  if (raw !== "true") {
    throw new ContentOsPersistenceConfigError(`${CONTENT_OS_PERSISTENCE_ENV.enabled}="${env[CONTENT_OS_PERSISTENCE_ENV.enabled]}" is not recognized. Use "true" or "false".`);
  }
  const supabaseUrl = env[CONTENT_OS_PERSISTENCE_ENV.supabaseUrl]?.trim();
  const serviceRoleKey = env[CONTENT_OS_PERSISTENCE_ENV.serviceRoleKey]?.trim();
  const identityTenantKey = env[CONTENT_OS_PERSISTENCE_ENV.identityTenantKey]?.trim();
  const missing = [
    !supabaseUrl && CONTENT_OS_PERSISTENCE_ENV.supabaseUrl,
    !serviceRoleKey && CONTENT_OS_PERSISTENCE_ENV.serviceRoleKey,
    !identityTenantKey && CONTENT_OS_PERSISTENCE_ENV.identityTenantKey,
  ].filter(Boolean);
  if (missing.length) throw new ContentOsPersistenceConfigError(`Content OS persistence is enabled but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing.`);
  if (!/^https:\/\//.test(supabaseUrl as string)) throw new ContentOsPersistenceConfigError(`${CONTENT_OS_PERSISTENCE_ENV.supabaseUrl} must be an https:// URL.`);
  return { supabaseUrl: supabaseUrl as string, serviceRoleKey: serviceRoleKey as string, identityTenantKey: identityTenantKey as string };
}
