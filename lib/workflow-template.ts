/**
 * Workflow Template model (V1 Sprint 1): connects Task Types into a
 * reusable, ordered, dependency-aware sequence.
 *
 * Boundary with existing code (per audit instruction -- no competing
 * concepts): lib/production-types.ts's `WorkflowStepDefinition` is the
 * read-only `25_WORKFLOW_STEPS` Sheet projection, loaded but never consumed
 * beyond that (same as TaskTemplateDefinition -- confirmed dead code path).
 * lib/material-workplan.ts's `WorkItem`/`calculateWorkPlan` is a DERIVED,
 * hardcoded-pipeline preview computation (the step/template IDs like
 * "WF-BLOG"/"BLOG-02"/"TT-02" are literal string constants baked into that
 * function's body, not loaded from any editable model) -- it stays exactly
 * as it is and is not touched or extended this sprint. WorkflowTemplate/
 * WorkflowStep here are the new, actually-editable, UI-authored
 * configuration layer; nothing here feeds into or reads from either legacy
 * type this sprint.
 */

import type { AssigneeRule, FieldDefinition, RecommendedDay } from "./task-type";

export const WORKFLOW_TEMPLATE_CONTRACT_VERSION = "v1.workflow-template.v1";

export const MODULE_TYPES = [
  "KNOWLEDGE_DEVELOPMENT",
  "RESEARCH",
  "BLOG",
  "REEL_PRODUCTION",
  "CAROUSEL_PRODUCTION",
  "YOUTUBE_PRODUCTION",
  "DESTINATION_CREATION",
  "PERFORMANCE",
  "DISTRIBUTION",
  "LEARNING",
  "OTHER",
] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export interface StepOverride {
  readonly assigneeRule?: AssigneeRule;
  readonly recommendedDay?: RecommendedDay | null;
  readonly reviewRequired?: boolean;
  readonly additionalRequiredFields?: readonly FieldDefinition[];
}

export interface WorkflowStep {
  readonly id: string;
  /** Back-reference to the owning WorkflowTemplate.id, kept denormalized on
   * the step so validation and step-level lookups do not need the parent
   * template threaded through every call. */
  readonly templateId: string;
  /** References TaskType.id. A step is never a copy of a TaskType -- it
   * only points at one, plus optional narrow overrides. */
  readonly taskTypeId: string;
  readonly nameTemplate: string;
  /** Other WorkflowStep.id values within the same template. */
  readonly dependsOn: readonly string[];
  /** Whether a step that depends on this one must wait for it to reach
   * DONE before starting. Meaningless (and flagged) on a step nothing
   * currently depends on. */
  readonly blocking: boolean;
  readonly skippable: boolean;
  readonly overrides?: StepOverride;
  readonly order: number;
}

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly moduleType: ModuleType;
  readonly version: number;
  readonly isActive: boolean;
  readonly steps: readonly WorkflowStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowTemplateDraft = Omit<WorkflowTemplate, "id" | "version" | "isActive" | "steps" | "createdAt" | "updatedAt">;

function stableId(prefix: string, seed: string, now: () => string): string {
  const slug = seed.trim().toLocaleLowerCase("uz").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || prefix;
  return `${prefix}-${slug}-${now().replace(/[^0-9]/g, "").slice(-8)}`;
}

export function createWorkflowTemplate(draft: WorkflowTemplateDraft, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  const timestamp = now();
  return { ...draft, id: stableId("wf", draft.name, now), version: 1, isActive: true, steps: [], createdAt: timestamp, updatedAt: timestamp };
}

export function reviseWorkflowTemplate(current: WorkflowTemplate, changes: Partial<WorkflowTemplateDraft>, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  return { ...current, ...changes, version: current.version + 1, updatedAt: now() };
}

export function setWorkflowTemplateActive(current: WorkflowTemplate, isActive: boolean, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  if (current.isActive === isActive) return current;
  return { ...current, isActive, updatedAt: now() };
}

export type NewWorkflowStepInput = Omit<WorkflowStep, "id" | "templateId" | "order">;

export function addStep(template: WorkflowTemplate, input: NewWorkflowStepInput, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  const step: WorkflowStep = { ...input, id: stableId("step", input.nameTemplate, now), templateId: template.id, order: template.steps.length };
  return { ...template, steps: [...template.steps, step], updatedAt: now() };
}

export function removeStep(template: WorkflowTemplate, stepId: string, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  const remaining = template.steps.filter((step) => step.id !== stepId).map((step) => ({ ...step, dependsOn: step.dependsOn.filter((id) => id !== stepId) }));
  return { ...template, steps: reindex(remaining), updatedAt: now() };
}

export function updateStep(template: WorkflowTemplate, stepId: string, changes: Partial<NewWorkflowStepInput>, now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  return { ...template, steps: template.steps.map((step) => step.id === stepId ? { ...step, ...changes } : step), updatedAt: now() };
}

/** Reorders steps to match the given id order; ids not present keep their
 * relative order appended at the end (defensive -- never drops a step). */
export function reorderSteps(template: WorkflowTemplate, orderedStepIds: readonly string[], now: () => string = () => new Date().toISOString()): WorkflowTemplate {
  const byId = new Map(template.steps.map((step) => [step.id, step]));
  const inOrder = orderedStepIds.map((id) => byId.get(id)).filter((step): step is WorkflowStep => Boolean(step));
  const remaining = template.steps.filter((step) => !orderedStepIds.includes(step.id));
  return { ...template, steps: reindex([...inOrder, ...remaining]), updatedAt: now() };
}

function reindex(steps: readonly WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => ({ ...step, order: index }));
}

// --- Effective (step + TaskType, with overrides applied) ---

export function effectiveAssigneeRule(taskTypeDefault: AssigneeRule, step: WorkflowStep): AssigneeRule {
  return step.overrides?.assigneeRule ?? taskTypeDefault;
}

export function effectiveRecommendedDay(taskTypeDefault: RecommendedDay | null, step: WorkflowStep): RecommendedDay | null {
  return step.overrides?.recommendedDay !== undefined ? step.overrides.recommendedDay : taskTypeDefault;
}

export function effectiveReviewRequired(taskTypeDefault: boolean, step: WorkflowStep): boolean {
  return step.overrides?.reviewRequired ?? taskTypeDefault;
}

export function effectiveRequiredFields(taskTypeRequiredFields: readonly FieldDefinition[], step: WorkflowStep): readonly FieldDefinition[] {
  return [...taskTypeRequiredFields, ...(step.overrides?.additionalRequiredFields ?? [])];
}

// --- Validation ---

export type WorkflowValidationErrorCode =
  | "MISSING_NAME"
  | "MISSING_TASK_TYPE"
  | "DUPLICATE_STEP_ID"
  | "UNKNOWN_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "INVALID_BLOCKING_CONFIG";

export interface WorkflowValidationError {
  readonly code: WorkflowValidationErrorCode;
  readonly message: string;
  readonly stepId?: string;
}

/**
 * Pure. Never silently repairs a bad template -- always returns the full
 * list of problems found for the caller to act on.
 */
export function validateWorkflowTemplate(template: WorkflowTemplate, availableTaskTypeIds: ReadonlySet<string>): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!template.name.trim()) {
    errors.push({ code: "MISSING_NAME", message: "Workflow nomi kerak." });
  }

  const seenStepIds = new Set<string>();
  const duplicateStepIds = new Set<string>();
  for (const step of template.steps) {
    if (seenStepIds.has(step.id)) duplicateStepIds.add(step.id);
    seenStepIds.add(step.id);
  }
  for (const id of duplicateStepIds) {
    errors.push({ code: "DUPLICATE_STEP_ID", stepId: id, message: `Step ID takrorlangan: "${id}".` });
  }

  for (const step of template.steps) {
    if (!availableTaskTypeIds.has(step.taskTypeId)) {
      errors.push({ code: "MISSING_TASK_TYPE", stepId: step.id, message: `Step "${step.id}" noma'lum Task Type'ga ishora qiladi: "${step.taskTypeId}".` });
    }
    if (step.dependsOn.includes(step.id)) {
      errors.push({ code: "SELF_DEPENDENCY", stepId: step.id, message: `Step "${step.id}" o'z-o'ziga bog'liq bo'la olmaydi.` });
    }
  }

  const stepIds = new Set(template.steps.map((step) => step.id));
  for (const step of template.steps) {
    for (const dependencyId of step.dependsOn) {
      if (dependencyId !== step.id && !stepIds.has(dependencyId)) {
        errors.push({ code: "UNKNOWN_DEPENDENCY", stepId: step.id, message: `Step "${step.id}" noma'lum dependency'ga ishora qiladi: "${dependencyId}".` });
      }
    }
  }

  for (const id of detectCycleStepIds(template.steps)) {
    errors.push({ code: "DEPENDENCY_CYCLE", stepId: id, message: `Step "${id}" dependency sikliga kiradi.` });
  }

  const dependedOn = new Set(template.steps.flatMap((step) => step.dependsOn));
  for (const step of template.steps) {
    if (step.blocking && !dependedOn.has(step.id)) {
      errors.push({ code: "INVALID_BLOCKING_CONFIG", stepId: step.id, message: `Step "${step.id}" "blocking" deb belgilangan, lekin hech qaysi step unga bog'liq emas.` });
    }
  }

  return errors;
}

export function isWorkflowTemplateValid(template: WorkflowTemplate, availableTaskTypeIds: ReadonlySet<string>): boolean {
  return validateWorkflowTemplate(template, availableTaskTypeIds).length === 0;
}

/** DFS-based cycle detection over `dependsOn` edges restricted to known
 * step ids (an edge to an unknown id is reported separately as
 * UNKNOWN_DEPENDENCY, not followed here). Returns every step id that
 * participates in at least one cycle. */
function detectCycleStepIds(steps: readonly WorkflowStep[]): Set<string> {
  const edgesById = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const inCycle = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      for (const node of stack.slice(cycleStart)) inCycle.add(node);
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependencyId of edgesById.get(id) ?? []) {
      if (edgesById.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of edgesById.keys()) visit(id);
  return inCycle;
}
