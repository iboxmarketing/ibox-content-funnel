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

export async function handleBlogReviewRequest(
  input: { readonly body: unknown; readonly externalSubject: string | null },
  deps: BlogReviewDependencies | null,
): Promise<ApiResult> {
  if (!deps) return { status: 503, body: { code: "CONTENT_OS_PERSISTENCE_NOT_CONFIGURED", error: "Content OS persistence is not configured." } };
  if (!input.externalSubject) return { status: 401, body: { code: "UNAUTHENTICATED", error: "Sign in required." } };

  const parsed = BlogReviewRequestSchema.safeParse(input.body);
  if (!parsed.success) return { status: 400, body: { code: "INVALID_INPUT", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };

  let actorId: string;
  try {
    actorId = await deps.actors.resolve(input.externalSubject);
  } catch (error) {
    if (error instanceof ActorNotLinkedError) return { status: 403, body: { code: error.code, error: "Your account is not linked to a team member." } };
    throw error;
  }

  const request = parsed.data;
  try {
    switch (request.action) {
      case "start":
        return { status: 200, body: { ...(await deps.flow.startBlog({ ...request, creatorId: actorId, sourceTaskId: request.sourceTaskId ?? null })) } };
      case "complete":
        return { status: 200, body: { ...(await deps.flow.completeBlog({ ...request, actorId })) } };
      case "request-revision":
        return { status: 200, body: { ...(await deps.flow.requestRevision({ ...request, actorId })) } };
      case "approve":
        return { status: 200, body: { ...(await deps.flow.approve({ ...request, actorId })) } };
      case "reconcile":
        return { status: 200, body: { ...(await deps.flow.reconcile(request.blogTaskId)) } };
    }
  } catch (error) {
    if (error instanceof ContentOsRuleError) return { status: 409, body: { code: error.code, error: error.message } };
    if (error instanceof PersistenceConflictError) return { status: 409, body: { code: error.code, error: error.message } };
    if (error instanceof PersistenceNotConfiguredError) return { status: 503, body: { code: error.code, error: error.message } };
    const sqlState = (error as { sqlState?: string; pgCode?: string | null }).sqlState ?? (error as { pgCode?: string | null }).pgCode;
    if (sqlState === "42501") return { status: 403, body: { code: "FORBIDDEN", error: "The task backend refused this action for your account." } };
    if (sqlState === "40001" || sqlState === "23505" || sqlState === "23514") return { status: 409, body: { code: "CONFLICT", error: "The task changed or the action is not allowed in its current state; reload and retry." } };
    throw error;
  }
}
