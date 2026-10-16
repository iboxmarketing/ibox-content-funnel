/**
 * Deployment-target guard (pure; Sprint 11B). Binds a Worker deployment to
 * exactly one Supabase project so a staging Worker can never silently talk to
 * another project (production included), whatever is stored in its secrets.
 *
 * - CONTENT_OS_DEPLOYMENT_ENV: optional, "staging" | "production".
 * - CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF: the one allowed project ref.
 *   REQUIRED when CONTENT_OS_DEPLOYMENT_ENV is set. When present, the
 *   configured Supabase URL must be exactly `https://<ref>.supabase.co`.
 *
 * Both are plain, non-secret vars declared per environment in wrangler.jsonc.
 * Any mismatch throws, and the callers turn that into a fail-closed 503.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export class DeploymentTargetError extends Error {
  readonly code = "CONTENT_OS_DEPLOYMENT_TARGET_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DeploymentTargetError";
  }
}

const PROJECT_REF = /^[a-z0-9]{20}$/;

export function assertSupabaseTarget(env: EnvLike, supabaseUrl: string): void {
  const deployment = env.CONTENT_OS_DEPLOYMENT_ENV?.trim();
  const expected = env.CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF?.trim();
  if (deployment && deployment !== "staging" && deployment !== "production") {
    throw new DeploymentTargetError(`CONTENT_OS_DEPLOYMENT_ENV="${deployment}" is not recognized.`);
  }
  if (deployment && !expected) {
    throw new DeploymentTargetError(`CONTENT_OS_DEPLOYMENT_ENV=${deployment} requires CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF.`);
  }
  if (!expected) return;
  if (!PROJECT_REF.test(expected)) throw new DeploymentTargetError("CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF is not a Supabase project ref.");
  let origin: string;
  try {
    origin = new URL(supabaseUrl).origin;
  } catch {
    throw new DeploymentTargetError("The configured Supabase URL is not a valid URL.");
  }
  if (origin !== `https://${expected}.supabase.co`) {
    // Never echo the configured URL: the message reaches logs.
    throw new DeploymentTargetError("The configured Supabase URL does not belong to the expected project for this deployment.");
  }
}
