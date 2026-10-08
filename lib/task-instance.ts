/**
 * Local Task Instance runtime model (V1 Sprint 2).
 *
 * Explicit boundary: a TaskInstance is a SESSION-ONLY local object. It is
 * NOT a row in marketing-team-task-bot's task backend and nothing here
 * calls TaskClient.create() or any Supabase write path. lib/task-client.ts
 * (`getTaskClient()` -> BlockedTaskClient) is untouched and still the only
 * way this codebase is allowed to reach a real task backend -- this file
 * does not call it, import it, or re-implement its contract. A TaskInstance
 * is the configuration layer (TaskType + WorkflowStep, from Sprint 1)
 * actually being *run* locally, nothing more.
 *
 * Status vocabulary is the existing, already-approved one (see spec):
 * ASSIGNED / IN_PROGRESS / BLOCKED / REVIEW / REVISION / DONE / CANCELLED.
 * No content-specific statuses are added. "Skip" is NOT a new status --
 * per instruction it is represented as status CANCELLED plus an `outcome`
 * metadata field ("SKIPPED" vs "COMPLETED"), so it stays distinguishable
 * from an ordinary cancellation and from DONE while still only using the
 * approved 7-value enum.
 */
import type { FieldDefinition, FieldType } from "./task-type";
import type { TaskLink } from "./task-link";

export const TASK_INSTANCE_STATUSES = ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"] as const;
export type TaskInstanceStatus = (typeof TASK_INSTANCE_STATUSES)[number];

export type TaskInstanceOutcome = "COMPLETED" | "SKIPPED";

export type FieldValue = string | number | boolean | readonly string[] | null;

/** Records where a field's value came from, when it was populated via
 * Context Transfer rather than typed in directly. Deliberately narrow --
 * one source task + one source field per transferred field, never a
 * generic "previous context" blob. */
export interface FieldProvenance {
  readonly fieldId: string;
  readonly sourceTaskId: string;
  readonly sourceFieldId: string;
}

/** A local note that a custom field an employee added to one instance
 * might be worth promoting into the Task Type itself. Sprint 2 only
 * records this -- it never mutates the TaskType and there is no Head
 * approval flow yet. */
export interface TemplateImprovementSuggestion {
  readonly id: string;
  readonly taskInstanceId: string;
  readonly taskTypeId: string;
  readonly field: FieldDefinition;
  readonly note: string;
  readonly createdAt: string;
}

export interface TaskInstance {
  readonly id: string;
  readonly taskTypeId: string;
  readonly workflowTemplateId: string | null;
  readonly workflowStepId: string | null;
  readonly title: string;
  readonly assignee: string | null;
  readonly deadline: string | null;
  readonly status: TaskInstanceStatus;
  readonly fieldValues: Readonly<Record<string, FieldValue>>;
  /** Instance-only field definitions (section 5: "Custom Fields"). Never
   * written back onto the TaskType. */
  readonly customFields: readonly FieldDefinition[];
  readonly links: readonly TaskLink[];
  readonly sourceTaskId: string | null;
  readonly skipReason: string | null;
  /** null while still open; set exactly once, when the instance leaves
   * ASSIGNED/IN_PROGRESS/BLOCKED/REVIEW/REVISION via Complete or Skip. */
  readonly outcome: TaskInstanceOutcome | null;
  readonly fieldProvenance: readonly FieldProvenance[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `fieldProvenance` is optional and only meaningful at creation time for a
 * Context Transfer result (section 11/12) -- it defaults to empty, never
 * guessed or back-filled later. */
export type TaskInstanceDraft = Omit<
  TaskInstance,
  "id" | "status" | "outcome" | "skipReason" | "fieldProvenance" | "createdAt" | "updatedAt"
> & { readonly fieldProvenance?: readonly FieldProvenance[] };

function stableInstanceId(now: () => string): string {
  return `ti-${now().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createTaskInstance(draft: TaskInstanceDraft, now: () => string = () => new Date().toISOString()): TaskInstance {
  const timestamp = now();
  return {
    ...draft,
    fieldProvenance: draft.fieldProvenance ?? [],
    id: stableInstanceId(now),
    status: "ASSIGNED",
    outcome: null,
    skipReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function isTaskInstanceSettled(instance: TaskInstance): boolean {
  return instance.status === "DONE" || (instance.status === "CANCELLED" && instance.outcome === "SKIPPED");
}

export function setTaskInstanceStatus(instance: TaskInstance, status: TaskInstanceStatus, now: () => string = () => new Date().toISOString()): TaskInstance {
  if (instance.status === status) return instance;
  return { ...instance, status, updatedAt: now() };
}

export function setTaskInstanceFieldValue(instance: TaskInstance, fieldId: string, value: FieldValue, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, fieldValues: { ...instance.fieldValues, [fieldId]: value }, updatedAt: now() };
}

export function addCustomFieldToInstance(instance: TaskInstance, field: FieldDefinition, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, customFields: [...instance.customFields, field], updatedAt: now() };
}

export function removeCustomFieldFromInstance(instance: TaskInstance, fieldId: string, now: () => string = () => new Date().toISOString()): TaskInstance {
  const remainingValues = { ...instance.fieldValues };
  delete remainingValues[fieldId];
  return { ...instance, customFields: instance.customFields.filter((field) => field.id !== fieldId), fieldValues: remainingValues, updatedAt: now() };
}

/** Section 12: when a transferred value is edited, the caller decides
 * whether to also write the new value back onto the source instance --
 * this function only updates the target; writing the source back (if
 * chosen) is a second, separate `setTaskInstanceFieldValue` call by the
 * caller against the source instance. This keeps provenance bookkeeping
 * (sourceTaskId/sourceFieldId) explicit instead of inventing a history
 * table. */
export function editTransferredFieldValue(instance: TaskInstance, fieldId: string, value: FieldValue, now: () => string = () => new Date().toISOString()): TaskInstance {
  return setTaskInstanceFieldValue(instance, fieldId, value, now);
}

export function provenanceForField(instance: TaskInstance, fieldId: string): FieldProvenance | undefined {
  return instance.fieldProvenance.find((entry) => entry.fieldId === fieldId);
}

export function markTaskInstanceDone(instance: TaskInstance, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, status: "DONE", outcome: "COMPLETED", updatedAt: now() };
}

export function skipTaskInstance(instance: TaskInstance, skipReason: string, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, status: "CANCELLED", outcome: "SKIPPED", skipReason, updatedAt: now() };
}

// --- Completion validation (section 8) ---

export type CompletionValidationErrorCode = "MISSING_REQUIRED_FIELD" | "INVALID_FIELD_VALUE" | "MISSING_DEADLINE";

export interface CompletionValidationError {
  readonly code: CompletionValidationErrorCode;
  readonly fieldId?: string;
  readonly message: string;
}

/** Pure, by-type validation for one field's current value. Returns a
 * human-useful message, or null if the value is acceptable for this
 * field's type (ignoring required-ness -- that's checked separately so an
 * empty optional field is never flagged here). */
export function validateFieldValueByType(field: FieldDefinition, value: FieldValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (field.type) {
    case "TEXT":
    case "LONG_TEXT":
      return typeof value === "string" ? null : `"${field.label}" matn bo'lishi kerak.`;
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value) ? null : `"${field.label}" raqam bo'lishi kerak.`;
    case "BOOLEAN":
      return typeof value === "boolean" ? null : `"${field.label}" ha/yo'q qiymat bo'lishi kerak.`;
    case "DATE":
    case "DATETIME":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : `"${field.label}" to'g'ri sana bo'lishi kerak.`;
    case "URL":
      return typeof value === "string" && isHttpUrl(value) ? null : `"${field.label}" to'g'ri URL bo'lishi kerak (http:// yoki https://).`;
    case "SELECT": {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      return typeof value === "string" && allowed.has(value) ? null : `"${field.label}" uchun ruxsat etilgan variant tanlang.`;
    }
    case "MULTI_SELECT": {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      return Array.isArray(value) && value.every((item) => allowed.has(item)) ? null : `"${field.label}" uchun ruxsat etilgan variantlardan tanlang.`;
    }
    default:
      return null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isFieldValueEmpty(field: FieldDefinition, value: FieldValue): boolean {
  if (value === null || value === undefined) return true;
  if (field.type === "MULTI_SELECT") return !Array.isArray(value) || value.length === 0;
  if (field.type === "BOOLEAN") return false; // false is a real, complete answer
  return value === "";
}

/**
 * Pure. Returns every reason Complete should currently be blocked:
 * missing required fields (Task Type's own + this instance's required
 * custom fields), any field (required or filled-in optional) whose value
 * doesn't match its declared type, and a missing deadline.
 */
export function validateTaskInstanceForCompletion(instance: TaskInstance, requiredFields: readonly FieldDefinition[]): CompletionValidationError[] {
  const errors: CompletionValidationError[] = [];
  const allFields = [...requiredFields, ...instance.customFields];

  for (const field of allFields) {
    const value = instance.fieldValues[field.id] ?? null;
    if (field.required && isFieldValueEmpty(field, value)) {
      errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: field.id, message: `"${field.label}" to'ldirilishi shart.` });
      continue;
    }
    const typeError = validateFieldValueByType(field, value);
    if (typeError) errors.push({ code: "INVALID_FIELD_VALUE", fieldId: field.id, message: typeError });
  }

  if (!instance.deadline) {
    errors.push({ code: "MISSING_DEADLINE", message: "Deadline belgilanishi shart." });
  }

  return errors;
}

export function canCompleteTaskInstance(instance: TaskInstance, requiredFields: readonly FieldDefinition[]): boolean {
  return validateTaskInstanceForCompletion(instance, requiredFields).length === 0;
}

// --- "Suggest as template improvement" (section 5) ---

export function createTemplateImprovementSuggestion(
  input: { taskInstanceId: string; taskTypeId: string; field: FieldDefinition; note: string },
  now: () => string = () => new Date().toISOString(),
): TemplateImprovementSuggestion {
  return { id: `sugg-${now().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now(), ...input };
}

export function newCustomFieldId(): string {
  return `custom-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyCustomField(type: FieldType = "TEXT"): FieldDefinition {
  return { id: newCustomFieldId(), label: "", type, required: false };
}
