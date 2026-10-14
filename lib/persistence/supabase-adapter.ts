/**
 * Supabase (PostgREST) adapters for the Content OS persistence ports.
 * SERVER-ONLY: constructed explicitly with a base URL, a service-role key
 * and a fetch implementation — nothing here reads environment variables,
 * and nothing constructs it by default (see ./index.ts, fail-closed).
 *
 * Boundary rules enforced by construction:
 *  - Content OS tables (content_*) are written directly.
 *  - public.tasks / public.users are only READ directly; tasks are created
 *    solely via the content_os_create_task_idempotent RPC and status changes
 *    solely via transition_task_with_events (Task Bot RPCs).
 *  - No content-reference column on public.tasks; runtime rows are keyed by public.tasks.id.
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
import type { TaskTypeCode } from "./task-type-codes";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class PostgrestError extends Error {
  constructor(readonly status: number, readonly pgCode: string | null, message: string) {
    super(message);
    this.name = "PostgrestError";
  }
}

export interface PostgrestConfig {
  /** e.g. https://<project>.supabase.co — the adapter appends /rest/v1. */
  readonly baseUrl: string;
  readonly serviceRoleKey: string;
  readonly fetch: FetchLike;
}

type Filters = Readonly<Record<string, string>>;
type Row = Record<string, unknown>;

/** Minimal PostgREST client: select / insert / patch / rpc. */
export class PostgrestClient {
  constructor(private readonly config: PostgrestConfig) {
    if (!config.baseUrl || !config.serviceRoleKey) throw new PersistenceConflictError("PostgREST client requires an explicit baseUrl and service-role key");
  }

  private url(path: string, query: Readonly<Record<string, string>> = {}): string {
    const params = new URLSearchParams(query).toString();
    return `${this.config.baseUrl.replace(/\/+$/, "")}/rest/v1/${path}${params ? `?${params}` : ""}`;
  }

  private async send(method: string, url: string, body: unknown, prefer?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    const response = await this.config.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) {
      let pgCode: string | null = null;
      let message = text;
      try {
        const parsed = JSON.parse(text) as { code?: string; message?: string };
        pgCode = parsed.code ?? null;
        message = parsed.message ?? text;
      } catch { /* non-JSON error body */ }
      throw new PostgrestError(response.status, pgCode, message);
    }
    return text ? JSON.parse(text) : null;
  }

  /** Filters are PostgREST operators, e.g. { task_id: "eq.<uuid>" }. */
  async select(table: string, columns: string, filters: Filters): Promise<Row[]> {
    return ((await this.send("GET", this.url(table, { select: columns, ...filters }), undefined)) ?? []) as Row[];
  }

  /** Insert; with ignoreDuplicates an existing PK/unique row is left untouched (ON CONFLICT DO NOTHING). */
  async insert(table: string, rows: readonly Row[], options: { ignoreDuplicates?: boolean } = {}): Promise<void> {
    await this.send("POST", this.url(table), rows, `${options.ignoreDuplicates ? "resolution=ignore-duplicates," : ""}return=minimal`);
  }

  async patch(table: string, values: Row, filters: Filters): Promise<void> {
    await this.send("PATCH", this.url(table, filters), values, "return=minimal");
  }

  async rpc(fn: string, args: Row): Promise<unknown> {
    return this.send("POST", this.url(`rpc/${fn}`), args);
  }
}

const eq = (value: string) => `eq.${value}`;

function toRuntime(row: Row): TaskRuntimeRecord {
  return {
    taskId: row.task_id as string,
    taskTypeVersionId: row.task_type_version_id as string,
    workflowRunId: (row.workflow_run_id as string | null) ?? null,
    workflowTemplateVersionId: (row.workflow_template_version_id as string | null) ?? null,
    workflowStepId: (row.workflow_step_id as string | null) ?? null,
    sourceTaskId: (row.source_task_id as string | null) ?? null,
    outcome: (row.outcome as TaskRuntimeRecord["outcome"]) ?? null,
    skipReason: (row.skip_reason as string | null) ?? null,
    fieldValues: (row.field_values as Record<string, FieldValue>) ?? {},
  };
}

const RUNTIME_COLUMNS = "task_id,task_type_version_id,workflow_run_id,workflow_template_version_id,workflow_step_id,source_task_id,outcome,skip_reason,field_values";

export class SupabaseContentOsStore implements ContentOsStore {
  constructor(private readonly db: PostgrestClient) {}

  async getKnowledgeNode(id: string): Promise<KnowledgeNodeRecord | null> {
    const [row] = await this.db.select("content_knowledge_nodes", "id,problem_part_id,name", { id: eq(id) });
    return row ? { id: row.id as string, problemPartId: row.problem_part_id as string, name: row.name as string } : null;
  }

  async getBlog(id: string): Promise<BlogRecord | null> {
    const [row] = await this.db.select("content_blogs", "id,knowledge_node_id,title,source_task_id", { id: eq(id) });
    return row ? { id: row.id as string, knowledgeNodeId: row.knowledge_node_id as string, title: row.title as string, sourceTaskId: (row.source_task_id as string | null) ?? null } : null;
  }

  async ensureBlog(blog: BlogRecord): Promise<BlogRecord> {
    await this.db.insert("content_blogs", [{ id: blog.id, knowledge_node_id: blog.knowledgeNodeId, title: blog.title, source_task_id: blog.sourceTaskId }], { ignoreDuplicates: true });
    const stored = await this.getBlog(blog.id);
    if (!stored || stored.knowledgeNodeId !== blog.knowledgeNodeId) throw new PersistenceConflictError(`blog ${blog.id} already exists for another knowledge node`);
    return stored;
  }

  private async versionWithCode(row: Row | undefined): Promise<TaskTypeVersionRecord | null> {
    if (!row) return null;
    const [type] = await this.db.select("content_task_types", "code", { id: eq(row.task_type_id as string) });
    if (!type) return null;
    return { id: row.id as string, taskTypeId: row.task_type_id as string, code: type.code as TaskTypeCode, version: row.version as number, reviewRequired: row.review_required as boolean };
  }

  async currentTaskTypeVersion(code: TaskTypeCode): Promise<TaskTypeVersionRecord | null> {
    const [type] = await this.db.select("content_task_types", "id,current_version_id", { code: eq(code), is_active: "is.true" });
    if (!type?.current_version_id) return null;
    return this.getTaskTypeVersion(type.current_version_id as string);
  }

  async getTaskTypeVersion(id: string): Promise<TaskTypeVersionRecord | null> {
    const [row] = await this.db.select("content_task_type_versions", "id,task_type_id,version,review_required", { id: eq(id) });
    return this.versionWithCode(row);
  }

  async getWorkflowStep(id: string): Promise<WorkflowStepRecord | null> {
    const [row] = await this.db.select("content_workflow_steps", "id,template_version_id,overrides", { id: eq(id) });
    return row ? { id: row.id as string, templateVersionId: row.template_version_id as string, overrides: row.overrides } : null;
  }

  async getRuntime(taskId: string): Promise<TaskRuntimeRecord | null> {
    const [row] = await this.db.select("content_task_runtime", RUNTIME_COLUMNS, { task_id: eq(taskId) });
    return row ? toRuntime(row) : null;
  }

  async ensureRuntime(runtime: TaskRuntimeRecord): Promise<TaskRuntimeRecord> {
    await this.db.insert("content_task_runtime", [{
      task_id: runtime.taskId,
      task_type_version_id: runtime.taskTypeVersionId,
      workflow_run_id: runtime.workflowRunId,
      workflow_template_version_id: runtime.workflowTemplateVersionId,
      workflow_step_id: runtime.workflowStepId,
      source_task_id: runtime.sourceTaskId,
      outcome: runtime.outcome,
      skip_reason: runtime.skipReason,
      field_values: runtime.fieldValues,
    }], { ignoreDuplicates: true });
    const stored = await this.getRuntime(runtime.taskId);
    if (!stored) throw new PersistenceConflictError(`runtime for task ${runtime.taskId} was not stored`);
    return stored;
  }

  async runtimesBySource(sourceTaskId: string): Promise<readonly TaskRuntimeRecord[]> {
    return (await this.db.select("content_task_runtime", RUNTIME_COLUMNS, { source_task_id: eq(sourceTaskId) })).map(toRuntime);
  }

  /** Read-merge-write of field_values only (provenance columns are never sent). */
  async mergeFieldValues(taskId: string, values: Readonly<Record<string, FieldValue>>): Promise<void> {
    const current = await this.getRuntime(taskId);
    if (!current) throw new PersistenceConflictError(`no runtime for task ${taskId}`);
    await this.db.patch("content_task_runtime", { field_values: { ...current.fieldValues, ...values } }, { task_id: eq(taskId) });
  }

  async ensureLinks(links: readonly TaskLinkRecord[]): Promise<void> {
    if (!links.length) return;
    await this.db.insert("content_task_links", links.map((link) => ({
      task_id: link.taskId, entity_type: link.entityType, entity_id: link.entityId, relation: link.relation,
    })), { ignoreDuplicates: true });
  }

  private toLink(row: Row): TaskLinkRecord {
    return { taskId: row.task_id as string, entityType: row.entity_type as ContentEntityType, entityId: row.entity_id as string, relation: row.relation as TaskLinkRecord["relation"] };
  }

  async linksForTask(taskId: string): Promise<readonly TaskLinkRecord[]> {
    return (await this.db.select("content_task_links", "task_id,entity_type,entity_id,relation", { task_id: eq(taskId) })).map((row) => this.toLink(row));
  }

  async linksForEntity(entityType: ContentEntityType, entityId: string): Promise<readonly TaskLinkRecord[]> {
    return (await this.db.select("content_task_links", "task_id,entity_type,entity_id,relation", { entity_type: eq(entityType), entity_id: eq(entityId) })).map((row) => this.toLink(row));
  }
}

function toTask(row: Row): OperationalTask {
  return { id: row.id as string, status: row.status as TaskStatus, assigneeId: row.assignee_id as string, creatorId: row.creator_id as string };
}

export class SupabaseOperationalTaskGateway implements OperationalTaskGateway {
  constructor(private readonly db: PostgrestClient) {}

  async createTaskIdempotent(input: CreateOperationalTaskInput): Promise<{ taskId: string; created: boolean }> {
    const result = await this.db.rpc("content_os_create_task_idempotent", {
      p_purpose: input.purpose,
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: input.requestHash,
      p_creator_id: input.creatorId,
      p_assignee_id: input.assigneeId,
      p_title: input.title,
      p_description: input.description,
      p_priority: input.priority,
      p_deadline: input.deadline,
    });
    const row = (Array.isArray(result) ? result[0] : result) as Row | undefined;
    if (!row?.task_id) throw new PersistenceConflictError("content_os_create_task_idempotent returned no task");
    return { taskId: row.task_id as string, created: row.created === true };
  }

  async getTask(taskId: string): Promise<OperationalTask | null> {
    const [row] = await this.db.select("tasks", "id,status,assignee_id,creator_id", { id: eq(taskId) });
    return row ? toTask(row) : null;
  }

  async getActor(userId: string): Promise<OperationalActor | null> {
    const [row] = await this.db.select("users", "id,role,is_active", { id: eq(userId) });
    return row ? { id: row.id as string, role: row.role as string, isActive: row.is_active as boolean } : null;
  }

  async transition(taskId: string, actorId: string, newStatus: TaskStatus, reason?: string): Promise<OperationalTask> {
    const row = (await this.db.rpc("transition_task_with_events", {
      p_task_id: taskId, p_actor_id: actorId, p_new_status: newStatus, p_reason: reason ?? null,
    })) as Row;
    return toTask(row);
  }
}
