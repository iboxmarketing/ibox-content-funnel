/**
 * Distribution, publish gates, and due-task reconciliation (V1 Sprint 6).
 * Pure, local/session-only: no platform APIs, no TaskClient, no Supabase,
 * no `tasks.content_ref`.
 *
 * Operational relation, all through each task's local `sourceTaskId` and
 * `contentRef` (none of these tasks is a knowledge-tree node):
 *
 *   Material -> Distribution Plan -> Publish/Schedule (x channel)
 *            -> Publish Check (scheduled only) -> Learning
 *
 * CHANNELS: the repository has no canonical publishing-channel model
 * (lib/tracking-preview-fixtures.ts only carries synthetic demo `platform`
 * strings for the CO-S6 tracking preview, unrelated to publishing), so
 * this is the one minimal list the Distribution Plan Task Type offers.
 * It is configuration, not a second channel library.
 */
import type { CompletionValidationError, TaskInstance, TaskInstanceDraft } from "./task-instance";
import type { TaskType } from "./task-type";
import { buildStandaloneTaskInstanceSeed } from "./workflow-runtime";
import { CHANNELS, PUBLISH_CHECK_OUTCOMES, PUBLISH_MODES, ref, type Destination, type Material } from "./content-entity";
import type { ContentEntityState } from "./content-entity-store";
import { PRODUCTION_TASK_DEPENDENCY_METADATA } from "./material-production";

export { CHANNELS, PUBLISH_MODES, PUBLISH_CHECK_OUTCOMES };
export type Channel = (typeof CHANNELS)[number];
export type PublishMode = (typeof PUBLISH_MODES)[number];
export type PublishCheckOutcome = (typeof PUBLISH_CHECK_OUTCOMES)[number];

export const DISTRIBUTION_PLAN_TASK_TYPE_NAME = "Distribution Plan";
export const PUBLISH_SCHEDULE_TASK_TYPE_NAME = "Publish / Schedule";
export const PUBLISH_CHECK_TASK_TYPE_NAME = "Publish Check";
export const LEARNING_TASK_TYPE_NAME = "Learning";
export const REPUBLISH_FIX_TASK_TYPE_NAME = "Republish / Fix Publish";

/**
 * Which production tasks a given channel needs finished before Publish can
 * complete (e.g. `{ Instagram: ["Cover"] }`). Empty by default: nothing is
 * hardcoded as "every channel needs Cover". Only task types flagged
 * `mayBlockPublishCompletion` in PRODUCTION_TASK_DEPENDENCY_METADATA are
 * honored.
 */
export type ChannelAssetRequirements = Readonly<Record<string, readonly string[]>>;
export const DEFAULT_CHANNEL_ASSET_REQUIREMENTS: ChannelAssetRequirements = {};

type TaskTypesById = ReadonlyMap<string, TaskType>;

function typeName(taskTypesById: TaskTypesById, instance: TaskInstance): string {
  return taskTypesById.get(instance.taskTypeId)?.name ?? "";
}

function forMaterial(instances: readonly TaskInstance[], materialId: string): TaskInstance[] {
  return instances.filter((i) => i.contentRef?.entityType === "MATERIAL" && i.contentRef.entityId === materialId);
}

function textValue(instance: TaskInstance, fieldId: string): string {
  const value = instance.fieldValues[fieldId];
  return typeof value === "string" ? value : "";
}

export interface PublishInfo {
  readonly channel: string;
  readonly mode: PublishMode | null;
  readonly scheduledPublishAt: string;
  readonly resultReviewAt: string;
  readonly published: boolean;
}

export function publishInfoOf(instance: TaskInstance): PublishInfo {
  const mode = textValue(instance, "publish-mode");
  return {
    channel: textValue(instance, "channel"),
    mode: mode === "PUBLISH_NOW" || mode === "SCHEDULE" ? mode : null,
    scheduledPublishAt: textValue(instance, "scheduled-publish-at"),
    resultReviewAt: textValue(instance, "result-review-at"),
    published: instance.fieldValues["published"] === true,
  };
}

// --- Distribution Plan (sections 5-7) ---

/** A Material can get a Distribution Plan once it is READY (Carousel/Text
 * after authoring, Reel/YouTube after Edit). Destination readiness and
 * final Head approval deliberately do NOT matter here -- they only gate
 * actually publishing. One plan per Material. */
export function getDistributionPlanEligibleMaterials(state: ContentEntityState, instances: readonly TaskInstance[], taskTypesById: TaskTypesById): readonly Material[] {
  return state.materials.filter(
    (m) => m.status === "READY" && !forMaterial(instances, m.id).some((i) => typeName(taskTypesById, i) === DISTRIBUTION_PLAN_TASK_TYPE_NAME && i.status !== "CANCELLED"),
  );
}

export function buildDistributionPlanTask(material: Material, planTaskType: TaskType): TaskInstanceDraft {
  return buildStandaloneTaskInstanceSeed(planTaskType, `${planTaskType.name} — ${material.title}`, null, ref("MATERIAL", material.id));
}

// --- Publish gates (section 9) ---

/** Unresolved FINAL-stage reviews for a Material, derived from its related
 * TaskInstances (no flag stored on the Material). Only DONE resolves one:
 * a skipped/cancelled required review is not an approval. */
export function unresolvedFinalReviews(materialId: string, instances: readonly TaskInstance[], taskTypesById: TaskTypesById): readonly TaskInstance[] {
  return forMaterial(instances, materialId).filter((i) => {
    const type = taskTypesById.get(i.taskTypeId);
    return Boolean(type?.reviewRequired && type.reviewStage === "FINAL") && i.status !== "DONE";
  });
}

export interface PublishBlockerInput {
  readonly material: Material;
  readonly channel: string;
  readonly content: ContentEntityState;
  readonly instances: readonly TaskInstance[];
  readonly taskTypesById: TaskTypesById;
  readonly assetRequirements?: ChannelAssetRequirements;
}

/** Why this Publish/Schedule task cannot be completed right now (empty =
 * nothing blocks it). Never consulted when creating a Distribution Plan. */
export function getPublishBlockers(input: PublishBlockerInput): string[] {
  const reasons: string[] = [];
  const destination: Destination | undefined = input.material.destinationId ? input.content.destinations.find((d) => d.id === input.material.destinationId) : undefined;
  if (input.material.destinationId && (!destination || destination.status !== "READY")) {
    reasons.push(`Destination not READY${destination ? `: ${destination.name} (${destination.status})` : ""}`);
  }
  for (const review of unresolvedFinalReviews(input.material.id, input.instances, input.taskTypesById)) {
    reasons.push(`Final Head approval kutilmoqda: ${review.title} (${review.status})`);
  }
  const required = (input.assetRequirements ?? DEFAULT_CHANNEL_ASSET_REQUIREMENTS)[input.channel] ?? [];
  const materialTasks = forMaterial(input.instances, input.material.id);
  for (const name of required) {
    if (!PRODUCTION_TASK_DEPENDENCY_METADATA[name]?.mayBlockPublishCompletion) continue;
    if (!materialTasks.some((i) => typeName(input.taskTypesById, i) === name && i.status === "DONE")) reasons.push(`${input.channel} uchun ${name} tugallanishi kerak`);
  }
  return reasons;
}

// --- Publish / Schedule completion rules (sections 8, 12-13) ---

export function validatePublishTask(instance: TaskInstance): CompletionValidationError[] {
  const info = publishInfoOf(instance);
  if (!info.mode) return [{ code: "MISSING_REQUIRED_FIELD", fieldId: "publish-mode", message: "Publish mode tanlanishi shart." }];
  if (info.mode === "SCHEDULE") {
    if (!info.scheduledPublishAt || Number.isNaN(Date.parse(info.scheduledPublishAt))) {
      return [{ code: "MISSING_REQUIRED_FIELD", fieldId: "scheduled-publish-at", message: "SCHEDULE uchun scheduledPublishAt majburiy." }];
    }
    return [];
  }
  const errors: CompletionValidationError[] = [];
  if (!info.published) errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: "published", message: "Nashr qilinganini tasdiqlang." });
  if (!info.resultReviewAt) errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: "result-review-at", message: "Result Review Date majburiy." });
  return errors;
}

export function validatePublishCheck(instance: TaskInstance): CompletionValidationError[] {
  const outcome = textValue(instance, "outcome");
  if (!(PUBLISH_CHECK_OUTCOMES as readonly string[]).includes(outcome)) return [{ code: "MISSING_REQUIRED_FIELD", fieldId: "outcome", message: "Natijani tanlang." }];
  if (outcome === "PUBLISHED_SUCCESSFULLY" && !textValue(instance, "result-review-at")) {
    return [{ code: "MISSING_REQUIRED_FIELD", fieldId: "result-review-at", message: "Muvaffaqiyatli nashr uchun Result Review Date majburiy." }];
  }
  return [];
}

// --- Deterministic reconciliation (sections 10, 14) ---

export interface ReconcileInput {
  /** The "current" time for this pass -- passed in so tests and the local
   * "advance time" control are deterministic. Never a timer. */
  readonly now: string | number | Date;
  readonly instances: readonly TaskInstance[];
  readonly taskTypesById: TaskTypesById;
}

function toMs(value: string | number | Date): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

/** Task titles are `<Task Type> — <Channel> — <Material>`; follow-ups reuse
 * everything after the Task Type. */
function titleRest(task: TaskInstance): string {
  return task.title.replace(/^[^—]*—\s*/, "");
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/**
 * Pure and idempotent. Returns drafts only for work that is due AND not
 * already represented by an existing task:
 *  - a SCHEDULE publish task that is DONE and whose scheduledPublishAt has
 *    passed -> exactly one Publish Check ("Scheduled does not mean
 *    published");
 *  - a confirmed publish (PUBLISH_NOW done, or a Publish Check that
 *    resolved PUBLISHED_SUCCESSFULLY) whose resultReviewAt has passed ->
 *    exactly one Learning task (per publish occurrence, i.e. per
 *    Material x Channel).
 * Calling it again with the instances it already produced yields [].
 */
export function reconcileDueRuntimeTasks(input: ReconcileInput, taskTypes: readonly TaskType[]): TaskInstanceDraft[] {
  const nowMs = toMs(input.now);
  if (Number.isNaN(nowMs)) return [];
  const byName = new Map(taskTypes.map((t) => [t.name, t]));
  const checkType = byName.get(PUBLISH_CHECK_TASK_TYPE_NAME);
  const learningType = byName.get(LEARNING_TASK_TYPE_NAME);
  const hasChild = (parent: TaskInstance, name: string) => input.instances.some((i) => i.sourceTaskId === parent.id && typeName(input.taskTypesById, i) === name);
  const drafts: TaskInstanceDraft[] = [];

  for (const task of input.instances) {
    if (!task.contentRef || task.contentRef.entityType !== "MATERIAL") continue;
    const name = typeName(input.taskTypesById, task);
    const info = publishInfoOf(task);

    if (name === PUBLISH_SCHEDULE_TASK_TYPE_NAME && info.mode === "SCHEDULE" && task.status === "DONE" && checkType) {
      if (Date.parse(info.scheduledPublishAt) <= nowMs && !hasChild(task, PUBLISH_CHECK_TASK_TYPE_NAME)) {
        const seed = buildStandaloneTaskInstanceSeed(checkType, `${checkType.name} — ${titleRest(task)}`, task.id, task.contentRef);
        drafts.push({ ...seed, deadline: dateOnly(info.scheduledPublishAt), fieldValues: { channel: info.channel } });
      }
    }

    const confirmedPublish =
      (name === PUBLISH_SCHEDULE_TASK_TYPE_NAME && info.mode === "PUBLISH_NOW" && task.status === "DONE" && info.published) ||
      (name === PUBLISH_CHECK_TASK_TYPE_NAME && task.status === "DONE" && textValue(task, "outcome") === "PUBLISHED_SUCCESSFULLY");
    if (confirmedPublish && learningType) {
      const reviewAt = textValue(task, "result-review-at");
      if (reviewAt && Date.parse(reviewAt) <= nowMs && !hasChild(task, LEARNING_TASK_TYPE_NAME)) {
        const channel = textValue(task, "channel");
        const seed = buildStandaloneTaskInstanceSeed(learningType, `${learningType.name} — ${titleRest(task)}`, task.id, task.contentRef);
        drafts.push({ ...seed, deadline: dateOnly(reviewAt), fieldValues: { channel } });
      }
    }
  }
  return drafts;
}

// --- Read models for the Production Queue (sections 16, 21) ---

export interface LearningSummary {
  readonly result: string;
  readonly whatWorked: string;
  readonly nextStep: string;
}

/** Only the latest completed Learning for a Material -- no history, no
 * aggregation to Angle/KnowledgeNode. */
export function latestLearningSummary(materialId: string, instances: readonly TaskInstance[], taskTypesById: TaskTypesById): LearningSummary | null {
  const done = forMaterial(instances, materialId)
    .filter((i) => typeName(taskTypesById, i) === LEARNING_TASK_TYPE_NAME && i.status === "DONE")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const latest = done[0];
  if (!latest) return null;
  return { result: textValue(latest, "result"), whatWorked: textValue(latest, "what-worked"), nextStep: textValue(latest, "next-step") };
}

/** SCHEDULE publish tasks already marked DONE whose Publish Check is not
 * finished yet (not due, due, or open). */
export function getAwaitingPublishCheck(instances: readonly TaskInstance[], taskTypesById: TaskTypesById) {
  return instances
    .filter((i) => typeName(taskTypesById, i) === PUBLISH_SCHEDULE_TASK_TYPE_NAME && publishInfoOf(i).mode === "SCHEDULE" && i.status === "DONE")
    .map((publishTask) => {
      const check = instances.find((i) => i.sourceTaskId === publishTask.id && typeName(taskTypesById, i) === PUBLISH_CHECK_TASK_TYPE_NAME) ?? null;
      return { publishTask, info: publishInfoOf(publishTask), check };
    })
    .filter((row) => !row.check || row.check.status !== "DONE");
}

export function getLearningDue(instances: readonly TaskInstance[], taskTypesById: TaskTypesById): readonly TaskInstance[] {
  return instances.filter((i) => typeName(taskTypesById, i) === LEARNING_TASK_TYPE_NAME && i.status !== "DONE" && i.status !== "CANCELLED");
}
