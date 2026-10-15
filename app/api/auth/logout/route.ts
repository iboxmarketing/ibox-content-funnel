import { sha256Hex } from "@/lib/auth/crypto";
import { z } from "zod";
import { readSameOriginJson } from "@/lib/auth/request-security";
import {
  createServerAuthRepository,
  expiredSessionCookie,
  sessionTokenFromCookies,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const body = await readSameOriginJson(request, 1024);
  if (!body.ok) return body.response;
  if (!z.object({}).strict().safeParse(body.value).success) {
    return Response.json({ code: "INVALID_INPUT", error: "Logout request is invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const rawToken = sessionTokenFromCookies(request.headers.get("cookie"), request.url);

  try {
    if (rawToken) {
      const { repository } = createServerAuthRepository();
      await repository.revokeSession(await sha256Hex(rawToken));
    }
    console.info(JSON.stringify({ event: "content_os.auth", action: "logout", outcome: "revoked" }));
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        ...(expiredSessionCookie(request.url) ? { "Set-Cookie": expiredSessionCookie(request.url) as string } : {}),
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "content_os.auth",
      action: "logout",
      outcome: "backend_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
    }));
    return Response.json(
      { code: "AUTH_BACKEND_UNAVAILABLE", error: "Logout is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
