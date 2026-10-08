/**
 * Workflow runtime engine (V1 Sprint 2): turns a configured WorkflowTemplate
 * (Sprint 1) plus the current set of local TaskInstances into "which steps
 * are eligible to run right now." Pure graph logic -- no React, no
 * TaskClient, no Supabase.
 *
 * Eligibility rule (section 10): a step is eligible once every dependency
 * that is itself marked `blocking: true` has a SETTLED instance (DONE, or
 * CANCELLED+SKIPPED -- see task-instance.ts). A non-blocking dependency
 * never gates its dependents; this is what lets Blog's branches (Head
 * Review / SEO / Angle / Performance Consultation) all become eligible in
 * parallel as soon as Blog is done, while Repurpose Map -- which depends
 * on Head Review, itself `blocking: true` -- stays ineligible until Head
 * Review is settled, independently of SEO/Angle/Performance Consultation.
 *
 * Only IMMEDIATE next steps are ever surfaced: a step that already has an
 * instance (whatever its status) is never re-surfaced, and nothing beyond
 * one hop is pre-created or pre-computed.
 */
import { isTaskInstanceSettled, type FieldValue, type TaskInstance } from "./task-instance";
import type { WorkflowStep, WorkflowTemplate } from "./workflow-template";
import type { FieldDefinition, TaskType } from "./task-type";

function instanceByStepId(template: WorkflowTemplate, instances: readonly TaskInstance[]): Map<string, TaskInstance> {
  const map = new Map<string, TaskInstance>();
  for (const instance of instances) {
    if (instance.workflowTemplateId === template.id && instance.workflowStepId) {
      map.set(instance.workflowStepId, instance);
    }
  }
  return map;
}

/** All steps in `template` that have no instance yet and whose blocking
 * dependencies are all settled. Does not look beyond one hop and never
 * mutates `instances`. */
export function getEligibleNextSteps(template: WorkflowTemplate, instances: readonly TaskInstance[]): readonly WorkflowStep[] {
  const byStepId = instanceByStepId(template, instances);
  const stepsById = new Map(template.steps.map((step) => [step.id, step]));

  function isStepSettled(stepId: string): boolean {
    const instance = byStepId.get(stepId);
    return Boolean(instance && isTaskInstanceSettled(instance));
  }

  return template.steps.filter((step) => {
    if (byStepId.has(step.id)) return false;
    const blockingDependencyIds = step.dependsOn.filter((dependencyId) => stepsById.get(dependencyId)?.blocking);
    return blockingDependencyIds.every(isStepSettled);
  });
}

/** The subset of `getEligibleNextSteps` that a given step's completion/skip
 * directly unlocked -- i.e. steps that list it in `dependsOn`. This is what
 * Generated Task Preview shows after Complete, never the whole template. */
export function getImmediateNextStepsAfterSettlement(
  template: WorkflowTemplate,
  instances: readonly TaskInstance[],
  settledStepId: string,
): readonly WorkflowStep[] {
  return getEligibleNextSteps(template, instances).filter((step) => step.dependsOn.includes(settledStepId));
}

/** The steps with no dependencies at all -- the entry point(s) of a
 * template, used by "start workflow" (section 16). Only returned if they
 * don't already have an instance. */
export function getStartableSteps(template: WorkflowTemplate, instances: readonly TaskInstance[]): readonly WorkflowStep[] {
  const byStepId = instanceByStepId(template, instances);
  return template.steps.filter((step) => step.dependsOn.length === 0 && !byStepId.has(step.id));
}

// --- Draft construction for a newly-eligible step ---

export interface TaskInstanceSeed {
  readonly taskTypeId: string;
  readonly workflowTemplateId: string;
  readonly workflowStepId: string;
  readonly title: string;
  readonly assignee: string | null;
  readonly deadline: string | null;
  readonly fieldValues: Readonly<Record<string, FieldValue>>;
  readonly customFields: readonly FieldDefinition[];
  readonly links: readonly [];
  readonly sourceTaskId: string | null;
}

function placeholderAssignee(taskType: TaskType): string | null {
  return taskType.defaultAssigneeRule.kind === "FIXED_ROLE" ? taskType.defaultAssigneeRule.role : null;
}

/** Builds the starting point for a Generated Task Preview row. Deadline is
 * intentionally left null -- the employee sets it in Preview (section 9),
 * nothing here guesses one. */
export function buildTaskInstanceSeed(step: WorkflowStep, taskType: TaskType, sourceTaskId: string | null): TaskInstanceSeed {
  return {
    taskTypeId: taskType.id,
    workflowTemplateId: step.templateId,
    workflowStepId: step.id,
    title: step.nameTemplate,
    assignee: placeholderAssignee(taskType),
    deadline: null,
    fieldValues: {},
    customFields: [],
    links: [],
    sourceTaskId,
  };
}

// --- Context transfer (section 11) ---

export interface TransferCandidate {
  readonly sourceFieldId: string;
  readonly label: string;
  readonly value: FieldValue;
}

/** Every field on the source instance that currently has a non-empty
 * value, available to (optionally) transfer. Never includes a
 * "everything" option -- the caller always maps one candidate to one
 * destination field, one at a time. */
export function buildTransferCandidates(sourceInstance: TaskInstance, sourceTaskType: TaskType): readonly TransferCandidate[] {
  const fieldsById = new Map(
    [...sourceTaskType.requiredFields, ...sourceTaskType.optionalFields, ...sourceInstance.customFields].map((field) => [field.id, field]),
  );
  const candidates: TransferCandidate[] = [];
  for (const [fieldId, value] of Object.entries(sourceInstance.fieldValues)) {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const field = fieldsById.get(fieldId);
    if (!field) continue;
    candidates.push({ sourceFieldId: fieldId, label: field.label, value });
  }
  return candidates;
}

export function destinationFieldsForTaskType(taskType: TaskType): readonly FieldDefinition[] {
  return [...taskType.requiredFields, ...taskType.optionalFields];
}

export interface TransferSelection {
  readonly sourceFieldId: string;
  readonly destinationFieldId: string;
}

/** Applies exactly the selected, mapped transfers onto a seed's
 * fieldValues, plus the matching provenance records. Unselected or
 * unmapped candidates are never applied -- there is no "transfer
 * everything" path. */
export function applyContextTransfer(
  seed: TaskInstanceSeed,
  sourceInstance: TaskInstance,
  selections: readonly TransferSelection[],
): { fieldValues: Readonly<Record<string, FieldValue>>; fieldProvenance: ReadonlyArray<{ fieldId: string; sourceTaskId: string; sourceFieldId: string }> } {
  const fieldValues: Record<string, FieldValue> = { ...seed.fieldValues };
  const fieldProvenance: Array<{ fieldId: string; sourceTaskId: string; sourceFieldId: string }> = [];
  for (const selection of selections) {
    if (!(selection.sourceFieldId in sourceInstance.fieldValues)) continue;
    fieldValues[selection.destinationFieldId] = sourceInstance.fieldValues[selection.sourceFieldId];
    fieldProvenance.push({ fieldId: selection.destinationFieldId, sourceTaskId: sourceInstance.id, sourceFieldId: selection.sourceFieldId });
  }
  return { fieldValues, fieldProvenance };
}
