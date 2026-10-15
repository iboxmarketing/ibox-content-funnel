/**
 * Public login start (pure; Sprint 10D). Order: edge rate limit on a
 * server-derived key -> Task Bot challenge -> matching-code contract check.
 *
 * - The rate key is derived ONLY from Cloudflare's own `CF-Connecting-IP`
 *   request header (set by the Cloudflare edge; a client value is replaced),
 *   hashed before use. Nothing the browser sends selects the bucket.
 * - The short confirmation code is for the human to compare browser and
 *   Telegram; it is NOT a secret and never redeems anything. Redemption still
 *   needs the challenge id, the browser-held verifier, the Telegram-
 *   authenticated approval, and one-time consumption.
 */
import { sha256Hex } from "./crypto";

export interface EdgeRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface ChallengeCreator {
  createChallenge(verifierHash: string, rateKeyHash: string): Promise<{
    readonly challenge_id: string;
    readonly status: "PENDING";
    readonly expires_at: string;
    readonly display_code?: string | null;
  }>;
}

export const LOGIN_RETRY_AFTER_SECONDS = 60;

export type LoginStartResult =
  | { readonly kind: "STARTED"; readonly challengeId: string; readonly expiresAt: string; readonly confirmationCode: string; readonly telegramDeepLink: string }
  | { readonly kind: "RATE_LIMITED"; readonly retryAfterSeconds: number }
  | { readonly kind: "CONFIRMATION_UNAVAILABLE" };

/** SHA-256 hex of Cloudflare's CF-Connecting-IP — the only input to both rate limits. */
export async function loginRateKeyHash(headers: Headers): Promise<string> {
  return sha256Hex(headers.get("cf-connecting-ip") ?? "unknown");
}

/** The Task Bot answers abuse with SQLSTATE PT429 (PostgREST: HTTP 429). */
function isRateLimitRefusal(error: unknown): boolean {
  const e = error as { pgCode?: string | null; status?: number } | null;
  return e?.pgCode === "PT429" || e?.status === 429;
}

export async function startLogin(input: {
  readonly verifierHash: string;
  readonly rateKeyHash: string;
  readonly limiter: EdgeRateLimiter;
  readonly challenges: ChallengeCreator;
  readonly telegramBotUsername: string;
}): Promise<LoginStartResult> {
  const edge = await input.limiter.limit({ key: `login-start:${input.rateKeyHash}` });
  if (!edge.success) return { kind: "RATE_LIMITED", retryAfterSeconds: LOGIN_RETRY_AFTER_SECONDS };
  let row;
  try {
    row = await input.challenges.createChallenge(input.verifierHash, input.rateKeyHash);
  } catch (error) {
    if (isRateLimitRefusal(error)) return { kind: "RATE_LIMITED", retryAfterSeconds: LOGIN_RETRY_AFTER_SECONDS };
    throw error;
  }
  if (!row.display_code) return { kind: "CONFIRMATION_UNAVAILABLE" };
  return {
    kind: "STARTED",
    challengeId: row.challenge_id,
    expiresAt: row.expires_at,
    confirmationCode: row.display_code,
    telegramDeepLink: `https://t.me/${input.telegramBotUsername}?start=contentos_${row.challenge_id}`,
  };
}

/** "472851" -> "472 851" (display only). */
export function formatConfirmationCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
