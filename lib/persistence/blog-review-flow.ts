/**
 * Sprint 9B vertical slice: Knowledge Node -> Blog -> Blog completion ->
 * Head Review -> revision of the SAME Blog -> corrected Blog DONE, with the
 * persisted provenance the Task Bot needs (contract:
 * docs/persistence/SPRINT_9_TRANSITION_CONTRACT.md).
 *
 * Production state mapping (existing seven statuses only):
 *  - Blog: IN_PROGRESS -> DONE (not review-required) ; DONE -> REVISION by the
 *    Head Review decision ; REVISION -> DONE by the Blog's assignee.
 *  - Head Review: created IN_PROGRESS once per Blog task (idempotency key
 *    head-review:<blogTaskId>) and REUSED; it stays IN_PROGRESS while the
 *    Blog is in REVISION (the "waiting" is derived from the Blog's status,
 *    so no cross-actor BLOCKED/RESUME is needed) and completes only while the
 *    Blog is DONE.
 * Status changes go through the Task Bot only; this service never writes
 * public.tasks.
 */
import type { ContentOsStore, OperationalTaskGateway } from "./ports";
import { PersistenceConflictError } from "./ports";
import type { TaskLinkRecord } from "./records";
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

/** Head Review decision fields (same ids/values as the Task Type fixture). */
export const HEAD_REVIEW_FIELDS = { decision: "review-decision", note: "review-note", approve: "Approved", revision: "Revision requested" } as const;

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
}

export interface CompleteBlogInput {
  readonly blogTaskId: string;
  readonly actorId: string;
  /** Used only the first time the Head Review is created. */
  readonly reviewerId: string;
  readonly reviewDeadline: string;
}

export class BlogReviewFlow {
  constructor(private readonly store: ContentOsStore, private readonly tasks: OperationalTaskGateway) {}

  async startBlog(input: StartBlogInput): Promise<{ blogTaskId: string; blogId: string; created: boolean }> {
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

    // Runtime is write-once: a retry keeps the version pinned by the first attempt.
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

  /** Completes (or re-completes after revision) the Blog and returns its ONE Head Review. */
  async completeBlog(input: CompleteBlogInput): Promise<{ headReviewTaskId: string; headReviewCreated: boolean }> {
    const blog = await this.requireFacts(input.blogTaskId, BLOG_TASK_TYPE_CODE);
    if (blog.requiresReview) throw new ContentOsRuleError("this Blog task is review-required; it completes through REVIEW, not directly");
    if (blog.task.status !== "DONE") await this.tasks.transition(blog.task.id, input.actorId, "DONE");
    return this.ensureHeadReview(blog, input);
  }

  /** Head Review decision "Revision requested": the SAME Blog task goes DONE -> REVISION. */
  async requestRevision(input: { reviewTaskId: string; actorId: string; note: string }): Promise<{ blogTaskId: string }> {
    const review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
    if (!review.runtime.sourceTaskId) throw new ContentOsRuleError("Head Review has no source Blog task");
    const blog = await this.requireFacts(review.runtime.sourceTaskId, BLOG_TASK_TYPE_CODE);
    const actor = await this.tasks.getActor(input.actorId);
    if (!revisionAllowed(blog, review, actor)) throw new ContentOsRuleError("this actor/review may not send this Blog back for revision");
    if (!input.note.trim()) throw new ContentOsRuleError("a revision request needs a note");
    await this.store.mergeFieldValues(review.task.id, { [HEAD_REVIEW_FIELDS.decision]: HEAD_REVIEW_FIELDS.revision, [HEAD_REVIEW_FIELDS.note]: input.note.trim() });
    await this.tasks.transition(blog.task.id, input.actorId, "REVISION", input.note.trim());
    return { blogTaskId: blog.task.id };
  }

  /** Head Review approval: completes the SAME Head Review, only while its Blog is DONE. */
  async approve(input: { reviewTaskId: string; actorId: string; note?: string }): Promise<void> {
    const review = await this.requireFacts(input.reviewTaskId, HEAD_REVIEW_TASK_TYPE_CODE);
    const blog = review.runtime.sourceTaskId ? await loadContentOsTaskFacts(review.runtime.sourceTaskId, this.store, this.tasks) : null;
    if (!completionAllowed(review, blog)) throw new ContentOsRuleError("the Head Review completes only while its source Blog is DONE");
    await this.store.mergeFieldValues(review.task.id, { [HEAD_REVIEW_FIELDS.decision]: HEAD_REVIEW_FIELDS.approve, [HEAD_REVIEW_FIELDS.note]: input.note?.trim() ?? "" });
    await this.tasks.transition(review.task.id, input.actorId, "DONE");
  }

  private async ensureHeadReview(blog: ContentOsTaskFacts, input: CompleteBlogInput) {
    const blogLink = blog.primaryLink;
    if (blogLink?.entityType !== "BLOG") throw new ContentOsRuleError("Blog task has no PRIMARY Blog entity");

    // Reuse: a Blog task has exactly one Head Review, found by stable code + lineage.
    for (const child of await this.store.runtimesBySource(blog.task.id)) {
      const version = await this.store.getTaskTypeVersion(child.taskTypeVersionId);
      if (version?.code === HEAD_REVIEW_TASK_TYPE_CODE) return { headReviewTaskId: child.taskId, headReviewCreated: false };
    }

    const version = await this.store.currentTaskTypeVersion(HEAD_REVIEW_TASK_TYPE_CODE);
    if (!version) throw new ContentOsRuleError("no current HEAD_REVIEW Task Type version");
    const blogRecord = await this.store.getBlog(blogLink.entityId);
    const title = neutralizePostingTag(`Head Review — ${blogRecord?.title ?? "Blog"}`).slice(0, 200);
    const request = { kind: HEAD_REVIEW_TASK_TYPE_CODE, blogTaskId: blog.task.id, blogId: blogLink.entityId, creatorId: input.actorId, assigneeId: input.reviewerId, deadline: input.reviewDeadline, title };
    const { taskId, created } = await this.tasks.createTaskIdempotent({
      purpose: "CREATE_TASK",
      idempotencyKey: idempotencyKeys.headReviewTask(blog.task.id),
      requestHash: requestHash(request),
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

  private async requireFacts(taskId: string, expectedCode: string): Promise<ContentOsTaskFacts> {
    const facts = await loadContentOsTaskFacts(taskId, this.store, this.tasks);
    if (!facts) throw new PersistenceConflictError(`task ${taskId} is not a Content OS task`);
    if (facts.code !== expectedCode) throw new ContentOsRuleError(`task ${taskId} is a ${facts.code} task, expected ${expectedCode}`);
    return facts;
  }
}
