/**
 * In-memory adapters for tests and local demos. They enforce the same
 * invariants as the Sprint 8/9B schema (write-once provenance, one PRIMARY
 * link per task, insert-only links, immutable Task Type versions, idempotency
 * key + request-hash conflicts), and the gateway simulates the TARGET Task
 * Bot transition behavior described in docs/persistence/SPRINT_9_TRANSITION_CONTRACT.md.
 * Nothing here talks to a network or a database.
 */
import type { ContentEntityType } from "../content-entity";
import type { FieldValue } from "../task-instance";
import { PersistenceConflictError, type ContentOsStore, type OperationalTaskGateway } from "./ports";
import type {
  BlogRecord,
  CreateOperationalTaskInput,
  KnowledgeNodeRecord,
  OperationalActor,
  OperationalTask,
  TaskLinkRecord,
  TaskRuntimeRecord,
  TaskStatus,
  TaskTypeVersionRecord,
  WorkflowStepRecord,
} from "./records";
import { LEGACY_TRANSITIONS, completionAllowed, isSourceBlogForHeadReview, loadContentOsTaskFacts, revisionAllowed } from "./transition-contract";
import { BLOG_TASK_TYPE_CODE, TASK_TYPE_CODE_PATTERN, type TaskTypeCode } from "./task-type-codes";

export class TransitionRejectedError extends Error {
  constructor(readonly sqlState: "40001" | "42501" | "22023", message: string) {
    super(message);
    this.name = "TransitionRejectedError";
  }
}

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  const hex = counter.toString(16).padStart(12, "0");
  // Valid UUID text (the real tables use uuid ids); the prefix only seeds the first group.
  const seed = Array.from(prefix.padEnd(8, "0").slice(0, 8), (c) => (c.charCodeAt(0) % 16).toString(16)).join("");
  return `${seed}-0000-4000-8000-${hex}`;
};

export class InMemoryContentOsStore implements ContentOsStore {
  readonly knowledgeNodes = new Map<string, KnowledgeNodeRecord>();
  readonly blogs = new Map<string, BlogRecord>();
  readonly versions = new Map<string, TaskTypeVersionRecord>();
  readonly currentVersionByCode = new Map<TaskTypeCode, string>();
  readonly steps = new Map<string, WorkflowStepRecord>();
  readonly runtimes = new Map<string, TaskRuntimeRecord>();
  readonly links: TaskLinkRecord[] = [];

  // --- seeding (tests / demo only) ---
  addKnowledgeNode(node: KnowledgeNodeRecord): KnowledgeNodeRecord {
    this.knowledgeNodes.set(node.id, node);
    return node;
  }

  addTaskTypeVersion(code: TaskTypeCode, version: number, reviewRequired: boolean, makeCurrent = true): TaskTypeVersionRecord {
    if (!TASK_TYPE_CODE_PATTERN.test(code)) throw new PersistenceConflictError(`invalid task type code ${code}`);
    const existing = [...this.versions.values()].find((v) => v.code === code);
    const taskTypeId = existing?.taskTypeId ?? nextId("tasktype");
    if ([...this.versions.values()].some((v) => v.code === code && v.version === version)) {
      throw new PersistenceConflictError(`${code} v${version} already exists (versions are immutable)`);
    }
    const record: TaskTypeVersionRecord = { id: nextId("ttversion"), taskTypeId, code, version, reviewRequired };
    this.versions.set(record.id, record);
    if (makeCurrent) this.currentVersionByCode.set(code, record.id);
    return record;
  }

  addWorkflowStep(templateVersionId: string, overrides: unknown): WorkflowStepRecord {
    const record: WorkflowStepRecord = { id: nextId("wfstep"), templateVersionId, overrides };
    this.steps.set(record.id, record);
    return record;
  }

  // --- ContentOsStore ---
  async getKnowledgeNode(id: string) { return this.knowledgeNodes.get(id) ?? null; }
  async getBlog(id: string) { return this.blogs.get(id) ?? null; }

  async ensureBlog(blog: BlogRecord): Promise<BlogRecord> {
    const existing = this.blogs.get(blog.id);
    if (existing) {
      if (existing.knowledgeNodeId !== blog.knowledgeNodeId) throw new PersistenceConflictError(`blog ${blog.id} already exists for another knowledge node`);
      return existing;
    }
    if (!this.knowledgeNodes.has(blog.knowledgeNodeId)) throw new PersistenceConflictError(`knowledge node ${blog.knowledgeNodeId} does not exist`);
    this.blogs.set(blog.id, blog);
    return blog;
  }

  async currentTaskTypeVersion(code: TaskTypeCode) {
    const id = this.currentVersionByCode.get(code);
    return id ? this.versions.get(id) ?? null : null;
  }
  async getTaskTypeVersion(id: string) { return this.versions.get(id) ?? null; }
  async getWorkflowStep(id: string) { return this.steps.get(id) ?? null; }
  async getRuntime(taskId: string) { return this.runtimes.get(taskId) ?? null; }

  async ensureRuntime(runtime: TaskRuntimeRecord): Promise<TaskRuntimeRecord> {
    const existing = this.runtimes.get(runtime.taskId);
    if (existing) return existing;
    if (runtime.sourceTaskId === runtime.taskId) throw new PersistenceConflictError("a task cannot be its own source");
    if (!this.versions.has(runtime.taskTypeVersionId)) throw new PersistenceConflictError("unknown task type version");
    this.runtimes.set(runtime.taskId, runtime);
    return runtime;
  }

  async runtimesBySource(sourceTaskId: string) {
    return [...this.runtimes.values()].filter((runtime) => runtime.sourceTaskId === sourceTaskId);
  }

  async mergeFieldValues(taskId: string, values: Readonly<Record<string, FieldValue>>) {
    const existing = this.runtimes.get(taskId);
    if (!existing) throw new PersistenceConflictError(`no runtime for task ${taskId}`);
    this.runtimes.set(taskId, { ...existing, fieldValues: { ...existing.fieldValues, ...values } });
  }

  async ensureLinks(links: readonly TaskLinkRecord[]) {
    for (const link of links) {
      const same = this.links.find((l) => l.taskId === link.taskId && l.entityType === link.entityType && l.entityId === link.entityId);
      if (same) {
        if (same.relation !== link.relation) throw new PersistenceConflictError("links are insert-only; relation cannot change");
        continue;
      }
      if (link.relation === "PRIMARY" && this.links.some((l) => l.taskId === link.taskId && l.relation === "PRIMARY")) {
        throw new PersistenceConflictError(`task ${link.taskId} already has a PRIMARY entity`);
      }
      if (!this.entityExists(link.entityType, link.entityId)) throw new PersistenceConflictError(`content entity ${link.entityType}:${link.entityId} does not exist`);
      this.links.push(link);
    }
  }

  async linksForTask(taskId: string) { return this.links.filter((link) => link.taskId === taskId); }
  async linksForEntity(entityType: ContentEntityType, entityId: string) {
    return this.links.filter((link) => link.entityType === entityType && link.entityId === entityId);
  }

  private entityExists(entityType: ContentEntityType, entityId: string): boolean {
    if (entityType === "BLOG") return this.blogs.has(entityId);
    if (entityType === "KNOWLEDGE_NODE") return this.knowledgeNodes.has(entityId);
    return true; // other entity tables are outside this vertical slice's in-memory model
  }
}

/**
 * Simulates the Task Bot's FINAL transition function (Codex, marketing-team-task-bot
 * a9ed78a, 20261014130332_content_os_task_transition_compatibility.sql),
 * clause for clause:
 *  - legacy matrix for every task;
 *  - the Content OS completion gate also applies to legacy paths into DONE
 *    (a Head Review cannot complete via REVIEW while its Blog is in REVISION);
 *  - Content OS-only: IN_PROGRESS/REVISION -> DONE for non-review-required
 *    tasks by the assignee; Blog DONE -> REVISION only via its open Head
 *    Review, which ATOMICALLY parks that Head Review IN_PROGRESS -> BLOCKED;
 *    Blog REVISION -> DONE ATOMICALLY restores the Head Review recorded in
 *    the latest REVISION_REQUESTED event (reviewTaskId) BLOCKED -> ASSIGNED.
 * Each transition() is all-or-nothing, like the single RPC transaction.
 */
export interface SimulatedTaskEvent {
  readonly taskId: string;
  readonly actorId: string;
  readonly eventType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class InMemoryOperationalTaskGateway implements OperationalTaskGateway {
  readonly tasks = new Map<string, OperationalTask & { title: string; blockedReason: string | null }>();
  readonly actors = new Map<string, OperationalActor>();
  readonly ledger = new Map<string, { requestHash: string; taskId: string }>();
  readonly events: SimulatedTaskEvent[] = [];
  readonly revisions: { taskId: string; requestedBy: string; reason: string | null }[] = [];
  readonly transitions: { taskId: string; actorId: string; from: TaskStatus; to: TaskStatus; reason?: string }[] = [];

  constructor(private readonly store: ContentOsStore) {}

  addActor(actor: OperationalActor): OperationalActor {
    this.actors.set(actor.id, actor);
    return actor;
  }

  async createTaskIdempotent(input: CreateOperationalTaskInput) {
    const ledgerKey = `${input.purpose}:${input.idempotencyKey}`;
    const existing = this.ledger.get(ledgerKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new PersistenceConflictError(`IDEMPOTENCY_KEY_REUSED: ${ledgerKey}`);
      return { taskId: existing.taskId, created: false };
    }
    for (const id of [input.creatorId, input.assigneeId]) {
      if (!this.actors.get(id)?.isActive) throw new TransitionRejectedError("22023", `user ${id} is not active`);
    }
    if (/(^|[^A-Za-z0-9_])#posting([^A-Za-z0-9_]|$)/i.test(`${input.title}\n${input.description}`)) {
      throw new PersistenceConflictError("Content OS must never send the #posting tag (contract §posting_checklist_required)");
    }
    const id = nextId("task");
    // Task Bot autostart: every new task starts IN_PROGRESS.
    this.tasks.set(id, { id, status: "IN_PROGRESS", assigneeId: input.assigneeId, creatorId: input.creatorId, title: input.title, blockedReason: null });
    this.ledger.set(ledgerKey, { requestHash: input.requestHash, taskId: id });
    this.events.push({ taskId: id, actorId: input.creatorId, eventType: "TASK_CREATED", metadata: {} });
    return { taskId: id, created: true };
  }

  async getTask(taskId: string): Promise<OperationalTask | null> {
    const task = this.tasks.get(taskId);
    return task ? { id: task.id, status: task.status, assigneeId: task.assigneeId, creatorId: task.creatorId } : null;
  }

  async getActor(userId: string) { return this.actors.get(userId) ?? null; }

  async transition(taskId: string, actorId: string, newStatus: TaskStatus, reason?: string): Promise<OperationalTask> {
    const actor = this.actors.get(actorId);
    if (!actor?.isActive) throw new TransitionRejectedError("42501", "actor is not active");
    const task = this.tasks.get(taskId);
    if (!task) throw new TransitionRejectedError("22023", "task not found");
    const from = task.status;
    if (from === newStatus) return (await this.getTask(taskId)) as OperationalTask;

    let allowed = LEGACY_TRANSITIONS[from]?.includes(newStatus) ?? false;
    let review: { id: string; to: TaskStatus; blockedReason: string | null } | null = null;
    const facts = await loadContentOsTaskFacts(taskId, this.store, this);

    if (allowed && newStatus === "DONE" && facts) {
      const source = facts.runtime.sourceTaskId ? await loadContentOsTaskFacts(facts.runtime.sourceTaskId, this.store, this) : null;
      if (!completionAllowed(facts, source)) throw new TransitionRejectedError("40001", "task status changed concurrently");
    }

    if (!allowed && facts && (((from === "IN_PROGRESS" || from === "REVISION") && newStatus === "DONE") || (from === "DONE" && newStatus === "REVISION"))) {
      if (newStatus === "DONE") {
        if (facts.requiresReview) throw new TransitionRejectedError("40001", "task status changed concurrently");
        if (task.assigneeId !== actorId) throw new TransitionRejectedError("42501", "only the assignee may complete this Content OS task");
        const source = facts.runtime.sourceTaskId ? await loadContentOsTaskFacts(facts.runtime.sourceTaskId, this.store, this) : null;
        if (!completionAllowed(facts, source)) throw new TransitionRejectedError("40001", "task status changed concurrently");
        if (from === "REVISION" && facts.code === BLOG_TASK_TYPE_CODE) {
          const lastRevision = [...this.events].reverse().find((e) => e.taskId === taskId && e.eventType === "REVISION_REQUESTED" && typeof e.metadata.reviewTaskId === "string");
          if (!lastRevision) throw new TransitionRejectedError("40001", "source Blog revision has no Head Review provenance");
          const reviewId = lastRevision.metadata.reviewTaskId as string;
          const reviewFacts = await loadContentOsTaskFacts(reviewId, this.store, this);
          if (!reviewFacts || reviewFacts.task.status !== "BLOCKED" || !isSourceBlogForHeadReview(facts, reviewFacts)) {
            throw new TransitionRejectedError("40001", "Head Review state changed concurrently");
          }
          review = { id: reviewId, to: "ASSIGNED", blockedReason: null };
        }
        allowed = true;
      } else {
        for (const candidate of await this.store.runtimesBySource(taskId)) {
          const reviewFacts = await loadContentOsTaskFacts(candidate.taskId, this.store, this);
          if (reviewFacts && revisionAllowed(facts, reviewFacts, actor)) {
            review = { id: candidate.taskId, to: "BLOCKED", blockedReason: "Waiting for source Blog revision" };
            break;
          }
        }
        if (!review) throw new TransitionRejectedError("42501", "only the source Blog's Head Review may request this revision");
        allowed = true;
      }
    }
    if (!allowed) throw new TransitionRejectedError("40001", "task status changed concurrently");
    if (newStatus === "BLOCKED" && !reason?.trim()) throw new TransitionRejectedError("22023", "blocked reason is required");

    // Commit point: everything below happens together (single transaction).
    const metadata = { ...(reason ? { reason } : {}), ...(review ? { reviewTaskId: review.id } : {}) };
    this.tasks.set(taskId, { ...task, status: newStatus, blockedReason: newStatus === "BLOCKED" ? reason!.trim() : null });
    this.transitions.push({ taskId, actorId, from, to: newStatus, reason });
    this.events.push({ taskId, actorId, eventType: "STATUS_CHANGED", metadata });
    const special = newStatus === "REVISION" ? "REVISION_REQUESTED" : newStatus === "DONE" ? "TASK_COMPLETED" : newStatus === "BLOCKED" ? "TASK_BLOCKED" : from === "BLOCKED" ? "TASK_UNBLOCKED" : null;
    if (special) this.events.push({ taskId, actorId, eventType: special, metadata });
    if (newStatus === "REVISION") this.revisions.push({ taskId, requestedBy: actorId, reason: reason?.trim() || null });
    if (review) {
      const reviewTask = this.tasks.get(review.id)!;
      this.tasks.set(review.id, { ...reviewTask, status: review.to, blockedReason: review.blockedReason });
      this.transitions.push({ taskId: review.id, actorId, from: reviewTask.status, to: review.to });
      const reviewMetadata = { sourceTaskId: taskId, coupledContentOsTransition: true, ...(review.blockedReason ? { reason: review.blockedReason } : {}) };
      this.events.push({ taskId: review.id, actorId, eventType: "STATUS_CHANGED", metadata: reviewMetadata });
      this.events.push({ taskId: review.id, actorId, eventType: review.to === "BLOCKED" ? "TASK_BLOCKED" : "TASK_UNBLOCKED", metadata: reviewMetadata });
    }
    return (await this.getTask(taskId)) as OperationalTask;
  }
}
