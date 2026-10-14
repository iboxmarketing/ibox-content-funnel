/**
 * Persistence records for the Sprint 8 schema (supabase/content-os-drafts).
 * camelCase mirrors of the snake_case columns. Operational task state
 * (status, assignee, deadline, creator) is NOT here: it belongs to
 * public.tasks and is only ever read through OperationalTaskGateway.
 */
import type { ContentEntityType } from "../content-entity";
import type { FieldValue } from "../task-instance";
import type { TaskTypeCode } from "./task-type-codes";

export type TaskStatus = "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "REVISION" | "DONE" | "CANCELLED";

export interface KnowledgeNodeRecord {
  readonly id: string;
  readonly problemPartId: string;
  readonly name: string;
}

export interface BlogRecord {
  readonly id: string;
  readonly knowledgeNodeId: string;
  readonly title: string;
  readonly sourceTaskId: string | null;
}

/** content_task_type_versions joined with its identity's stable code. */
export interface TaskTypeVersionRecord {
  readonly id: string;
  readonly taskTypeId: string;
  readonly code: TaskTypeCode;
  readonly version: number;
  readonly reviewRequired: boolean;
}

/** content_workflow_steps: only what the transition contract reads. */
export interface WorkflowStepRecord {
  readonly id: string;
  readonly templateVersionId: string;
  /** Raw JSON object; `reviewRequired` is validated by the contract, never trusted. */
  readonly overrides: unknown;
}

/** content_task_runtime (PK = public.tasks.id). Provenance fields are write-once. */
export interface TaskRuntimeRecord {
  readonly taskId: string;
  readonly taskTypeVersionId: string;
  readonly workflowRunId: string | null;
  readonly workflowTemplateVersionId: string | null;
  readonly workflowStepId: string | null;
  readonly sourceTaskId: string | null;
  readonly outcome: "COMPLETED" | "SKIPPED" | null;
  readonly skipReason: string | null;
  readonly fieldValues: Readonly<Record<string, FieldValue>>;
}

export type TaskLinkRelation = "PRIMARY" | "RELATED";

/** content_task_links (PK task_id + entity_type + entity_id). Insert-only. */
export interface TaskLinkRecord {
  readonly taskId: string;
  readonly entityType: ContentEntityType;
  readonly entityId: string;
  readonly relation: TaskLinkRelation;
}

/** Read-only view of public.tasks (authoritative in the Task Bot). */
export interface OperationalTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly assigneeId: string;
  readonly creatorId: string;
}

/** Read-only view of public.users. */
export interface OperationalActor {
  readonly id: string;
  readonly role: string;
  readonly isActive: boolean;
}

export type IdempotencyPurpose = "CREATE_TASK" | "PUBLISH_CHECK" | "MATERIAL_LEARNING";

export interface CreateOperationalTaskInput {
  readonly purpose: IdempotencyPurpose;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly creatorId: string;
  readonly assigneeId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: "high" | "normal" | "low";
  /** ISO timestamp; public.tasks.deadline is NOT NULL. */
  readonly deadline: string;
}
