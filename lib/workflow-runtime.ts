/**
 * Workflow runtime engine (V1 Sprint 2, rewritten Sprint 3 for
 * multiplicity). Pure graph logic -- no React, no TaskClient, no Supabase.
 *
 * Sprint 2 bug (section 1): the original engine kept a single
 * `Map<stepId, TaskInstance>`, i.e. it assumed one WorkflowStep maps to at
 * most one TaskInstance. That's wrong for the real workflow -- one
 * Research task can produce many Blog tasks, one Repurpose Map can
 * produce many Reel/Carousel/Text Post tasks, one Shoot can produce many
 * Edit tasks. WorkflowStep stays the template-level DEFINITION (unchanged,
 * never duplicated per occurrence); TaskInstance.id is the runtime
 * identity of one occurrence -- it already existed and already is
 * globally unique (see task-instance.ts's `stableInstanceId`), so no new
 * "occurrenceId" field was needed, just fixing the engine to stop
 * collapsing many instances of the same step into one.
 *
 * Section 2's dependency rule: downstream generation is always resolved
 * relative to one concrete, already-settled SOURCE TaskInstance -- never
 * "the WorkflowStep in general" and never "every instance of this step is
 * complete". `getStepsGeneratedBy` walks only `sourceInstance`'s own
 * ancestor chain (via `sourceTaskId`), so a sibling instance of the same
 * step (e.g. a second, unrelated Research task) never affects this
 * computation.
 */
import { isTaskInstanceSettled, type FieldValue, type TaskInstance } from "./task-instance";
import type { WorkflowStep, WorkflowTemplate } from "./workflow-template";
import type { FieldDefinition, TaskType } from "./task-type";
import type { ContentEntityRef } from "./content-entity";

/** The steps with no dependencies at all -- the entry point(s) of a
 * template. Only returned if no instance of them exists yet (a template's
 * root step is still meant to be started once per run). */
export function getStartableSteps(template: WorkflowTemplate, instances: readonly TaskInstance[]): readonly WorkflowStep[] {
  const existingStepIds = new Set(instances.filter((i) => i.workflowTemplateId === template.id).map((i) => i.workflowStepId));
  return template.steps.filter((step) => step.dependsOn.length === 0 && !existingStepIds.has(step.id));
}

/** Walks `sourceTaskId` upward from `instance`, returning `instance`
 * itself followed by every ancestor found in `allInstances`. Stops at the
 * first missing/already-seen link -- never infinite, never guesses. */
function ancestorChain(instance: TaskInstance, allInstances: readonly TaskInstance[]): readonly TaskInstance[] {
  const byId = new Map(allInstances.map((i) => [i.id, i]));
  const chain: TaskInstance[] = [];
  const seen = new Set<string>();
  let current: TaskInstance | undefined = instance;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.sourceTaskId ? byId.get(current.sourceTaskId) : undefined;
  }
  return chain;
}

/**
 * The template steps that `sourceInstance`'s settlement (DONE or skipped)
 * directly unlocks, resolved against `sourceInstance`'s own lineage only.
 * `sourceInstance` is expected to already be the settled version (callers
 * simulate this before the real Complete/Skip is dispatched, same as
 * Sprint 2). A candidate step is unlocked when:
 *
 *  - it lists `sourceInstance.workflowStepId` in `dependsOn`, and
 *  - every OTHER step it depends on that is itself `blocking: true` has a
 *    settled instance somewhere in this same lineage (not merely
 *    anywhere in the whole instance list).
 *
 * This never surfaces anything beyond one hop, and never treats "some
 * other instance of this step is done" as satisfying a dependency.
 */
export function getStepsGeneratedBy(
  template: WorkflowTemplate,
  allInstances: readonly TaskInstance[],
  sourceInstance: TaskInstance,
): readonly WorkflowStep[] {
  if (!sourceInstance.workflowStepId) return [];
  const stepsById = new Map(template.steps.map((step) => [step.id, step]));
  const chain = ancestorChain(sourceInstance, allInstances);
  const settledStepIdsInLineage = new Set(
    chain.filter(isTaskInstanceSettled).map((i) => i.workflowStepId).filter((id): id is string => Boolean(id)),
  );

  return template.steps.filter((step) => {
    if (!step.dependsOn.includes(sourceInstance.workflowStepId as string)) return false;
    return step.dependsOn.every((dependencyId) => {
      const dependencyStep = stepsById.get(dependencyId);
      if (!dependencyStep?.blocking) return true;
      return settledStepIdsInLineage.has(dependencyId);
    });
  });
}

// --- Draft construction for a newly-generated step occurrence ---

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
  readonly contentRef: ContentEntityRef | null;
  readonly relatedEntityRefs: readonly ContentEntityRef[];
}

function placeholderAssignee(taskType: TaskType): string | null {
  return taskType.defaultAssigneeRule.kind === "FIXED_ROLE" ? taskType.defaultAssigneeRule.role : null;
}

/** Builds the starting point for one Generated Preview row/candidate.
 * Deadline is intentionally left null -- the employee sets it in Preview,
 * nothing here guesses one. `contentRef`/`relatedEntityRefs` default to
 * null/empty; callers that know which content entity this occurrence
 * operates on (section 7) pass it in. */
export function buildTaskInstanceSeed(
  step: WorkflowStep,
  taskType: TaskType,
  sourceTaskId: string | null,
  contentRef: ContentEntityRef | null = null,
  relatedEntityRefs: readonly ContentEntityRef[] = [],
): TaskInstanceSeed {
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
    contentRef,
    relatedEntityRefs,
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
