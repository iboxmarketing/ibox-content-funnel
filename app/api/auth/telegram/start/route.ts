import { env } from "cloudflare:workers";
import { z } from "zod";
import { createServerAuthRepository } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";
import { startLogin } from "@/lib/auth/login-start";
import { deriveLoginRateKey } from "@/lib/auth/rate-key";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const InputSchema = z.object({
  verifierHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const noStore = { "Cache-Control": "no-store" };
const log = (outcome: string) => console.info(JSON.stringify({ event: "content_os.auth", action: "start", outcome }));

export async function POST(request: Request) {
  const body = await readSameOriginJson(request, 2 * 1024);
  if (!body.ok) return body.response;
  const input = InputSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ code: "INVALID_INPUT", error: "Login proof is invalid." }, { status: 400, headers: noStore });
  }

  // Public endpoint: an edge rate limiter is mandatory (fail closed when the binding is absent).
  const limiter = (env as unknown as { LOGIN_START_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> } }).LOGIN_START_LIMITER;
  if (!limiter) {
    log("rate_limiter_missing");
    return Response.json({ code: "LOGIN_UNAVAILABLE", error: "Login is temporarily unavailable." }, { status: 503, headers: noStore });
  }

  // Server-derived rate key: HMAC(pepper secret, Cloudflare client IP). Fail closed without either in production.
  const rateKey = await deriveLoginRateKey({
    requestUrl: request.url,
    headers: request.headers,
    pepper: (env as unknown as { CONTENT_OS_RATE_LIMIT_PEPPER?: string }).CONTENT_OS_RATE_LIMIT_PEPPER,
  });
  if (!rateKey.ok) {
    log(`rate_key_unavailable:${rateKey.reason.toLowerCase()}`);
    return Response.json({ code: "LOGIN_UNAVAILABLE", error: "Login is temporarily unavailable." }, { status: 503, headers: noStore });
  }

  try {
    const { config, repository } = createServerAuthRepository();
    const result = await startLogin({
      verifierHash: input.data.verifierHash,
      rateKeyHash: rateKey.rateKeyHash,
      limiter,
      challenges: repository,
      telegramBotUsername: config.telegramBotUsername,
    });
    log(result.kind.toLowerCase());
    if (result.kind === "RATE_LIMITED") {
      return Response.json(
        { code: "LOGIN_RATE_LIMITED", error: "Too many login attempts. Please wait a moment and try again.", retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { ...noStore, "Retry-After": String(result.retryAfterSeconds) } },
      );
    }
    if (result.kind === "CONFIRMATION_UNAVAILABLE") {
      // The matching-code contract is required (owner decision); never start a login without it.
      return Response.json({ code: "LOGIN_UNAVAILABLE", error: "Login is temporarily unavailable." }, { status: 503, headers: noStore });
    }
    return Response.json({
      challengeId: result.challengeId,
      telegramDeepLink: result.telegramDeepLink,
      expiresAt: result.expiresAt,
      confirmationCode: result.confirmationCode,
    }, { headers: noStore });
  } catch (error) {
    console.error(JSON.stringify({ event: "content_os.auth", action: "start", outcome: "backend_unavailable", errorName: error instanceof Error ? error.name : typeof error }));
    return Response.json({ code: "AUTH_BACKEND_UNAVAILABLE", error: "Login is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
