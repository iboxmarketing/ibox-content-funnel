import { z } from "zod";
import { randomOpaqueToken, sha256Hex } from "@/lib/auth/crypto";
import { readSameOriginJson } from "@/lib/auth/request-security";
import { createServerAuthRepository, sessionCookie } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const InputSchema = z.object({
  challengeId: z.string().uuid(),
  verifier: z.string().min(43).max(256),
}).strict();

const failureStatus = (status: string) => {
  if (status === "INVALID_PROOF" || status === "USER_INACTIVE") return 401;
  if (status === "PENDING") return 409;
  return 410;
};

export async function POST(request: Request) {
  const body = await readSameOriginJson(request, 4 * 1024);
  if (!body.ok) return body.response;
  const input = InputSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json(
      { code: "INVALID_INPUT", error: "Login completion data is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { repository } = createServerAuthRepository();
    const rawSessionToken = randomOpaqueToken();
    const result = await repository.redeemChallenge({
      challengeId: input.data.challengeId,
      verifierHash: await sha256Hex(input.data.verifier),
      sessionTokenHash: await sha256Hex(rawSessionToken),
    });
    if (!result.user) {
      console.info(JSON.stringify({ event: "content_os.auth", action: "complete", outcome: result.status }));
      return Response.json(
        { code: "LOGIN_NOT_COMPLETED", reason: result.status, error: "Login could not be completed." },
        { status: failureStatus(result.status), headers: { "Cache-Control": "no-store" } },
      );
    }

    console.info(JSON.stringify({
      event: "content_os.auth",
      action: "complete",
      outcome: "authenticated",
      actorId: result.user.id,
      role: result.user.role,
    }));
    return Response.json(
      { user: { id: result.user.id, displayName: result.user.displayName, role: result.user.role } },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookie(rawSessionToken, request.url),
        },
      },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "content_os.auth",
      action: "complete",
      outcome: "backend_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
    }));
    return Response.json(
      { code: "AUTH_BACKEND_UNAVAILABLE", error: "Login is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
