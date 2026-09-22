import { SchemaContractNotReadyError } from "./data-source-types";
import type { RepositoryReadResult } from "./data-source-types";
import {
  isSchemaContractReady,
  pendingSchemaContract,
  type SupabaseSchemaContract,
} from "./data-source-supabase-schema-contract";

/**
 * Generic Supabase repository stub. It never queries a table: every call
 * checks the schema contract first and throws SchemaContractNotReadyError
 * when it is not READY, which is true for every entity today. This is the
 * "safe stub" requested for prep work -- it lets the DATA_SOURCE=supabase /
 * DUAL_READ code paths exist and be tested without a single guessed table
 * or column name anywhere in this codebase.
 *
 * When Codex hands off the real schema, the concrete read (a Supabase
 * client query) gets added here behind `contract.status === "READY"`; the
 * fail-fast branch and its error type do not change.
 */
export class SupabaseRepository<T> {
  private readonly contract: SupabaseSchemaContract;

  constructor(
    private readonly entityName: string,
    contract: SupabaseSchemaContract = pendingSchemaContract(entityName),
  ) {
    this.contract = contract;
  }

  getSchemaContract(): SupabaseSchemaContract {
    return this.contract;
  }

  /** `force` kept for interface parity with SheetsRepository.read(); unused until a real query exists. */
  async read(force = false): Promise<RepositoryReadResult<T>> {
    void force;
    if (!isSchemaContractReady(this.contract)) {
      throw new SchemaContractNotReadyError(this.entityName, this.contract.notes);
    }
    // Unreachable until a real contract + query implementation lands.
    throw new SchemaContractNotReadyError(this.entityName, "no query implementation exists yet");
  }
}
