import { DataSourceConfigurationError } from "./data-source-types";
import type { DataSourceMode } from "./data-source-types";

export type EnvLike = Record<string, string | undefined>;

const READABLE_MODES: readonly DataSourceMode[] = ["SHEETS_ONLY", "DUAL_READ", "SUPABASE_READ"];
const DEFAULT_MODE: DataSourceMode = "SHEETS_ONLY";

/**
 * Pure resolver for the DATA_SOURCE feature flag. Kept free of any runtime
 * import (no "cloudflare:workers", no Supabase client) so it is directly
 * unit-testable and so the default (unset env -> SHEETS_ONLY) can never be
 * accidentally coupled to a runtime that isn't available in every context.
 *
 * SUPABASE_WRITE is recognized but always rejected here: production writes
 * stay blocked until the task-backend/Supabase write path is explicitly
 * approved, so an operator who sets it gets a clear, immediate error instead
 * of a silent downgrade to a different mode.
 */
export function resolveDataSourceMode(env: EnvLike): DataSourceMode {
  const raw = env.DATA_SOURCE?.trim();
  if (!raw) return DEFAULT_MODE;

  const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_") as DataSourceMode;

  if (normalized === "SUPABASE_WRITE") {
    throw new DataSourceConfigurationError(
      'DATA_SOURCE="SUPABASE_WRITE" is not enabled yet. Production Supabase writes remain blocked until the schema contract and task-backend integration are approved.',
    );
  }

  if (!READABLE_MODES.includes(normalized)) {
    throw new DataSourceConfigurationError(
      `DATA_SOURCE="${raw}" is not recognized. Valid values: ${[...READABLE_MODES, "SUPABASE_WRITE"].join(", ")}.`,
    );
  }

  return normalized;
}

export function isReadOnlyMode(mode: DataSourceMode): boolean {
  return mode !== "SUPABASE_WRITE";
}
