/**
 * Classifies Task Bot tasks as MANUAL or CONTENT OS workflow tasks from
 * persisted provenance only: a content_task_runtime row, its PINNED Task Type
 * version's code, its source_task_id lineage, and current public.tasks
 * assignee/status. Never titles. Server-only (service-role PostgREST client).
 *
 * Fails closed: any lookup failure throws, and the caller refuses the request.
 */
import type { PostgrestClient } from "./persistence/supabase-adapter";
import type { TaskClassification } from "./team-task-policy";
import type { TaskBackendStatus } from "./task-client-types";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 100;

export interface WorkflowClassifier {
  classify(taskIds: readonly string[]): Promise<ReadonlyMap<string, TaskClassification>>;
}

const inList = (ids: readonly string[]) => `in.(${ids.join(",")})`;

export class SupabaseWorkflowClassifier implements WorkflowClassifier {
  constructor(private readonly db: Pick<PostgrestClient, "select">) {}

  private async selectIn(table: string, columns: string, column: string, ids: readonly string[]): Promise<Row[]> {
    const unique = [...new Set(ids)].filter((id) => UUID.test(id));
    const rows: Row[] = [];
    for (let i = 0; i < unique.length; i += BATCH) {
      rows.push(...await this.db.select(table, columns, { [column]: inList(unique.slice(i, i + BATCH)) }));
    }
    return rows;
  }

  private async codesFor(runtimes: readonly Row[]): Promise<Map<string, string>> {
    const versions = await this.selectIn("content_task_type_versions", "id,task_type_id", "id", runtimes.map((r) => String(r.task_type_version_id)));
    const types = await this.selectIn("content_task_types", "id,code", "id", versions.map((v) => String(v.task_type_id)));
    const codeByType = new Map(types.map((t) => [String(t.id), String(t.code)]));
    const codeByVersion = new Map(versions.map((v) => [String(v.id), codeByType.get(String(v.task_type_id)) ?? ""]));
    return new Map(runtimes.map((r) => [String(r.task_id), codeByVersion.get(String(r.task_type_version_id)) ?? ""]));
  }

  async classify(taskIds: readonly string[]): Promise<ReadonlyMap<string, TaskClassification>> {
    const result = new Map<string, TaskClassification>(taskIds.map((id) => [id, { kind: "MANUAL" }]));
    const runtimes = await this.selectIn("content_task_runtime", "task_id,task_type_version_id,source_task_id", "task_id", taskIds);
    if (!runtimes.length) return result;
    const codes = await this.codesFor(runtimes);

    // Lineage both ways: a Head Review's source Blog, and a Blog's Head Review.
    const blogIds = runtimes.filter((r) => codes.get(String(r.task_id)) === "BLOG").map((r) => String(r.task_id));
    const children = await this.selectIn("content_task_runtime", "task_id,task_type_version_id,source_task_id", "source_task_id", blogIds);
    const childCodes = await this.codesFor(children);
    const reviewOfBlog = new Map(children.filter((c) => childCodes.get(String(c.task_id)) === "HEAD_REVIEW").map((c) => [String(c.source_task_id), String(c.task_id)]));
    const sourceIds = runtimes.filter((r) => codes.get(String(r.task_id)) === "HEAD_REVIEW" && r.source_task_id).map((r) => String(r.source_task_id));
    const tasks = await this.selectIn("tasks", "id,assignee_id,status", "id", [...blogIds, ...sourceIds, ...reviewOfBlog.values()]);
    const taskById = new Map(tasks.map((t) => [String(t.id), t]));

    for (const runtime of runtimes) {
      const taskId = String(runtime.task_id);
      const code = codes.get(taskId) ?? "";
      const sourceTaskId = runtime.source_task_id ? String(runtime.source_task_id) : null;
      if (code === "HEAD_REVIEW") {
        const blog = sourceTaskId ? taskById.get(sourceTaskId) : undefined;
        result.set(taskId, {
          kind: "CONTENT_OS", code, sourceTaskId,
          blogAuthorId: blog ? String(blog.assignee_id) : null,
          sourceStatus: blog ? String(blog.status) as TaskBackendStatus : null,
          reviewerId: null,
        });
      } else if (code === "BLOG") {
        const reviewTaskId = reviewOfBlog.get(taskId);
        const review = reviewTaskId ? taskById.get(reviewTaskId) : undefined;
        result.set(taskId, {
          kind: "CONTENT_OS", code, sourceTaskId,
          blogAuthorId: taskById.get(taskId) ? String(taskById.get(taskId)!.assignee_id) : null,
          sourceStatus: null,
          reviewerId: review ? String(review.assignee_id) : null,
        });
      } else {
        result.set(taskId, { kind: "CONTENT_OS", code, sourceTaskId, blogAuthorId: null, sourceStatus: null, reviewerId: null });
      }
    }
    return result;
  }
}
