import { z } from "zod";
import { createServerAuthRepository } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ChallengeIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const challengeId = ChallengeIdSchema.safeParse(new URL(request.url).searchParams.get("challengeId"));
  if (!challengeId.success) {
    return Response.json(
      { code: "INVALID_INPUT", error: "Login request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { repository } = createServerAuthRepository();
    const result = await repository.getChallengeStatus(challengeId.data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "content_os.auth",
      action: "status",
      outcome: "backend_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
    }));
    return Response.json(
      { code: "AUTH_BACKEND_UNAVAILABLE", error: "Login status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
