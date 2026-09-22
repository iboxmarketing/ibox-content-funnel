import "server-only";
import { env } from "cloudflare:workers";
import {
  getMissingGoogleConfiguration,
  loadCatalogPreview,
  loadKnowledgeGraph,
  loadProductionDataset,
} from "./google-sheets";
import { resolveDataSourceMode } from "./data-source-config";
import { SheetsRepository } from "./data-source-sheets-repository";
import { SupabaseRepository } from "./data-source-supabase-repository";
import type { DataSourceMode } from "./data-source-types";
import type { KnowledgeGraph } from "./knowledge-types";
import type { ProductionDataset } from "./production-types";
import type { CatalogPreview } from "./catalog-adapter";

/**
 * Real (Workers-bound) wiring for the data-source abstraction. This is the
 * only module in the abstraction that imports lib/google-sheets.ts (and
 * therefore "cloudflare:workers"), which is why it is not covered by the
 * plain `node --test` suite -- exactly like the API route handlers that used
 * to import lib/google-sheets.ts directly. All branching logic it delegates
 * to (data-source-route-outcome.ts) is pure and is unit-tested.
 */
export function getDataSourceMode(): DataSourceMode {
  return resolveDataSourceMode(env as unknown as Record<string, string | undefined>);
}

export function getKnowledgeRepository(): SheetsRepository<KnowledgeGraph> {
  return new SheetsRepository<KnowledgeGraph>({
    load: loadKnowledgeGraph,
    getMissingConfiguration: getMissingGoogleConfiguration,
  });
}

export function getSupabaseKnowledgeRepository(): SupabaseRepository<KnowledgeGraph> {
  return new SupabaseRepository<KnowledgeGraph>("KnowledgeGraph");
}

export function getContentPlanningRepository(): SheetsRepository<ProductionDataset> {
  return new SheetsRepository<ProductionDataset>({
    load: loadProductionDataset,
    getMissingConfiguration: getMissingGoogleConfiguration,
  });
}

export function getSupabaseContentPlanningRepository(): SupabaseRepository<ProductionDataset> {
  return new SupabaseRepository<ProductionDataset>("ProductionDataset");
}

export function getCatalogRepository(): SheetsRepository<CatalogPreview> {
  return new SheetsRepository<CatalogPreview>({
    load: loadCatalogPreview,
    getMissingConfiguration: getMissingGoogleConfiguration,
  });
}

export function getSupabaseCatalogRepository(): SupabaseRepository<CatalogPreview> {
  return new SupabaseRepository<CatalogPreview>("CatalogPreview");
}
