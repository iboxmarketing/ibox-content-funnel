/**
 * Task runtime handler registry (V1 Sprint 5, section 1).
 *
 * Sprint 4 special-cased Destination Decision and Repurpose Map with
 * `if (taskType.name === ...)` chains spread across TaskDetail and
 * WorkflowRunView. That doesn't scale to Shoot, Planning, Edit and the four
 * authoring Task Types, so ALL non-generic completion behavior now lives
 * here, registered in ONE place (`TASK_RUNTIME_HANDLERS`). UI files
 * resolve a handler by Task Type name and call it; they contain no
 * business-specific conditionals.
 *
 * A handler can optionally provide:
 *  - `validateCompletion`: extra rules beyond the generic required-field /
 *    type / deadline validation;
 *  - `complete`: the pure outcome of completing the task -- content-entity
 *    mutations, new TaskInstance drafts, an optional Generated Preview plan,
 *    and whether the task is marked DONE immediately or only once that
 *    plan is confirmed;
 *  - `uiBlock` / `hiddenFieldIds`: a key naming an extra Task Detail panel
 *    (the key -> component mapping lives in one UI file) and fields that
 *    panel owns, so the generic field loop must not render them twice.
 *
 * Any Task Type without a handler uses the normal workflow runtime
 * (`completeGeneric`): Generated Preview from the dependency graph, or a
 * plain completion when nothing further is unlocked.
 *
 * Still local/session only: no TaskClient, no Supabase, no
 * `tasks.content_ref`. Not a plugin system -- a plain typed lookup table.
 */
import {
  canCompleteTaskInstance,
  validateAtomicIdeaCoverage,
  validateMinimumCandidateLines,
  type CompletionValidationError,
  type TaskInstance,
  type TaskInstanceDraft,
} from "./task-instance";
import type { TaskType } from "./task-type";
import type { WorkflowTemplate } from "./workflow-template";
import { buildStandaloneTaskInstanceSeed } from "./workflow-runtime";
import { createRepurposeMap, ref, type CtaType, type Material } from "./content-entity";
import { blogsForNode, destinationsForProblemCategory, problemCategoryIdForMaterial, type ContentEntityAction, type ContentEntityState } from "./content-entity-store";
import {
  applyDestinationDecision,
  buildFormatPreviewPlan,
  buildPreviewPlan,
  buildChannelPublishPlan,
  buildRepublishFixPlan,
  buildShootProductionPlan,
  confirmAtomicIdeaDrafts,
  type PreviewPlan,
} from "./content-workflow";
import { validateMaterialCta, isVideoFormat } from "./material-production";
import {
  DISTRIBUTION_PLAN_TASK_TYPE_NAME,
  PUBLISH_SCHEDULE_TASK_TYPE_NAME,
  REPUBLISH_FIX_TASK_TYPE_NAME,
  getPublishBlockers,
  publishInfoOf,
  validatePublishCheck,
  validatePublishTask,
} from "./distribution";

export type TaskUiBlockKey = "DESTINATION_DECISION" | "REPURPOSE_MAP" | "MATERIAL_CTA" | "PUBLISH_CONTEXT";

export interface TaskRuntimeContext {
  readonly instance: TaskInstance;
  readonly taskType: TaskType;
  readonly template: WorkflowTemplate | null;
  readonly allInstances: readonly TaskInstance[];
  readonly taskTypesById: ReadonlyMap<string, TaskType>;
  readonly content: ContentEntityState;
}

export interface TaskRuntimeCompletionResult {
  readonly entityActions: readonly ContentEntityAction[];
  readonly taskDrafts: readonly TaskInstanceDraft[];
  /** A Generated Preview to show next, if any. */
  readonly plan: PreviewPlan | null;
  /** true: mark this task DONE right away. false: only once `plan` is
   * confirmed (so Cancel leaves the task open and untouched). */
  readonly completeNow: boolean;
}

export interface TaskRuntimeHandler {
  readonly uiBlock?: TaskUiBlockKey;
  readonly hiddenFieldIds?: readonly string[];
  readonly validateCompletion?: (context: TaskRuntimeContext) => CompletionValidationError[];
  readonly complete?: (context: TaskRuntimeContext, now: () => string) => TaskRuntimeCompletionResult;
  /** Entity mutations to apply when the task is SUBMITTED for review
   * (not on approval). Used so a Material can become distribution-ready
   * while its final asset review is still open -- Distribution planning
   * is allowed before final approval; only Publish is not. */
  readonly onSubmitForReview?: (context: TaskRuntimeContext) => ContentEntityAction[];
  /** Sprint 7: when this Task Type is a workflow's ROOT step, which content
   * entity the employee must pick on "Start workflow" (the task's
   * contentRef). Replaces the old view-level "first seeded Problem
   * Category" demo wiring. */
  readonly startsOn?: "PROBLEM_CATEGORY";
}

const NO_EFFECT: Omit<TaskRuntimeCompletionResult, "completeNow"> = { entityActions: [], taskDrafts: [], plan: null };

function settledCopy(instance: TaskInstance): TaskInstance {
  return { ...instance, status: "DONE", outcome: "COMPLETED" };
}

/** What the dependency graph unlocks after `context.instance` settles --
 * the normal workflow runtime, shared by generic completion and by every
 * handler that still wants the "what's next" check after its own effects. */
function followUpPlan(context: TaskRuntimeContext): PreviewPlan | null {
  if (!context.template || !context.instance.workflowStepId) return null;
  return buildPreviewPlan({
    template: context.template,
    allInstances: context.allInstances,
    settledSourceInstance: settledCopy(context.instance),
    sourceTaskType: context.taskType,
    taskTypesById: context.taskTypesById,
    contentEntities: context.content,
  });
}

/** Default behavior for any Task Type without a registered `complete`. */
export function completeGeneric(context: TaskRuntimeContext): TaskRuntimeCompletionResult {
  const plan = followUpPlan(context);
  return { ...NO_EFFECT, plan, completeNow: !plan };
}

function materialOf(context: TaskRuntimeContext): Material | null {
  const contentRef = context.instance.contentRef;
  if (!contentRef || contentRef.entityType !== "MATERIAL") return null;
  return context.content.materials.find((m) => m.id === contentRef.entityId) ?? null;
}

function taskTypeNamed(context: TaskRuntimeContext, name: string): TaskType | null {
  return [...context.taskTypesById.values()].find((t) => t.name === name) ?? null;
}

// --- Angle ---

const angleHandler: TaskRuntimeHandler = {
  validateCompletion: ({ instance }) => validateMinimumCandidateLines(instance.fieldValues["angles"] ?? null, 5, "Angles"),
};

// --- Destination Decision ---

const destinationDecisionHandler: TaskRuntimeHandler = {
  uiBlock: "DESTINATION_DECISION",
  hiddenFieldIds: ["create-new", "chosen-destination-id", "destination-type"],
  validateCompletion: ({ instance }) => {
    const createNew = instance.fieldValues["create-new"] === true;
    const chosen = typeof instance.fieldValues["chosen-destination-id"] === "string" ? instance.fieldValues["chosen-destination-id"] : "";
    if (!createNew && !chosen) return [{ code: "MISSING_REQUIRED_FIELD", message: "Mavjud destination tanlang yoki yangi yaratishni belgilang." }];
    if (createNew && !instance.fieldValues["destination-type"]) return [{ code: "MISSING_REQUIRED_FIELD", message: "Destination Type tanlanishi shart." }];
    return [];
  },
  complete: (context, now) => {
    const outcome = applyDestinationDecision(context.instance, context.content, context.taskTypesById, now);
    const entityActions: ContentEntityAction[] = [];
    if (outcome.destination) entityActions.push({ type: "ADD_DESTINATION", destination: outcome.destination });
    if (outcome.angleDestinationLinks.length) entityActions.push({ type: "ADD_ANGLE_DESTINATION_LINKS", links: outcome.angleDestinationLinks });
    // The decision itself is complete immediately; Repurpose Map's
    // eligibility is still checked normally afterward.
    return { entityActions, taskDrafts: outcome.firstTaskDraft ? [outcome.firstTaskDraft] : [], plan: followUpPlan(context), completeNow: true };
  },
};

// --- Repurpose Map ---

const repurposeMapHandler: TaskRuntimeHandler = {
  uiBlock: "REPURPOSE_MAP",
  validateCompletion: ({ instance }) => validateAtomicIdeaCoverage(instance.atomicIdeaDrafts),
  complete: (context, now) => {
    const nodeRef = context.instance.contentRef;
    const node = nodeRef?.entityType === "KNOWLEDGE_NODE" ? context.content.knowledgeNodes.find((n) => n.id === nodeRef.entityId) ?? null : null;
    const blog = node ? blogsForNode(context.content, node.id)[0] ?? null : null;
    if (!blog) return { ...NO_EFFECT, completeNow: true };
    const repurposeMap = createRepurposeMap(blog.id, context.instance.id, now);
    const ideas = confirmAtomicIdeaDrafts(repurposeMap.id, context.instance.atomicIdeaDrafts, now);
    const plan = buildFormatPreviewPlan(context.instance, blog.id, ideas, context.taskTypesById);
    return {
      entityActions: [{ type: "ADD_REPURPOSE_MAP", repurposeMap }, { type: "ADD_ATOMIC_IDEAS", ideas }],
      taskDrafts: [],
      plan,
      completeNow: !plan,
    };
  },
};

// --- Authoring: Reel Script / Carousel / Text Post / YouTube (sections 5-8) ---

function readCtaInput(instance: TaskInstance) {
  const ctaType = typeof instance.fieldValues["cta-type"] === "string" && instance.fieldValues["cta-type"] ? (instance.fieldValues["cta-type"] as CtaType) : null;
  const ctaText = typeof instance.fieldValues["cta-text"] === "string" ? instance.fieldValues["cta-text"] : "";
  const rawDestination = instance.fieldValues["cta-destination-id"];
  const destinationId = typeof rawDestination === "string" && rawDestination ? rawDestination : null;
  return { ctaType, ctaText, destinationId };
}

const authoringHandler: TaskRuntimeHandler = {
  uiBlock: "MATERIAL_CTA",
  hiddenFieldIds: ["cta-destination-id"],
  validateCompletion: (context) => {
    const material = materialOf(context);
    if (!material) return [];
    const categoryId = problemCategoryIdForMaterial(context.content, material);
    const destinations = categoryId ? destinationsForProblemCategory(context.content, categoryId) : [];
    return validateMaterialCta(material, readCtaInput(context.instance), destinations);
  },
  complete: (context, now) => {
    const material = materialOf(context);
    if (!material) return { ...NO_EFFECT, completeNow: true };
    const cta = readCtaInput(context.instance);
    if (!cta.ctaType) return { ...NO_EFFECT, completeNow: true };
    const entityActions: ContentEntityAction[] = [{ type: "SET_MATERIAL_CTA", id: material.id, ctaType: cta.ctaType, ctaText: cta.ctaText.trim(), destinationId: cta.destinationId }];
    const taskDrafts: TaskInstanceDraft[] = [];
    if (isVideoFormat(material.format)) {
      // REEL / YOUTUBE: authoring -> Planning ONLY. No Shoot/Edit/Cover yet.
      const planning = taskTypeNamed(context, "Planning");
      if (planning) taskDrafts.push(buildStandaloneTaskInstanceSeed(planning, `${planning.name} — ${material.title}`, context.instance.id, ref("MATERIAL", material.id)));
    } else {
      // CAROUSEL / TEXT_POST: authoring completion is the whole production
      // for now -- the Material becomes available for Distribution.
      entityActions.push({ type: "SET_MATERIAL_STATUS", id: material.id, status: "READY" });
    }
    void now;
    return { entityActions, taskDrafts, plan: null, completeNow: true };
  },
};

// --- Planning (section 9) ---

const planningHandler: TaskRuntimeHandler = {
  complete: () => {
    // Nothing to write: Ready-for-Shoot is derived from this Planning
    // task's own state (material-production.ts), so there is no second
    // copy that could go stale if Planning is reopened. Creating the
    // Shoot Session stays manual.
    return { ...NO_EFFECT, completeNow: true };
  },
};

// --- Shoot (sections 11-13) ---

const shootHandler: TaskRuntimeHandler = {
  complete: (context) => {
    const plan = buildShootProductionPlan(context.instance, context.content, context.taskTypesById);
    return { ...NO_EFFECT, plan, completeNow: !plan };
  },
};

// --- Edit (section 15-16): completion unlocks Distribution eligibility ---

const editHandler: TaskRuntimeHandler = {
  onSubmitForReview: (context) => {
    const material = materialOf(context);
    return material ? [{ type: "SET_MATERIAL_STATUS", id: material.id, status: "READY" }] : [];
  },
  complete: (context) => {
    const material = materialOf(context);
    const entityActions: ContentEntityAction[] = material ? [{ type: "SET_MATERIAL_STATUS", id: material.id, status: "READY" }] : [];
    return { entityActions, taskDrafts: [], plan: null, completeNow: true };
  },
};

// --- Distribution (Sprint 6) ---

const distributionPlanHandler: TaskRuntimeHandler = {
  complete: (context) => {
    const plan = buildChannelPublishPlan(context.instance, context.content, context.taskTypesById, PUBLISH_SCHEDULE_TASK_TYPE_NAME);
    return { ...NO_EFFECT, plan, completeNow: !plan };
  },
};

function publishBlockers(context: TaskRuntimeContext): string[] {
  const material = materialOf(context);
  if (!material) return [];
  return getPublishBlockers({ material, channel: publishInfoOf(context.instance).channel, content: context.content, instances: context.allInstances, taskTypesById: context.taskTypesById });
}

/** True once the Material already has a Material-level Result Review Date
 * (from an earlier successful channel or a manual edit). */
function materialHasResultReviewDate(context: TaskRuntimeContext): boolean {
  const material = materialOf(context);
  return Boolean(material && context.content.materialResultReviews.find((r) => r.materialId === material.id)?.resultReviewAt);
}

/** A confirmed successful publish: first one moves the Material to
 * PUBLISHED, and every one feeds the Material's single result review
 * (latest explicitly stated date wins; blank keeps the current one). */
function confirmedPublishActions(context: TaskRuntimeContext, material: Material | null): ContentEntityAction[] {
  if (!material) return [];
  const stated = context.instance.fieldValues["result-review-at"];
  return [
    { type: "SET_MATERIAL_STATUS", id: material.id, status: "PUBLISHED" },
    { type: "CONFIRM_MATERIAL_RESULT_REVIEW", materialId: material.id, resultReviewAt: typeof stated === "string" && stated ? stated : null, sourceTaskId: context.instance.id },
  ];
}

const publishScheduleHandler: TaskRuntimeHandler = {
  uiBlock: "PUBLISH_CONTEXT",
  hiddenFieldIds: ["channel"],
  validateCompletion: (context) => [
    ...validatePublishTask(context.instance, materialHasResultReviewDate(context)),
    ...publishBlockers(context).map((message): CompletionValidationError => ({ code: "INVALID_FIELD_VALUE", message })),
  ],
  complete: (context) => {
    const material = materialOf(context);
    const info = publishInfoOf(context.instance);
    // Recommended V1 rule: the FIRST channel confirmed published moves the
    // Material to PUBLISHED. An immediate publish is that confirmation;
    // a scheduled one is NOT (scheduled != published) -- its Publish Check
    // is.
    const entityActions = info.mode === "PUBLISH_NOW" ? confirmedPublishActions(context, material) : [];
    return { entityActions, taskDrafts: [], plan: null, completeNow: true };
  },
};

const publishCheckHandler: TaskRuntimeHandler = {
  uiBlock: "PUBLISH_CONTEXT",
  hiddenFieldIds: ["channel"],
  validateCompletion: (context) => validatePublishCheck(context.instance, materialHasResultReviewDate(context)),
  complete: (context) => {
    const material = materialOf(context);
    if (context.instance.fieldValues["outcome"] === "PUBLISHED_SUCCESSFULLY") {
      return { entityActions: confirmedPublishActions(context, material), taskDrafts: [], plan: null, completeNow: true };
    }
    // DID_NOT_PUBLISH / PUBLISHED_WITH_ISSUE: OFFER Fix / Republish through
    // the normal Preview -> Confirm; nothing is created unless confirmed.
    const plan = buildRepublishFixPlan(context.instance, context.content, context.taskTypesById, REPUBLISH_FIX_TASK_TYPE_NAME);
    return { ...NO_EFFECT, plan, completeNow: !plan };
  },
};

/** THE one place special Task Type behavior is registered. */
export const TASK_RUNTIME_HANDLERS: Readonly<Record<string, TaskRuntimeHandler>> = {
  "Problem Split": { startsOn: "PROBLEM_CATEGORY" },
  Angle: angleHandler,
  "Destination Decision": destinationDecisionHandler,
  "Repurpose Map": repurposeMapHandler,
  "Reel Script": authoringHandler,
  Carousel: authoringHandler,
  "Text Post": authoringHandler,
  YouTube: authoringHandler,
  Planning: planningHandler,
  Shoot: shootHandler,
  Edit: editHandler,
  [DISTRIBUTION_PLAN_TASK_TYPE_NAME]: distributionPlanHandler,
  [PUBLISH_SCHEDULE_TASK_TYPE_NAME]: publishScheduleHandler,
  "Publish Check": publishCheckHandler,
};

const GENERIC_HANDLER: TaskRuntimeHandler = {};

export function resolveRuntimeHandler(taskTypeName: string): TaskRuntimeHandler {
  return TASK_RUNTIME_HANDLERS[taskTypeName] ?? GENERIC_HANDLER;
}

export function runtimeCompletionErrors(context: TaskRuntimeContext): CompletionValidationError[] {
  return resolveRuntimeHandler(context.taskType.name).validateCompletion?.(context) ?? [];
}

export function runTaskCompletion(context: TaskRuntimeContext, now: () => string = () => new Date().toISOString()): TaskRuntimeCompletionResult {
  const handler = resolveRuntimeHandler(context.taskType.name);
  return handler.complete ? handler.complete(context, now) : completeGeneric(context);
}

/** Convenience used by tests: generic validation + handler validation. */
export function canCompleteWithHandler(context: TaskRuntimeContext): boolean {
  return canCompleteTaskInstance(context.instance, context.taskType.requiredFields) && runtimeCompletionErrors(context).length === 0;
}
