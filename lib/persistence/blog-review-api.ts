/**
 * Transport-independent request handler for the persisted Blog review slice
 * (used by app/api/content-os/blog-review/route.ts). Pure: no env, no
 * Next.js, no network of its own — dependencies are injected.
 *
 * Security rules:
 *  - The ACTOR is never taken from the request body. It comes only from the
 *    platform-authenticated subject, resolved through ExternalActorResolver
 *    to an active public.users.id.
 *  - Other user ids in the body (assignee, reviewer) are only proposals the
 *    Task Bot validates (must be active users).
 *  - Fail closed: no persistence configured -> 503, no signed-in user -> 401,
 *    not linked -> 403.
 */
import { z } from "zod";
import { ActorNotLinkedError, type ExternalActorResolver } from "./actor-resolver";
import { BlogReviewFlow, ContentOsRuleError } from "./blog-review-flow";
import { PersistenceConflictError, PersistenceNotConfiguredError } from "./ports";
import { PersistenceTransportError } from "./supabase-adapter";

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

export const BlogReviewRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), requestKey: z.string().min(1).max(120), knowledgeNodeId: uuid, blogTitle: z.string().trim().min(1).max(180), assigneeId: uuid, deadline: isoDate, sourceTaskId: uuid.nullable().optional() }).strict(),
  z.object({ action: z.literal("complete"), blogTaskId: uuid, reviewerId: uuid, reviewDeadline: isoDate }).strict(),
  z.object({ action: z.literal("request-revision"), reviewTaskId: uuid, note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("approve"), reviewTaskId: uuid, note: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal("reconcile"), blogTaskId: uuid }).strict(),
]);

export type BlogReviewRequest = z.infer<typeof BlogReviewRequestSchema>;

export interface BlogReviewDependencies {
  readonly flow: BlogReviewFlow;
  readonly actors: ExternalActorResolver;
}

export interface ApiResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/**
 * One structured record per request, for diagnosis without secrets: no
 * headers, no key, no external subject, no request body. `actorId` is the
 * internal public.users.id once resolved.
 */
export type BlogReviewOutcome =
  | "ok"
  | "not_configured"
  | "unauthenticated"
  | "invalid_input"
  | "actor_not_linked"
  | "content_os_rule"
  | "content_os_conflict"
  | "task_bot_rejected"
  | "transport_failure"
  | "internal_error";

export interface BlogReviewLogRecord {
  readonly event: "content_os.blog_review";
  readonly action: string | null;
  readonly outcome: BlogReviewOutcome;
  readonly status: number;
  readonly code: string | null;
  readonly sqlState?: string | null;
  readonly actorId?: string | null;
  /** Idempotency result: false = a retry/duplicate returned the existing task. */
  readonly created?: boolean;
  readonly headReviewCreated?: boolean;
  readonly reconcileActions?: number;
  readonly errorName?: string;
}

export type BlogReviewLogger = (record: BlogReviewLogRecord) => void;

const RETRY_SAFE = "Retry the same request; it is idempotent.";

export async function handleBlogReviewRequest(
  input: { readonly body: unknown; readonly externalSubject: string | null },
  deps: BlogReviewDependencies | null,
  log: BlogReviewLogger = () => {},
): Promise<ApiResult> {
  const action = typeof (input.body as { action?: unknown } | null)?.action === "string" ? String((input.body as { action: string }).action).slice(0, 40) : null;
  const done = (outcome: BlogReviewOutcome, result: ApiResult, extra: Partial<BlogReviewLogRecord> = {}): ApiResult => {
    log({ event: "content_os.blog_review", action, outcome, status: result.status, code: typeof result.body.code === "string" ? result.body.code : null, ...extra });
    return result;
  };

  if (!deps) return done("not_configured", { status: 503, body: { code: "CONTENT_OS_PERSISTENCE_NOT_CONFIGURED", error: "Content OS persistence is not configured." } });
  if (!input.externalSubject) return done("unauthenticated", { status: 401, body: { code: "UNAUTHENTICATED", error: "Sign in required." } });

  const parsed = BlogReviewRequestSchema.safeParse(input.body);
  if (!parsed.success) return done("invalid_input", { status: 400, body: { code: "INVALID_INPUT", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });

  let actorId: string | null = null;
  try {
    actorId = await deps.actors.resolve(input.externalSubject);
    const request = parsed.data;
    switch (request.action) {
      case "start": {
        const result = await deps.flow.startBlog({ ...request, creatorId: actorId, sourceTaskId: request.sourceTaskId ?? null });
        return done("ok", { status: 200, body: { ...result } }, { actorId, created: result.created });
      }
      case "complete": {
        const result = await deps.flow.completeBlog({ ...request, actorId });
        return done("ok", { status: 200, body: { ...result } }, { actorId, headReviewCreated: result.headReviewCreated });
      }
      case "request-revision":
        return done("ok", { status: 200, body: { ...(await deps.flow.requestRevision({ ...request, actorId })) } }, { actorId });
      case "approve":
        return done("ok", { status: 200, body: { ...(await deps.flow.approve({ ...request, actorId })) } }, { actorId });
      case "reconcile": {
        const result = await deps.flow.reconcile(request.blogTaskId);
        return done("ok", { status: 200, body: { ...result } }, { actorId, reconcileActions: result.actions.length });
      }
    }
  } catch (error) {
    if (error instanceof ActorNotLinkedError) return done("actor_not_linked", { status: 403, body: { code: error.code, error: "Your account is not linked to a team member." } });
    if (error instanceof ContentOsRuleError) return done("content_os_rule", { status: 409, body: { code: error.code, error: error.message } }, { actorId });
    if (error instanceof PersistenceConflictError) return done("content_os_conflict", { status: 409, body: { code: error.code, error: error.message } }, { actorId });
    if (error instanceof PersistenceNotConfiguredError) return done("not_configured", { status: 503, body: { code: error.code, error: error.message } }, { actorId });
    if (error instanceof PersistenceTransportError) {
      return done("transport_failure", { status: 503, body: { code: error.code, error: `The task database did not answer. ${RETRY_SAFE}`, retryable: true } }, { actorId, errorName: error.cause_ });
    }
    const sqlState = (error as { sqlState?: string; pgCode?: string | null }).sqlState ?? (error as { pgCode?: string | null }).pgCode ?? null;
    if (sqlState === "42501") return done("task_bot_rejected", { status: 403, body: { code: "FORBIDDEN", error: "The task backend refused this action for your account." } }, { actorId, sqlState });
    if (sqlState === "40001" || sqlState === "23505" || sqlState === "23514" || sqlState === "22023" || sqlState === "55000") {
      return done("task_bot_rejected", { status: 409, body: { code: "CONFLICT", error: "The task changed or the action is not allowed in its current state; reload and retry." } }, { actorId, sqlState });
    }
    return done("internal_error", { status: 500, body: { code: "INTERNAL_ERROR", error: "Content OS persistence request failed." } }, { actorId, sqlState, errorName: error instanceof Error ? error.name : typeof error });
  }
}
