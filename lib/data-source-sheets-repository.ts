import { SheetsNotConfiguredError, type RepositoryReadResult } from "./data-source-types";

/**
 * Generic wrapper around one of the existing lib/google-sheets.ts load
 * functions (loadKnowledgeGraph / loadProductionDataset / loadCatalogPreview).
 * Deliberately takes those functions as dependencies instead of importing
 * google-sheets.ts itself, so this class stays free of the
 * "cloudflare:workers" runtime import and is unit-testable with a fake
 * loader under plain `node --test`, exactly like the rest of lib/*.ts.
 *
 * The real (Workers-bound) wiring lives in lib/data-source.ts.
 */
export interface SheetsRepositoryDeps<T> {
  readonly load: (force?: boolean) => Promise<T>;
  readonly getMissingConfiguration: () => string[];
}

export class SheetsRepository<T> {
  constructor(private readonly deps: SheetsRepositoryDeps<T>) {}

  /** Same contract as lib/google-sheets.ts#getMissingGoogleConfiguration. */
  getMissingConfiguration(): string[] {
    return this.deps.getMissingConfiguration();
  }

  /** Throws SheetsNotConfiguredError instead of attempting a doomed fetch. */
  async read(force = false): Promise<RepositoryReadResult<T>> {
    const missing = this.deps.getMissingConfiguration();
    if (missing.length) {
      throw new SheetsNotConfiguredError(missing);
    }
    const data = await this.deps.load(force);
    return { source: "SHEETS", data };
  }
}
