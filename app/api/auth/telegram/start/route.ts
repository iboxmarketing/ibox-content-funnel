import { z } from "zod";
import { createServerAuthRepository } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const InputSchema = z.object({
  verifierHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export async function POST(request: Request) {
  const body = await readSameOriginJson(request, 2 * 1024);
  if (!body.ok) return body.response;
  const input = InputSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json(
      { code: "INVALID_INPUT", error: "Login proof is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { config, repository } = createServerAuthRepository();
    const challenge = await repository.createChallenge(input.data.verifierHash);
    console.info(JSON.stringify({ event: "content_os.auth", action: "start", outcome: "created" }));
    return Response.json({
      challengeId: challenge.challenge_id,
      telegramDeepLink: `https://t.me/${config.telegramBotUsername}?start=contentos_${challenge.challenge_id}`,
      expiresAt: challenge.expires_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "content_os.auth",
      action: "start",
      outcome: "backend_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
    }));
    return Response.json(
      { code: "AUTH_BACKEND_UNAVAILABLE", error: "Login is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
