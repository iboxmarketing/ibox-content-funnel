import { SchemaContractNotReadyError, SheetsNotConfiguredError } from "./data-source-types";
import type { DataSourceMode } from "./data-source-types";
import type { SheetsRepository } from "./data-source-sheets-repository";
import type { SupabaseRepository } from "./data-source-supabase-repository";

/**
 * Mode-branching orchestration shared by the three read API routes
 * (knowledge / production / catalog-preview). Pure: takes already-constructed
 * repositories, so it has no "cloudflare:workers" dependency and is fully
 * unit-testable with fake repositories. The real (Workers-bound) wiring that
 * constructs the actual repositories lives in lib/data-source.ts.
 */
export type RouteDataOutcome<T> =
  | { readonly kind: "NOT_CONFIGURED"; readonly missing: string[] }
  | {
      readonly kind: "OK";
      readonly data: T;
      readonly dataSourceDiagnostic?: { readonly supabaseAvailable: boolean; readonly reason?: string };
    }
  | { readonly kind: "SCHEMA_NOT_READY"; readonly message: string };

export async function loadForRoute<T>(
  mode: DataSourceMode,
  sheetsRepo: SheetsRepository<T>,
  supabaseRepo: SupabaseRepository<T>,
  force: boolean,
): Promise<RouteDataOutcome<T>> {
  if (mode === "SUPABASE_READ") {
    try {
      const result = await supabaseRepo.read(force);
      return { kind: "OK", data: result.data };
    } catch (error) {
      if (error instanceof SchemaContractNotReadyError) {
        return { kind: "SCHEMA_NOT_READY", message: error.message };
      }
      throw error;
    }
  }

  // SHEETS_ONLY and DUAL_READ both use the Sheet as the primary/authoritative read.
  let sheetsResult;
  try {
    sheetsResult = await sheetsRepo.read(force);
  } catch (error) {
    if (error instanceof SheetsNotConfiguredError) {
      return { kind: "NOT_CONFIGURED", missing: error.missing };
    }
    throw error;
  }

  if (mode !== "DUAL_READ") {
    return { kind: "OK", data: sheetsResult.data };
  }

  try {
    await supabaseRepo.read(force);
    return { kind: "OK", data: sheetsResult.data, dataSourceDiagnostic: { supabaseAvailable: true } };
  } catch (error) {
    if (error instanceof SchemaContractNotReadyError) {
      return {
        kind: "OK",
        data: sheetsResult.data,
        dataSourceDiagnostic: { supabaseAvailable: false, reason: error.message },
      };
    }
    throw error;
  }
}
