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
  createChallenge(verifierHash: string): Promise<{
    readonly challenge_id: string | null;
    readonly status: "PENDING" | "RATE_LIMITED";
    readonly expires_at: string | null;
    readonly confirmation_code?: string | null;
  }>;
}

export const LOGIN_RETRY_AFTER_SECONDS = 60;

export type LoginStartResult =
  | { readonly kind: "STARTED"; readonly challengeId: string; readonly expiresAt: string; readonly confirmationCode: string; readonly telegramDeepLink: string }
  | { readonly kind: "RATE_LIMITED"; readonly retryAfterSeconds: number }
  | { readonly kind: "CONFIRMATION_UNAVAILABLE" };

export async function loginRateKey(headers: Headers): Promise<string> {
  return `login-start:${await sha256Hex(headers.get("cf-connecting-ip") ?? "unknown")}`;
}

export async function startLogin(input: {
  readonly verifierHash: string;
  readonly rateKey: string;
  readonly limiter: EdgeRateLimiter;
  readonly challenges: ChallengeCreator;
  readonly telegramBotUsername: string;
}): Promise<LoginStartResult> {
  const edge = await input.limiter.limit({ key: input.rateKey });
  if (!edge.success) return { kind: "RATE_LIMITED", retryAfterSeconds: LOGIN_RETRY_AFTER_SECONDS };
  const row = await input.challenges.createChallenge(input.verifierHash);
  if (row.status === "RATE_LIMITED") return { kind: "RATE_LIMITED", retryAfterSeconds: LOGIN_RETRY_AFTER_SECONDS };
  if (!row.challenge_id || !row.expires_at || !row.confirmation_code) return { kind: "CONFIRMATION_UNAVAILABLE" };
  return {
    kind: "STARTED",
    challengeId: row.challenge_id,
    expiresAt: row.expires_at,
    confirmationCode: row.confirmation_code,
    telegramDeepLink: `https://t.me/${input.telegramBotUsername}?start=contentos_${row.challenge_id}`,
  };
}

/** "472851" -> "472 851" (display only). */
export function formatConfirmationCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
