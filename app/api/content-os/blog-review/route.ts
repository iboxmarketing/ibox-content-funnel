/**
 * Server boundary for the persisted Blog review slice. Runs only on the
 * server; the service-role key is read here from server env and never
 * reaches browser code. Fail closed: unless CONTENT_OS_PERSISTENCE_ENABLED
 * is "true" with a complete server config, every request gets 503 and
 * nothing is read from or written to Supabase.
 *
 * Identity: the platform (Sites dispatch) authenticates the browser with its
 * own cookies and injects `oai-authenticated-user-*` headers. The app cannot
 * verify those headers itself (they are unsigned); see
 * docs/persistence/SPRINT_9_TRANSITION_CONTRACT.md §10 for the platform
 * contract this route depends on.
 *
 * Because that identity rides on ambient browser cookies, a cross-site page
 * could otherwise make the browser POST here. Defenses that match this model:
 * JSON content type only (a cross-origin JSON POST needs a CORS preflight,
 * which this route never grants), browser Fetch Metadata / Origin must be
 * same-origin, small bodies only.
 */
import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { handleBlogReviewRequest, type BlogReviewLogRecord } from "@/lib/persistence/blog-review-api";
import { resolveContentOsPersistenceConfig, ContentOsPersistenceConfigError } from "@/lib/persistence/config";
import { createBlogReviewDependencies } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const MAX_BODY_BYTES = 16 * 1024;
/** Upper bound per database API call, so a stuck upstream cannot hold the request open. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const log = (record: BlogReviewLogRecord) => console.log(JSON.stringify(record));
const reject = (status: number, code: string, error: string, extraHeaders: Record<string, string> = {}) => {
  log({ event: "content_os.blog_review", action: null, outcome: "invalid_input", status, code });
  return NextResponse.json({ code, error }, { status, headers: { ...noStore, ...extraHeaders } });
};

function crossOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false; // non-browser client; identity still comes only from the platform headers
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

async function readBody(request: Request): Promise<{ ok: true; text: string } | { ok: false }> {
  // Always consume the body before answering (answering mid-upload can stall the
  // connection); the platform caps request bodies, the route caps what it accepts.
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return { ok: false };
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function POST(request: Request) {
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
  const raw = await readBody(request); // consumed before any answer, also for rejected requests
  if (crossOrigin(request)) return reject(403, "CROSS_ORIGIN_REQUEST", "Cross-origin requests are not accepted.");
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return reject(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json.");
  if (!raw.ok) return reject(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  let body: unknown = null;
  try {
    body = JSON.parse(raw.text);
  } catch {
    body = null; // reported as INVALID_INPUT by the handler (after the auth checks)
  }

  const user = await getChatGPTUser();
  const deps = createBlogReviewDependencies(config, (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }));
  const result = await handleBlogReviewRequest({ body, externalSubject: user?.userId ?? null }, deps, log);
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}
