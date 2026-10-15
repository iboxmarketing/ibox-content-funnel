import { z } from "zod";
import { PostgrestClient, type FetchLike } from "@/lib/persistence/supabase-adapter";
import type { ContentOsAuthConfig } from "./config";

export const ContentOsRoleSchema = z.enum([
  "HEAD_OF_MARKETING",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
  "SEO_SPECIALIST",
  "OPERATOR_VIDEO_EDITOR",
]);

export type ContentOsRole = z.infer<typeof ContentOsRoleSchema>;

export interface AuthenticatedUser {
  readonly id: string;
  readonly displayName: string;
  readonly role: ContentOsRole;
  readonly sessionId: string;
  readonly sessionExpiresAt: string;
}

const ChallengeStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "CONSUMED",
  "CANCELLED",
  "EXPIRED",
  "UNAVAILABLE",
]);

export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

/**
 * Task Bot Sprint 10D contract (Codex): the create RPC takes a server-derived
 * rate-key hash, returns a 6-digit `display_code` that the bot also shows, and
 * refuses abuse with SQLSTATE PT429 (HTTP 429). A row without a display code
 * means the contract is not deployed; Content OS then refuses to start a login.
 */
const ChallengeRowSchema = z.object({
  challenge_id: z.string().uuid(),
  status: z.literal("PENDING"),
  expires_at: z.string().datetime({ offset: true }),
  display_code: z.string().regex(/^\d{6}$/).nullable().optional(),
});

const ChallengeStatusRowSchema = z.object({
  status: ChallengeStatusSchema,
  expires_at: z.string().datetime({ offset: true }).nullable(),
});

const SessionResultSchema = z.object({
  status: z.string(),
  session_id: z.string().uuid().nullable(),
  authenticated_user_id: z.string().uuid().nullable(),
  display_name: z.string().nullable(),
  role: ContentOsRoleSchema.nullable(),
  expires_at: z.string().datetime({ offset: true }).nullable(),
});

function one<T>(schema: z.ZodType<T>, value: unknown): T {
  const rows = z.array(schema).length(1).parse(value);
  return rows[0];
}

function authenticatedUser(value: z.infer<typeof SessionResultSchema>): AuthenticatedUser | null {
  if (value.status !== "VALID" && value.status !== "REDEEMED") return null;
  if (!value.session_id || !value.authenticated_user_id || !value.display_name || !value.role || !value.expires_at) {
    throw new Error("Authentication RPC returned an incomplete successful result.");
  }
  return {
    id: value.authenticated_user_id,
    displayName: value.display_name,
    role: value.role,
    sessionId: value.session_id,
    sessionExpiresAt: value.expires_at,
  };
}

export class ContentOsAuthRepository {
  private readonly db: PostgrestClient;

  constructor(config: ContentOsAuthConfig, fetch: FetchLike) {
    this.db = new PostgrestClient({
      baseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      fetch,
    });
  }

  async createChallenge(verifierHash: string, rateKeyHash: string) {
    return one(ChallengeRowSchema, await this.db.rpc("content_os_auth_create_challenge", {
      p_verifier_hash: verifierHash,
      p_rate_key_hash: rateKeyHash,
    }));
  }

  async getChallengeStatus(challengeId: string): Promise<{
    readonly status: ChallengeStatus;
    readonly expiresAt: string | null;
  }> {
    const row = one(ChallengeStatusRowSchema, await this.db.rpc("content_os_auth_get_challenge_status", {
      p_challenge_id: challengeId,
    }));
    return { status: row.status, expiresAt: row.expires_at };
  }

  async redeemChallenge(input: {
    readonly challengeId: string;
    readonly verifierHash: string;
    readonly sessionTokenHash: string;
  }): Promise<{ readonly status: string; readonly user: AuthenticatedUser | null }> {
    const row = one(SessionResultSchema, await this.db.rpc("content_os_auth_redeem_challenge", {
      p_challenge_id: input.challengeId,
      p_verifier_hash: input.verifierHash,
      p_session_token_hash: input.sessionTokenHash,
    }));
    return { status: row.status, user: authenticatedUser(row) };
  }

  async validateSession(sessionTokenHash: string): Promise<AuthenticatedUser | null> {
    const row = one(SessionResultSchema, await this.db.rpc("content_os_auth_validate_session", {
      p_session_token_hash: sessionTokenHash,
    }));
    return authenticatedUser(row);
  }

  async revokeSession(sessionTokenHash: string): Promise<boolean> {
    return z.boolean().parse(await this.db.rpc("content_os_auth_revoke_session", {
      p_session_token_hash: sessionTokenHash,
    }));
  }
}
