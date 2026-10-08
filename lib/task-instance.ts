/**
 * Local Task Instance runtime model (V1 Sprint 2, extended Sprint 3).
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
import type { AtomicIdeaCoverageType, AtomicIdeaDecision, ContentEntityRef, MaterialFormat } from "./content-entity";

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

/**
 * A Repurpose Map AtomicIdea's in-progress, pre-confirmation state (V1
 * Sprint 4): the employee builds this list directly inside the open
 * Repurpose Map task (same spot as customFields/links -- a dedicated
 * typed array on TaskInstance, not squeezed into the restrictive
 * `FieldValue` union). Minimum Coverage Validation (section 13) reads
 * this list at Complete time; once Complete succeeds, each draft becomes
 * one real `AtomicIdea` content entity (see content-workflow.ts). No
 * Treatment field, no Format Fit scoring (deliberately not built).
 */
export interface AtomicIdeaDraft {
  readonly id: string;
  readonly text: string;
  readonly coverageType: AtomicIdeaCoverageType;
  readonly decision: AtomicIdeaDecision;
  readonly selectedFormats: readonly MaterialFormat[];
  readonly angleId: string | null;
  readonly destinationNeeded: boolean;
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
  /** Section 7: a typed pointer to the one Content OS entity this task
   * primarily operates on (e.g. a Blog task's KnowledgeNode). This is the
   * local stand-in for the future `content_task_links` bridge -- never a
   * DB table this sprint, and never `tasks.content_ref`. */
  readonly contentRef: ContentEntityRef | null;
  /** Narrow, justified exception to "one primary ref": a Research task can
   * cover several KnowledgeNodes sharing one research artifact (section
   * 10/11.1) -- the preview that follows Research needs to know all of
   * them, not just one. Every other Task Type leaves this empty and uses
   * `contentRef` alone. */
  readonly relatedEntityRefs: readonly ContentEntityRef[];
  /** Only ever populated on a "Repurpose Map" task; empty for every
   * other Task Type. See AtomicIdeaDraft's doc comment. */
  readonly atomicIdeaDrafts: readonly AtomicIdeaDraft[];
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
 * guessed or back-filled later. `contentRef`/`relatedEntityRefs` default to
 * null/empty for any task not yet wired to the content entity model. */
export type TaskInstanceDraft = Omit<
  TaskInstance,
  "id" | "status" | "outcome" | "skipReason" | "fieldProvenance" | "createdAt" | "updatedAt" | "contentRef" | "relatedEntityRefs" | "atomicIdeaDrafts"
> & {
  readonly fieldProvenance?: readonly FieldProvenance[];
  readonly contentRef?: ContentEntityRef | null;
  readonly relatedEntityRefs?: readonly ContentEntityRef[];
  readonly atomicIdeaDrafts?: readonly AtomicIdeaDraft[];
};

function stableInstanceId(now: () => string): string {
  return `ti-${now().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createTaskInstance(draft: TaskInstanceDraft, now: () => string = () => new Date().toISOString()): TaskInstance {
  const timestamp = now();
  return {
    ...draft,
    fieldProvenance: draft.fieldProvenance ?? [],
    contentRef: draft.contentRef ?? null,
    relatedEntityRefs: draft.relatedEntityRefs ?? [],
    atomicIdeaDrafts: draft.atomicIdeaDrafts ?? [],
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

function newAtomicIdeaDraftId(): string {
  return `idea-draft-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyAtomicIdeaDraft(): AtomicIdeaDraft {
  return { id: newAtomicIdeaDraftId(), text: "", coverageType: "OTHER", decision: "LATER", selectedFormats: [], angleId: null, destinationNeeded: false };
}

export function addAtomicIdeaDraft(instance: TaskInstance, draft: AtomicIdeaDraft, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, atomicIdeaDrafts: [...instance.atomicIdeaDrafts, draft], updatedAt: now() };
}

export function updateAtomicIdeaDraft(instance: TaskInstance, draftId: string, changes: Partial<Omit<AtomicIdeaDraft, "id">>, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, atomicIdeaDrafts: instance.atomicIdeaDrafts.map((draft) => (draft.id === draftId ? { ...draft, ...changes } : draft)), updatedAt: now() };
}

export function removeAtomicIdeaDraft(instance: TaskInstance, draftId: string, now: () => string = () => new Date().toISOString()): TaskInstance {
  return { ...instance, atomicIdeaDrafts: instance.atomicIdeaDrafts.filter((draft) => draft.id !== draftId), updatedAt: now() };
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

/**
 * Section 3: completing the Angle task normally requires at least
 * `minimum` non-empty candidate lines in its free-text field (more are
 * always allowed -- this never caps the count). Only applies to a normal
 * Complete; the global Skip path never runs this (skip has no "minimum
 * output" concept, by design).
 */
export function validateMinimumCandidateLines(fieldValue: FieldValue, minimum: number, fieldLabel: string): CompletionValidationError[] {
  const lineCount = typeof fieldValue === "string" ? fieldValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length : 0;
  if (lineCount >= minimum) return [];
  return [{ code: "MISSING_REQUIRED_FIELD", message: `"${fieldLabel}" uchun kamida ${minimum} ta qator kerak (hozir ${lineCount} ta).` }];
}

/**
 * Section 13: when completing Repurpose Map normally, every CREATE_CONTENT
 * atomic idea decision together must cover all four of PROBLEM / CAUSE /
 * CONSEQUENCE / SOLUTION at least once. Not every idea needs to become
 * content -- only the ones already marked CREATE_CONTENT are checked.
 * The global Skip path (skipping the whole Repurpose Map task) never runs
 * this -- there is no second, Repurpose-specific skip system.
 */
export function validateAtomicIdeaCoverage(drafts: readonly AtomicIdeaDraft[]): CompletionValidationError[] {
  const covered = new Set(drafts.filter((d) => d.decision === "CREATE_CONTENT").map((d) => d.coverageType));
  const required: AtomicIdeaCoverageType[] = ["PROBLEM", "CAUSE", "CONSEQUENCE", "SOLUTION"];
  const missing = required.filter((type) => !covered.has(type));
  if (!missing.length) return [];
  return [{ code: "MISSING_REQUIRED_FIELD", message: `CREATE_CONTENT deb belgilangan g'oyalar quyidagi coverage turlarini qoplamaydi: ${missing.join(", ")}.` }];
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
