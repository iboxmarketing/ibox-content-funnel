/**
 * Composition root for Content OS persistence. FAIL-CLOSED by default, like
 * lib/task-client.ts: `getContentOsPersistence()` reads no environment and
 * returns adapters whose every call throws PersistenceNotConfiguredError, so
 * nothing in the running app can reach Supabase until a later sprint wires
 * an explicit, reviewed configuration through `createSupabaseContentOsPersistence`.
 */
import { PersistenceNotConfiguredError, type ContentOsStore, type OperationalTaskGateway } from "./ports";
import { PostgrestClient, SupabaseContentOsStore, SupabaseOperationalTaskGateway, type PostgrestConfig } from "./supabase-adapter";

export interface ContentOsPersistence {
  readonly store: ContentOsStore;
  readonly tasks: OperationalTaskGateway;
}

function blocked<T extends object>(): T {
  return new Proxy({} as T, {
    get: () => async () => {
      throw new PersistenceNotConfiguredError();
    },
  });
}

export function getContentOsPersistence(): ContentOsPersistence {
  return { store: blocked<ContentOsStore>(), tasks: blocked<OperationalTaskGateway>() };
}

/** Explicit construction only (server-side, reviewed config). Not called anywhere yet. */
export function createSupabaseContentOsPersistence(config: PostgrestConfig): ContentOsPersistence {
  const db = new PostgrestClient(config);
  return { store: new SupabaseContentOsStore(db), tasks: new SupabaseOperationalTaskGateway(db) };
}
