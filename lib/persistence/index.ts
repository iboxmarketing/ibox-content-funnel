/**
 * Composition root for Content OS persistence. FAIL-CLOSED by default, like
 * lib/task-client.ts: `getContentOsPersistence()` reads no environment and
 * returns adapters whose every call throws PersistenceNotConfiguredError, so
 * nothing in the running app can reach Supabase until a later sprint wires
 * an explicit, reviewed configuration through `createSupabaseContentOsPersistence`.
 */
import { PersistenceNotConfiguredError, type ContentOsStore, type OperationalTaskGateway } from "./ports";
import { PostgrestClient, SupabaseContentOsStore, SupabaseOperationalTaskGateway, type FetchLike, type PostgrestConfig } from "./supabase-adapter";
import { SupabaseExternalActorResolver } from "./actor-resolver";
import { BlogReviewFlow } from "./blog-review-flow";
import type { BlogReviewDependencies } from "./blog-review-api";
import type { ContentOsPersistenceConfig } from "./config";

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

/**
 * Server-side dependencies for the persisted Blog review slice, from an
 * explicit resolved config (lib/persistence/config.ts). null = fail closed.
 */
export function createBlogReviewDependencies(config: ContentOsPersistenceConfig | null, fetch: FetchLike): BlogReviewDependencies | null {
  if (!config) return null;
  const db = new PostgrestClient({ baseUrl: config.supabaseUrl, serviceRoleKey: config.serviceRoleKey, fetch });
  return {
    flow: new BlogReviewFlow(new SupabaseContentOsStore(db), new SupabaseOperationalTaskGateway(db)),
    actors: new SupabaseExternalActorResolver(db, config.identityTenantKey),
  };
}
