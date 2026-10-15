/**
 * Resolves the signed-in platform user (the SIWC `oai-authenticated-user-id`
 * subject) to a real, ACTIVE public.users actor. The subject is never used
 * as a public.users.id. The mapping is owned by the Task Bot track
 * (external_identity_links); Content OS only reads it.
 */
import type { PostgrestClient } from "./supabase-adapter";

export const SIWC_PROVIDER = "OPENAI_SIWC" as const;

export class ActorNotLinkedError extends Error {
  readonly code = "EXTERNAL_IDENTITY_NOT_LINKED";
  constructor(message = "No active linked public.users actor exists for this signed-in user.") {
    super(message);
    this.name = "ActorNotLinkedError";
  }
}

export interface ExternalActorResolver {
  /** The linked, active public.users.id — or throws ActorNotLinkedError. */
  resolve(externalSubject: string): Promise<string>;
}

/** Default: identity linking is not enabled, so nobody resolves. */
export class FailClosedActorResolver implements ExternalActorResolver {
  async resolve(): Promise<string> {
    throw new ActorNotLinkedError("external identity linking is not enabled for Content OS");
  }
}

/** Reads one ACTIVE link for (OPENAI_SIWC, tenant, subject) and requires users.is_active. */
export class SupabaseExternalActorResolver implements ExternalActorResolver {
  constructor(private readonly db: PostgrestClient, private readonly tenantKey: string) {}

  async resolve(externalSubject: string): Promise<string> {
    if (!externalSubject.trim()) throw new ActorNotLinkedError();
    const links = await this.db.select("external_identity_links", "user_id", {
      provider: `eq.${SIWC_PROVIDER}`,
      tenant_key: `eq.${this.tenantKey}`,
      external_subject: `eq.${externalSubject}`,
      status: "eq.ACTIVE",
    });
    if (links.length !== 1) throw new ActorNotLinkedError();
    const userId = links[0].user_id as string;
    const [user] = await this.db.select("users", "id,is_active", { id: `eq.${userId}` });
    if (!user || user.is_active !== true) throw new ActorNotLinkedError("the linked public.users actor is not active");
    return userId;
  }
}
