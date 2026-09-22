/**
 * Shared vocabulary for the data-source abstraction (Sheets today, Supabase
 * later). Nothing here assumes a Supabase table/column name -- those arrive
 * with the Codex-owned schema handoff.
 */

export type DataSourceMode = "SHEETS_ONLY" | "DUAL_READ" | "SUPABASE_READ" | "SUPABASE_WRITE";

export type RepositorySourceLabel = "SHEETS" | "SUPABASE";

export interface RepositoryReadResult<T> {
  readonly source: RepositorySourceLabel;
  readonly data: T;
}

export class DataSourceConfigurationError extends Error {
  readonly code = "DATA_SOURCE_CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DataSourceConfigurationError";
  }
}

/**
 * Thrown by a Supabase repository whenever its schema contract is not marked
 * READY. This is the "fail-fast diagnostic" required before any Supabase
 * table is queried -- no guessed query ever runs.
 */
export class SchemaContractNotReadyError extends Error {
  readonly code = "SCHEMA_CONTRACT_NOT_READY";
  readonly entity: string;
  constructor(entity: string, reason: string) {
    super(`Supabase schema contract for "${entity}" is not ready: ${reason}`);
    this.name = "SchemaContractNotReadyError";
    this.entity = entity;
  }
}

export class SheetsNotConfiguredError extends Error {
  readonly code = "SHEETS_NOT_CONFIGURED";
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Google Sheets is not configured. Missing: ${missing.join(", ")}`);
    this.name = "SheetsNotConfiguredError";
    this.missing = missing;
  }
}
