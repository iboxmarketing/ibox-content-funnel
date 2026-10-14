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
import { LEGACY_TRANSITIONS, completionAllowed, loadContentOsTaskFacts, revisionAllowed } from "./transition-contract";
import { TASK_TYPE_CODE_PATTERN, type TaskTypeCode } from "./task-type-codes";

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
  return `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${hex}`;
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

/** Simulates the Task Bot after the Sprint 9 transition contract is applied. */
export class InMemoryOperationalTaskGateway implements OperationalTaskGateway {
  readonly tasks = new Map<string, OperationalTask & { title: string }>();
  readonly actors = new Map<string, OperationalActor>();
  readonly ledger = new Map<string, { requestHash: string; taskId: string }>();
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
    this.tasks.set(id, { id, status: "IN_PROGRESS", assigneeId: input.assigneeId, creatorId: input.creatorId, title: input.title });
    this.ledger.set(ledgerKey, { requestHash: input.requestHash, taskId: id });
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
    if (task.status === newStatus) return (await this.getTask(taskId)) as OperationalTask;

    let allowed = LEGACY_TRANSITIONS[task.status]?.includes(newStatus) ?? false;
    if (!allowed && (newStatus === "DONE" || newStatus === "REVISION")) {
      const facts = await loadContentOsTaskFacts(taskId, this.store, this);
      if (facts && newStatus === "DONE" && (task.status === "IN_PROGRESS" || task.status === "REVISION") && !facts.requiresReview) {
        if (task.assigneeId !== actorId) throw new TransitionRejectedError("42501", "only the assignee may complete this Content OS task");
        const source = facts.runtime.sourceTaskId ? await loadContentOsTaskFacts(facts.runtime.sourceTaskId, this.store, this) : null;
        if (!completionAllowed(facts, source)) throw new TransitionRejectedError("40001", "a Head Review completes only while its source Blog is DONE");
        allowed = true;
      } else if (facts && newStatus === "REVISION" && task.status === "DONE") {
        for (const review of await this.store.runtimesBySource(taskId)) {
          const reviewFacts = await loadContentOsTaskFacts(review.taskId, this.store, this);
          if (reviewFacts && revisionAllowed(facts, reviewFacts, actor)) { allowed = true; break; }
        }
        if (!allowed) throw new TransitionRejectedError("42501", "no Head Review of this Blog authorizes this actor to request a revision");
      }
    }
    if (!allowed) throw new TransitionRejectedError("40001", "task status changed concurrently");
    this.transitions.push({ taskId, actorId, from: task.status, to: newStatus, reason });
    this.tasks.set(taskId, { ...task, status: newStatus });
    return (await this.getTask(taskId)) as OperationalTask;
  }
}
