/**
 * Persistence ports for the Content OS bridge. Two strictly separate
 * boundaries:
 *
 *  - ContentOsStore: Content OS tables only (content_*). Never touches
 *    public.tasks / public.users.
 *  - OperationalTaskGateway: the Task Bot. Creates tasks only through the
 *    idempotent RPC and changes status only through
 *    transition_task_with_events; reads public.tasks / public.users.
 *
 * Domain/application code depends on these interfaces only; adapters
 * (memory-adapter.ts for tests/demo, supabase-adapter.ts for the server)
 * are injected. Components never import this module.
 */
import type { ContentEntityType } from "../content-entity";
import type { FieldValue } from "../task-instance";
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
import type { TaskTypeCode } from "./task-type-codes";

export interface ContentOsStore {
  getKnowledgeNode(id: string): Promise<KnowledgeNodeRecord | null>;
  getBlog(id: string): Promise<BlogRecord | null>;
  /** Insert if absent (deterministic id ⇒ retry-safe). Rejects a different row under the same id. */
  ensureBlog(blog: BlogRecord): Promise<BlogRecord>;

  /** The Task Type version currently selected for new tasks of this code. */
  currentTaskTypeVersion(code: TaskTypeCode): Promise<TaskTypeVersionRecord | null>;
  getTaskTypeVersion(id: string): Promise<TaskTypeVersionRecord | null>;
  getWorkflowStep(id: string): Promise<WorkflowStepRecord | null>;

  getRuntime(taskId: string): Promise<TaskRuntimeRecord | null>;
  /** Insert if absent. An existing row is kept as-is (provenance is write-once). */
  ensureRuntime(runtime: TaskRuntimeRecord): Promise<TaskRuntimeRecord>;
  runtimesBySource(sourceTaskId: string): Promise<readonly TaskRuntimeRecord[]>;
  /** Merges into field_values; never touches provenance columns. */
  mergeFieldValues(taskId: string, values: Readonly<Record<string, FieldValue>>): Promise<void>;

  /** Insert-only; an identical existing link is a no-op. */
  ensureLinks(links: readonly TaskLinkRecord[]): Promise<void>;
  linksForTask(taskId: string): Promise<readonly TaskLinkRecord[]>;
  linksForEntity(entityType: ContentEntityType, entityId: string): Promise<readonly TaskLinkRecord[]>;
}

/** Input of the Task Bot's atomic `content_os_complete_blog_with_head_review` RPC (Sprint 10D). */
export interface CompleteBlogWithHeadReviewInput {
  readonly blogTaskId: string;
  readonly actorId: string;
  readonly reviewerId: string;
  readonly reviewDeadline: string;
  readonly reviewTitle: string;
  /** SHA-256 hex of the canonical {kind: HEAD_REVIEW, blogTaskId, blogId} request. */
  readonly reviewRequestHash: string;
}

export interface CompleteBlogWithHeadReviewResult {
  readonly blogTaskId: string;
  readonly blogStatus: TaskStatus;
  readonly headReviewTaskId: string;
  readonly headReviewStatus: TaskStatus;
  readonly headReviewCreated: boolean;
}

export interface OperationalTaskGateway {
  createTaskIdempotent(input: CreateOperationalTaskInput): Promise<{ readonly taskId: string; readonly created: boolean }>;
  getTask(taskId: string): Promise<OperationalTask | null>;
  getActor(userId: string): Promise<OperationalActor | null>;
  /** Generic lifecycle. The Task Bot refuses it for a Content OS BLOG moving to DONE. */
  transition(taskId: string, actorId: string, newStatus: TaskStatus, reason?: string): Promise<OperationalTask>;
  /**
   * The ONLY Blog completion path: in one Task Bot transaction it creates or reuses the
   * Blog's single Head Review and completes the Blog (or resubmits it and resumes that
   * same review). Retries return the same review.
   */
  completeBlogWithHeadReview(input: CompleteBlogWithHeadReviewInput): Promise<CompleteBlogWithHeadReviewResult>;
}

export class PersistenceNotConfiguredError extends Error {
  readonly code = "CONTENT_OS_PERSISTENCE_NOT_CONFIGURED";
  constructor(message = "Content OS persistence is not configured; nothing is read from or written to Supabase.") {
    super(message);
    this.name = "PersistenceNotConfiguredError";
  }
}

export class PersistenceConflictError extends Error {
  readonly code = "CONTENT_OS_PERSISTENCE_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConflictError";
  }
}
