/**
 * Placeholder for the Supabase schema contract that the Codex-owned
 * migration/audit track will hand off (content_* tables, stable-ref columns,
 * grants, RLS). Until a contract is marked READY, every Supabase repository
 * fails fast instead of guessing a table or column name.
 *
 * Nothing in this file names a real Supabase table or column. `entity` is a
 * label chosen by this codebase (e.g. "KnowledgeGraph"), not a table name.
 */
export interface SupabaseSchemaContract {
  readonly status: "PENDING_CODEX_HANDOFF" | "READY";
  readonly entity: string;
  readonly notes: string;
}

export function pendingSchemaContract(entity: string): SupabaseSchemaContract {
  return {
    status: "PENDING_CODEX_HANDOFF",
    entity,
    notes:
      "Waiting for the Codex-owned Supabase content_* schema handoff. No table or column name is assumed by this codebase yet.",
  };
}

/** Marks a contract READY. Only ever called from tests today -- there is no
 * production call site until Codex hands off a real schema. */
export function readySchemaContract(entity: string, notes: string): SupabaseSchemaContract {
  return { status: "READY", entity, notes };
}

export function isSchemaContractReady(contract: SupabaseSchemaContract): boolean {
  return contract.status === "READY";
}
