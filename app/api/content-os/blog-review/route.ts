/**
 * Server boundary for the persisted Blog review slice. Runs only on the
 * server; the service-role key is read here from server env and never
 * reaches browser code. Fail closed: unless CONTENT_OS_PERSISTENCE_ENABLED
 * is "true" with a complete server config, every request gets 503 and
 * nothing is read from or written to Supabase.
 */
import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { handleBlogReviewRequest } from "@/lib/persistence/blog-review-api";
import { resolveContentOsPersistenceConfig, ContentOsPersistenceConfigError } from "@/lib/persistence/config";
import { createBlogReviewDependencies } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function POST(request: Request) {
  let config;
  try {
    config = resolveContentOsPersistenceConfig(process.env);
  } catch (error) {
    if (error instanceof ContentOsPersistenceConfigError) {
      return NextResponse.json({ code: error.code, error: "Content OS persistence is misconfigured." }, { status: 503, headers: noStore });
    }
    throw error;
  }
  const user = await getChatGPTUser();
  const body = await request.json().catch(() => null);
  try {
    const result = await handleBlogReviewRequest(
      { body, externalSubject: user?.userId ?? null },
      createBlogReviewDependencies(config, (url, init) => fetch(url, { ...init, cache: "no-store" })),
    );
    return NextResponse.json(result.body, { status: result.status, headers: noStore });
  } catch {
    return NextResponse.json({ code: "INTERNAL_ERROR", error: "Content OS persistence request failed." }, { status: 500, headers: noStore });
  }
}
