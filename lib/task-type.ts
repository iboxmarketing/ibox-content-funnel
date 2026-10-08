/**
 * Task Type Library (V1 Sprint 1): the reusable, Head-managed configuration
 * unit describing what one kind of task requires to be considered
 * complete -- required fields, its one default prompt, who it's assigned
 * to by default, and what "done" means for it.
 *
 * This is a new, local/config-only model. It is NOT wired to
 * marketing-team-task-bot yet (no task is created from it this sprint) and
 * it does NOT replace lib/production-types.ts's `TaskTemplateDefinition`:
 * that type is a read-only projection of the Google Sheet tab
 * `23_TASK_TEMPLATES`, loaded into `ProductionDataset` but never consumed
 * by any component or lib function today beyond that loading (confirmed:
 * no `.taskTemplates` read exists outside google-sheets.ts/
 * production-types.ts). TaskType is the editable, UI-authored successor
 * this sprint introduces; `TaskTemplateDefinition` stays exactly as it is,
 * as the legacy Sheet-schema type.
 */

export const TASK_TYPE_CONTRACT_VERSION = "v1.task-type.v1";

export const FIELD_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "SELECT", "MULTI_SELECT", "BOOLEAN", "DATE", "DATETIME", "URL"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Only meaningful for SELECT/MULTI_SELECT; validated accordingly. */
  readonly options?: readonly FieldOption[];
  readonly helpTextUz?: string;
  readonly defaultValue?: string | number | boolean | null;
}

/**
 * Deliberately not a conditional/rule engine yet (per spec: "do not
 * over-engineer conditional fields"). Three plain cases.
 */
export type AssigneeRule =
  | { readonly kind: "DEFAULT_CONTENT_OWNER" }
  | { readonly kind: "FIXED_ROLE"; readonly role: string }
  | { readonly kind: "MANUAL" };

export const RECOMMENDED_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type RecommendedDay = (typeof RECOMMENDED_DAYS)[number];

export interface CompletionRequirement {
  readonly id: string;
  readonly labelUz: string;
  /** References a FieldDefinition.id in requiredFields or optionalFields on
   * the same TaskType when this requirement means "this field must be
   * filled in". Null for a free-standing checklist-style requirement with
   * no backing field. */
  readonly requiresFieldId: string | null;
}

export interface TaskType {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredFields: readonly FieldDefinition[];
  readonly optionalFields: readonly FieldDefinition[];
  /**
   * One default prompt per Task Type. Head-managed conceptually -- no
   * employee prompt variants exist in this model. Distinct from
   * lib/assistant-context.ts's `AssistantDefinition`, which is the CO-S4
   * "AI tool directory" concept (8 floating assistants with their own
   * registry, modes, examples). This field is a plain prompt template
   * string owned by exactly one TaskType, not a reference into that
   * registry -- the two concepts are not merged in this sprint.
   */
  readonly defaultPrompt: string | null;
  readonly promptVersion: string | null;
  readonly defaultAssigneeRule: AssigneeRule;
  readonly recommendedDay: RecommendedDay | null;
  readonly reviewRequired: boolean;
  /** Sprint 6: which review a `reviewRequired` task is. DRAFT/concept (the
   * default) only gates its own completion; FINAL is a final-asset review
   * -- while unresolved it blocks Publish for the Material it points at, but
   * never blocks creating a Distribution Plan. Pure configuration: nothing
   * hardcodes which formats need a final review. */
  readonly reviewStage?: "DRAFT" | "FINAL";
  readonly allowedLinkLabels: readonly string[];
  readonly completionRequirements: readonly CompletionRequirement[];
  readonly version: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TaskTypeDraft = Omit<TaskType, "id" | "version" | "isActive" | "createdAt" | "updatedAt">;

function stableId(prefix: string, seed: string, now: () => string): string {
  const slug = seed.trim().toLocaleLowerCase("uz").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task-type";
  return `${prefix}-${slug}-${now().replace(/[^0-9]/g, "").slice(-8)}`;
}

export function createTaskType(draft: TaskTypeDraft, now: () => string = () => new Date().toISOString()): TaskType {
  const timestamp = now();
  return {
    ...draft,
    id: stableId("tt", draft.name, now),
    version: 1,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function duplicateTaskType(source: TaskType, now: () => string = () => new Date().toISOString()): TaskType {
  const timestamp = now();
  return {
    ...structuredClone(source),
    id: stableId("tt", `${source.name}-copy`, now),
    name: `${source.name} (nusxa)`,
    version: 1,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function reviseTaskType(current: TaskType, changes: Partial<TaskTypeDraft>, now: () => string = () => new Date().toISOString()): TaskType {
  return {
    ...current,
    ...changes,
    version: current.version + 1,
    updatedAt: now(),
  };
}

export function setTaskTypeActive(current: TaskType, isActive: boolean, now: () => string = () => new Date().toISOString()): TaskType {
  if (current.isActive === isActive) return current;
  return { ...current, isActive, updatedAt: now() };
}

export type TaskTypeValidationErrorCode =
  | "MISSING_NAME"
  | "DUPLICATE_FIELD_ID"
  | "MISSING_FIELD_LABEL"
  | "SELECT_WITHOUT_OPTIONS"
  | "DUPLICATE_OPTION_VALUE"
  | "INVALID_COMPLETION_FIELD_REF"
  | "DUPLICATE_COMPLETION_REQUIREMENT_ID"
  | "PROMPT_WITHOUT_VERSION"
  | "FIXED_ROLE_WITHOUT_ROLE";

export interface TaskTypeValidationError {
  readonly code: TaskTypeValidationErrorCode;
  readonly message: string;
  readonly fieldId?: string;
}

/** Pure. Never mutates or "repairs" the input -- callers decide what to do
 * with a non-empty error list. */
export function validateTaskType(taskType: TaskType | TaskTypeDraft): TaskTypeValidationError[] {
  const errors: TaskTypeValidationError[] = [];

  if (!taskType.name.trim()) {
    errors.push({ code: "MISSING_NAME", message: "Task Type nomi kerak." });
  }

  const allFields = [...taskType.requiredFields, ...taskType.optionalFields];
  const seenFieldIds = new Set<string>();
  for (const field of allFields) {
    if (seenFieldIds.has(field.id)) {
      errors.push({ code: "DUPLICATE_FIELD_ID", fieldId: field.id, message: `Maydon ID takrorlangan: "${field.id}".` });
    }
    seenFieldIds.add(field.id);

    if (!field.label.trim()) {
      errors.push({ code: "MISSING_FIELD_LABEL", fieldId: field.id, message: `Maydon "${field.id}" uchun label kerak.` });
    }

    if (field.type === "SELECT" || field.type === "MULTI_SELECT") {
      if (!field.options || field.options.length === 0) {
        errors.push({ code: "SELECT_WITHOUT_OPTIONS", fieldId: field.id, message: `Maydon "${field.id}" (${field.type}) kamida bitta variant talab qiladi.` });
      } else {
        const seenOptions = new Set<string>();
        for (const option of field.options) {
          if (seenOptions.has(option.value)) {
            errors.push({ code: "DUPLICATE_OPTION_VALUE", fieldId: field.id, message: `Maydon "${field.id}"da variant qiymati takrorlangan: "${option.value}".` });
          }
          seenOptions.add(option.value);
        }
      }
    }
  }

  const seenRequirementIds = new Set<string>();
  for (const requirement of taskType.completionRequirements) {
    if (seenRequirementIds.has(requirement.id)) {
      errors.push({ code: "DUPLICATE_COMPLETION_REQUIREMENT_ID", message: `Completion requirement ID takrorlangan: "${requirement.id}".` });
    }
    seenRequirementIds.add(requirement.id);

    if (requirement.requiresFieldId && !seenFieldIds.has(requirement.requiresFieldId)) {
      errors.push({ code: "INVALID_COMPLETION_FIELD_REF", message: `Completion requirement "${requirement.id}" noma'lum maydonga ishora qiladi: "${requirement.requiresFieldId}".` });
    }
  }

  if (taskType.defaultPrompt && !taskType.promptVersion) {
    errors.push({ code: "PROMPT_WITHOUT_VERSION", message: "Default prompt mavjud bo'lsa, promptVersion ham kerak." });
  }

  if (taskType.defaultAssigneeRule.kind === "FIXED_ROLE" && !taskType.defaultAssigneeRule.role.trim()) {
    errors.push({ code: "FIXED_ROLE_WITHOUT_ROLE", message: "FIXED_ROLE qoidasi uchun rol nomi kerak." });
  }

  return errors;
}

export function isTaskTypeValid(taskType: TaskType | TaskTypeDraft): boolean {
  return validateTaskType(taskType).length === 0;
}
