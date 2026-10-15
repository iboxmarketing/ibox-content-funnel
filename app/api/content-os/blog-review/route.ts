/**
 * Server boundary for the persisted Blog review slice. Runs only on the
 * server; the service-role key is read here from server env and never
 * reaches browser code. Fail closed: unless CONTENT_OS_PERSISTENCE_ENABLED
 * is "true" with a complete server config, every request gets 503 and
 * nothing is read from or written to Supabase.
 *
 * Identity comes only from the validated Telegram-backed HttpOnly session.
 * The body is strict and can never assert actor identity. Same-origin JSON is
 * required as an additional CSRF boundary for the ambient session cookie.
 */
import { NextResponse } from "next/server";
import { handleBlogReviewRequest, type BlogReviewLogRecord } from "@/lib/persistence/blog-review-api";
import { resolveContentOsPersistenceConfig, ContentOsPersistenceConfigError } from "@/lib/persistence/config";
import { createBlogReviewDependencies } from "@/lib/persistence";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
/** Upper bound per database API call, so a stuck upstream cannot hold the request open. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const log = (record: BlogReviewLogRecord) => console.log(JSON.stringify(record));

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  const parsedBody = await readSameOriginJson(request);
  if (!parsedBody.ok) return parsedBody.response;
  let config;
  try {
    config = resolveContentOsPersistenceConfig(process.env);
  } catch (error) {
    if (error instanceof ContentOsPersistenceConfigError) {
      log({ event: "content_os.blog_review", action: null, outcome: "not_configured", status: 503, code: error.code });
      return NextResponse.json({ code: error.code, error: "Content OS persistence is misconfigured." }, { status: 503, headers: noStore });
    }
    throw error;
  }
  const deps = createBlogReviewDependencies(config, (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }));
  const result = await handleBlogReviewRequest({ body: parsedBody.value, actorId: auth.user.id }, deps, log);
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}
