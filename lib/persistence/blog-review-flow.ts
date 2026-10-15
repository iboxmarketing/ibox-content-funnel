/**
 * Persisted vertical slice: Knowledge Node -> Blog -> Blog DONE -> ONE Head
 * Review -> revision of the SAME Blog -> corrected Blog DONE -> SAME Head
 * Review resumes -> Head Review approves.
 *
 * Approved lifecycle (existing seven statuses only):
 *   Blog         IN_PROGRESS -> DONE -> REVISION -> DONE ...
 *   Head Review  IN_PROGRESS -> BLOCKED (revision requested) -> ASSIGNED
 *                (Blog corrected; decision cleared) -> IN_PROGRESS (reviewer
 *                picks it up again) -> DONE (approved) | BLOCKED (again)
 *
 * The two-task changes are ATOMIC in the Task Bot: one transition on the
 * Blog (DONE -> REVISION / REVISION -> DONE) moves the coupled Head Review
 * in the same transaction (Task Bot a9ed78a). This service therefore issues
 * exactly ONE Task Bot transition per step and never moves the Head Review
 * itself for those two steps. Content OS state touched here is limited to
 * the Head Review's informational decision fields, which are always written
 * AFTER the Task Bot transition and can be re-derived from Task Bot state at
 * any time (`reconcile`). Every operation is idempotent: it reads the
 * current statuses and performs only what is still missing, so a retry
 * after any partial failure converges without creating a task.
 *
 * Pre-validation rule: a Task Bot transition is sent only when its own rules
 * will accept it (same predicates, same statuses). The Task Bot reports a
 * refused transition as SQLSTATE 40001, and PostgREST retries 40001 inside
 * the request without limit, so a request the Task Bot would refuse must be
 * refused here (ContentOsRuleError) and never sent.
 *
 * Only stable ids, codes and lineage are used — never titles or names.
 * Status changes go only through OperationalTaskGateway (Task Bot RPCs);
 * ContentOsStore writes only content_* rows.
 */
import type { ContentOsStore, OperationalTaskGateway } from "./ports";
import { PersistenceConflictError } from "./ports";
import type { OperationalActor, TaskLinkRecord, TaskStatus } from "./records";
import { completionAllowed, loadContentOsTaskFacts, revisionAllowed, type ContentOsTaskFacts } from "./transition-contract";
import { BLOG_TASK_TYPE_CODE, HEAD_REVIEW_TASK_TYPE_CODE } from "./task-type-codes";
import { deterministicUuid, idempotencyKeys, neutralizePostingTag, requestHash } from "./idempotency";

export class ContentOsRuleError extends Error {
  readonly code = "CONTENT_OS_RULE";
  constructor(message: string) {
    super(message);
    this.name = "ContentOsRuleError";
  }
}

/** Head Review decision fields (same ids/values as the Task Type fixture). Informational only. */
export const HEAD_REVIEW_FIELDS = { decision: "review-decision", note: "review-note", approve: "Approved", revision: "Revision requested" } as const;

/**
 * Future extension point: if a Content OS Task Type ever needs the Task Bot
 * posting checklist, it must be requested explicitly through a creation
 * parameter on the Task Bot RPC (not by a title convention). Not supported by
 * the current RPC, so the only accepted value today is "NONE".
 */
export type PostingChecklistRequest = "NONE";

export interface StartBlogInput {
  /** Caller-supplied stable request key: a retry with the same key never duplicates anything. */
  readonly requestKey: string;
  readonly knowledgeNodeId: string;
  readonly blogTitle: string;
  readonly creatorId: string;
  readonly assigneeId: string;
  readonly deadline: string;
  /** The Research task that produced this Blog, if any (lineage). */
  readonly sourceTaskId?: string | null;
  readonly postingChecklist?: PostingChecklistRequest;
}

export interface CompleteBlogInput {
  readonly blogTaskId: string;
  readonly actorId: string;
  /** Used only when the Head Review does not exist yet. */
  readonly reviewerId: string;
  readonly reviewDeadline: string;
}

export interface BlogReviewState {
  readonly blogTaskId: string;
  readonly blogStatus: TaskStatus;
  readonly headReviewTaskId: string | null;
  readonly headReviewStatus: TaskStatus | null;
  readonly decision: string | null;
}

export interface ReconcileResult extends BlogReviewState {
  /** What reconcile changed (Content OS decision fields only), or why it could not. */
  readonly actions: readonly string[];
}

export class BlogReviewFlow {
  constructor(private readonly store: ContentOsStore, private readonly tasks: OperationalTaskGateway) {}

  async startBlog(input: StartBlogInput): Promise<{ blogTaskId: string; blogId: string; created: boolean }> {
    if (input.postingChecklist && input.postingChecklist !== "NONE") throw new ContentOsRuleError("posting checklists are not requested by Content OS");
    const node = await this.store.getKnowledgeNode(input.knowledgeNodeId);
    if (!node) throw new ContentOsRuleError(`knowledge node ${input.knowledgeNodeId} does not exist`);
    const version = await this.store.currentTaskTypeVersion(BLOG_TASK_TYPE_CODE);
    if (!version) throw new ContentOsRuleError("no current BLOG Task Type version");

    const blogId = deterministicUuid(`blog-entity:${input.requestKey}`);
    await this.store.ensureBlog({ id: blogId, knowledgeNodeId: node.id, title: input.blogTitle, sourceTaskId: input.sourceTaskId ?? null });

    const title = neutralizePostingTag(`Blog — ${input.blogTitle}`).slice(0, 200);
    const request = { kind: BLOG_TASK_TYPE_CODE, blogId, knowledgeNodeId: node.id, creatorId: input.creatorId, assigneeId: input.assigneeId, deadline: input.deadline, title };
    const { taskId, created } = await this.tasks.createTaskIdempotent({
      purpose: "CREATE_TASK",
      idempotencyKey: idempotencyKeys.blogTask(input.requestKey),
      requestHash: requestHash(request),
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      title,
      description: "",
      priority: "normal",
      deadline: input.deadline,
    });

    // Write-once: a retry keeps the version pinned by the first attempt.
    await this.store.ensureRuntime({
      taskId, taskTypeVersionId: version.id, workflowRunId: null, workflowTemplateVersionId: null, workflowStepId: null,
      sourceTaskId: input.sourceTaskId ?? null, outcome: null, skipReason: null, fieldValues: {},
    });
    await this.store.ensureLinks([
      { taskId, entityType: "BLOG", entityId: blogId, relation: "PRIMARY" },
      { taskId, entityType: "KNOWLEDGE_NODE", entityId: node.id, relation: "RELATED" },
    ]);
    return { blogTaskId: taskId, blogId, created };
  }

  /**
   * First completion AND resubmission after revision. One Task Bot
   * transition (-> DONE); on resubmission the Task Bot restores the SAME
   * Head Review BLOCKED -> ASSIGNED atomically. Then ensures exactly one
   * Head Review exists and aligns its decision fields.
   */
  async completeBlog(input: CompleteBlogInput): Promise<BlogReviewState & { headReviewCreated: boolean }> {
    let blog = await this.requireFacts(input.blogTaskId, BLOG_TASK_TYPE_CODE);
    if (blog.requiresReview) throw new ContentOsRuleError("this Blog task is review-required; it completes through REVIEW, not directly");
    if (blog.task.status === "IN_PROGRESS" || blog.task.status === "REVISION") {
      if (blog.task.assigneeId !== input.actorId) throw new ContentOsRuleError("only the Blog assignee completes the Blog");
      if (blog.task.status === "REVISION") {
        // The Task Bot restores the parked review only if it is still BLOCKED.
        const parked = await this.findHeadReview(blog.task.id);
        const parkedTask = parked ? await this.tasks.getTask(parked) : null;
        if (parkedTask?.status !== "BLOCKED") {
          throw new ContentOsRuleError(`the Head Review is not waiting for this Blog (${parkedTask?.status ?? "missing"}); it must be BLOCKED before the Blog is resubmitted`);
        }
      }
      await this.tasks.transition(blog.task.id, input.actorId, "DONE");
      blog = await this.requireFacts(input.blogTaskId, BLOG_TASK_TYPE_CODE);
    } else if (blog.task.status !== "DONE") {
      throw new ContentOsRuleError(`a ${blog.task.status} Blog cannot be completed`);
    }
    const { headReviewTaskId, headReviewCreated } = await this.ensureHeadReview(blog, input);
    const state = await this.alignDecision(blog.task.id, headReviewTaskId);
    return { ...state, headReviewCreated };
  }

  /**
   * Head Review "Revision requested". ONE Task Bot transition: Blog DONE ->
   * REVISION, which atomically parks the SAME Head Review as BLOCKED.
   * Idempotent: if that already happened (lost response / retry), only the
   * decision fields are (re)written.
   */
  async requestRevision(input: { reviewTaskId: string; actorId: string; note: string }): Promise<BlogReviewState> {
    const note = input.note.trim();
    if (!note) throw new ContentOsRuleError("a revision request needs a note");
    let review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
    const blogTaskId = this.sourceOf(review);
    let blog = await this.requireFacts(blogTaskId, BLOG_TASK_TYPE_CODE);
    const actor = await this.tasks.getActor(input.actorId);
    if (!isReviewAuthority(review, actor)) throw new ContentOsRuleError("this actor may not decide this Head Review");

    const alreadyApplied = blog.task.status === "REVISION" && review.task.status === "BLOCKED";
    if (!alreadyApplied) {
      if (blog.task.status !== "DONE" || (review.task.status !== "ASSIGNED" && review.task.status !== "IN_PROGRESS")) {
        throw new ContentOsRuleError("this Head Review may not send this Blog back for revision now");
      }
      if (review.task.status === "ASSIGNED") {
        // The reviewer picks the review up again (legacy ACCEPT) before deciding.
        await this.tasks.transition(review.task.id, input.actorId, "IN_PROGRESS");
        review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
      }
      if (!revisionAllowed(blog, review, actor)) throw new ContentOsRuleError("this Head Review may not send this Blog back for revision now");
      await this.tasks.transition(blog.task.id, input.actorId, "REVISION", note);
      blog = await this.requireFacts(blogTaskId, BLOG_TASK_TYPE_CODE);
    }
    await this.store.mergeFieldValues(review.task.id, { [HEAD_REVIEW_FIELDS.decision]: HEAD_REVIEW_FIELDS.revision, [HEAD_REVIEW_FIELDS.note]: note });
    return this.state(blogTaskId, review.task.id);
  }

  /** Head Review approval: the SAME Head Review -> DONE, only while its Blog is DONE. Idempotent. */
  async approve(input: { reviewTaskId: string; actorId: string; note?: string }): Promise<BlogReviewState> {
    let review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
    const blogTaskId = this.sourceOf(review);
    if (review.task.status !== "DONE") {
      const actor = await this.tasks.getActor(input.actorId);
      if (!isReviewAuthority(review, actor) || review.task.assigneeId !== input.actorId) {
        throw new ContentOsRuleError("only the Head Review assignee completes the review");
      }
      if (!["ASSIGNED", "IN_PROGRESS", "REVIEW"].includes(review.task.status)) {
        throw new ContentOsRuleError(`a ${review.task.status} Head Review cannot be approved`);
      }
      const blog = await loadContentOsTaskFacts(blogTaskId, this.store, this.tasks);
      if (!completionAllowed(review, blog)) throw new ContentOsRuleError("the Head Review completes only while its source Blog is DONE");
      if (review.task.status === "ASSIGNED") {
        await this.tasks.transition(review.task.id, input.actorId, "IN_PROGRESS");
        review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
      }
      await this.tasks.transition(review.task.id, input.actorId, "DONE");
    }
    await this.store.mergeFieldValues(review.task.id, { [HEAD_REVIEW_FIELDS.decision]: HEAD_REVIEW_FIELDS.approve, ...(input.note?.trim() ? { [HEAD_REVIEW_FIELDS.note]: input.note.trim() } : {}) });
    return this.state(blogTaskId, review.task.id);
  }

  /**
   * Explicit reconciliation for THIS slice. The Task Bot side is atomic, so
   * the only state that can lag is the Head Review's informational decision
   * field (written after each transition). It is re-derived from Task Bot
   * statuses; nothing operational is changed and no task is created.
   */
  async reconcile(blogTaskId: string): Promise<ReconcileResult> {
    const blog = await this.requireFacts(blogTaskId, BLOG_TASK_TYPE_CODE);
    const reviewTaskId = await this.findHeadReview(blog.task.id);
    if (!reviewTaskId) {
      const actions = blog.task.status === "DONE" ? ["HEAD_REVIEW_MISSING: retry completeBlog (idempotent) to create or re-attach it"] : [];
      return { ...(await this.state(blogTaskId, null)), actions };
    }
    const before = await this.state(blogTaskId, reviewTaskId);
    const after = await this.alignDecision(blogTaskId, reviewTaskId);
    return { ...after, actions: before.decision === after.decision ? [] : [`decision ${before.decision ?? "∅"} -> ${after.decision ?? "∅"}`] };
  }

  async state(blogTaskId: string, reviewTaskId: string | null): Promise<BlogReviewState> {
    const blog = await this.tasks.getTask(blogTaskId);
    if (!blog) throw new PersistenceConflictError(`task ${blogTaskId} not found`);
    const review = reviewTaskId ? await this.tasks.getTask(reviewTaskId) : null;
    const runtime = reviewTaskId ? await this.store.getRuntime(reviewTaskId) : null;
    const decision = runtime?.fieldValues[HEAD_REVIEW_FIELDS.decision];
    return {
      blogTaskId,
      blogStatus: blog.status,
      headReviewTaskId: reviewTaskId,
      headReviewStatus: review?.status ?? null,
      decision: typeof decision === "string" ? decision : null,
    };
  }

  /** Decision derived from Task Bot state: BLOCKED while the Blog is in REVISION ⇒ "Revision requested";
   * DONE ⇒ "Approved"; otherwise (resubmitted / open) ⇒ cleared. */
  private async alignDecision(blogTaskId: string, reviewTaskId: string): Promise<BlogReviewState> {
    const current = await this.state(blogTaskId, reviewTaskId);
    const expected =
      current.headReviewStatus === "DONE" ? HEAD_REVIEW_FIELDS.approve
        : current.headReviewStatus === "BLOCKED" && current.blogStatus === "REVISION" ? HEAD_REVIEW_FIELDS.revision
          : null;
    if (current.decision !== expected) {
      await this.store.mergeFieldValues(reviewTaskId, { [HEAD_REVIEW_FIELDS.decision]: expected });
      return { ...current, decision: expected };
    }
    return current;
  }

  private async findHeadReview(blogTaskId: string): Promise<string | null> {
    for (const child of await this.store.runtimesBySource(blogTaskId)) {
      const version = await this.store.getTaskTypeVersion(child.taskTypeVersionId);
      if (version?.code === HEAD_REVIEW_TASK_TYPE_CODE) return child.taskId;
    }
    return null;
  }

  private async ensureHeadReview(blog: ContentOsTaskFacts, input: CompleteBlogInput) {
    const blogLink = blog.primaryLink;
    if (blogLink?.entityType !== "BLOG") throw new ContentOsRuleError("Blog task has no PRIMARY Blog entity");

    // Reuse: a Blog task has exactly one Head Review, found by stable code + lineage.
    const existing = await this.findHeadReview(blog.task.id);
    if (existing) return { headReviewTaskId: existing, headReviewCreated: false };

    const version = await this.store.currentTaskTypeVersion(HEAD_REVIEW_TASK_TYPE_CODE);
    if (!version) throw new ContentOsRuleError("no current HEAD_REVIEW Task Type version");
    const blogRecord = await this.store.getBlog(blogLink.entityId);
    const title = neutralizePostingTag(`Head Review — ${blogRecord?.title ?? "Blog"}`).slice(0, 200);
    // The hash covers only the review's identity (which Blog task / entity),
    // so a retry after a lost response returns the SAME task even if the
    // caller now passes a different reviewer or deadline.
    const { taskId, created } = await this.tasks.createTaskIdempotent({
      purpose: "CREATE_TASK",
      idempotencyKey: idempotencyKeys.headReviewTask(blog.task.id),
      requestHash: requestHash({ kind: HEAD_REVIEW_TASK_TYPE_CODE, blogTaskId: blog.task.id, blogId: blogLink.entityId }),
      creatorId: input.actorId,
      assigneeId: input.reviewerId,
      title,
      description: "",
      priority: "normal",
      deadline: input.reviewDeadline,
    });
    await this.store.ensureRuntime({
      taskId, taskTypeVersionId: version.id, workflowRunId: null, workflowTemplateVersionId: null, workflowStepId: null,
      sourceTaskId: blog.task.id, outcome: null, skipReason: null, fieldValues: {},
    });
    const relatedNode = (await this.store.linksForTask(blog.task.id)).find((link) => link.entityType === "KNOWLEDGE_NODE");
    const links: TaskLinkRecord[] = [{ taskId, entityType: "BLOG", entityId: blogLink.entityId, relation: "PRIMARY" }];
    if (relatedNode) links.push({ taskId, entityType: "KNOWLEDGE_NODE", entityId: relatedNode.entityId, relation: "RELATED" });
    await this.store.ensureLinks(links);
    return { headReviewTaskId: taskId, headReviewCreated: created };
  }

  private sourceOf(review: ContentOsTaskFacts): string {
    if (!review.runtime.sourceTaskId) throw new ContentOsRuleError("Head Review has no source Blog task");
    return review.runtime.sourceTaskId;
  }

  private async requireFacts(taskId: string, expectedCode: string): Promise<ContentOsTaskFacts> {
    const facts = await loadContentOsTaskFacts(taskId, this.store, this.tasks);
    if (!facts) throw new PersistenceConflictError(`task ${taskId} is not a Content OS task`);
    if (facts.code !== expectedCode) throw new ContentOsRuleError(`task ${taskId} is a ${facts.code} task, expected ${expectedCode}`);
    return facts;
  }
}

/** The people who may decide a Head Review: its active assignee or the active Head (same as content_os_revision_allowed). */
function isReviewAuthority(review: ContentOsTaskFacts, actor: OperationalActor | null): boolean {
  return actor !== null && actor.isActive && (review.task.assigneeId === actor.id || actor.role === "HEAD_OF_MARKETING");
}
