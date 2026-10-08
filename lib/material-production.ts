/**
 * Material production helpers (V1 Sprint 5): CTA rules, the
 * Ready-for-Shoot / Ready-for-Distribution derived views, manual Shoot
 * Session creation, and the dependency metadata Sprint 6 will read.
 *
 * Pure, local/session-only. Material is a Content OS entity; every task
 * here is a separate TaskInstance whose local `contentRef` may point at
 * it. Nothing assumes `public.tasks.content_ref` -- the future bridge
 * stays content entity <-> content_task_links <-> public.tasks.id.
 */
import type { CompletionValidationError, TaskInstance, TaskInstanceDraft } from "./task-instance";
import type { TaskType } from "./task-type";
import { buildStandaloneTaskInstanceSeed } from "./workflow-runtime";
import {
  createShootSession,
  ref,
  type CtaType,
  type Destination,
  type Material,
  type MaterialFormat,
  type ShootSession,
} from "./content-entity";
import type { ContentEntityAction, ContentEntityState } from "./content-entity-store";

// --- CTA (sections 3-5) ---

/** CTA types that never need an exact Destination even when the Atomic
 * Idea flagged `destinationNeeded` (nothing to send people to). */
export const DESTINATION_FREE_CTA_TYPES: readonly CtaType[] = ["ENGAGEMENT", "FOLLOW"];

export interface MaterialCtaInput {
  readonly ctaType: CtaType | null;
  readonly ctaText: string;
  readonly destinationId: string | null;
}

/** An exact Destination is required only when the Material was flagged
 * `destinationNeeded` AND the chosen CTA type actually points somewhere. */
export function isExactDestinationRequired(destinationNeeded: boolean, ctaType: CtaType | null): boolean {
  if (!destinationNeeded || !ctaType) return false;
  return !DESTINATION_FREE_CTA_TYPES.includes(ctaType);
}

/** Pure. Reports every reason the authoring task's CTA part blocks
 * Complete. The Destination's own status is deliberately NOT checked --
 * PLANNED / IN_PROGRESS / READY are all selectable (destination creation
 * runs in parallel; the READY gate belongs to a future Publish rule). */
export function validateMaterialCta(
  material: Pick<Material, "destinationNeeded">,
  input: MaterialCtaInput,
  destinationsInCategory: readonly Pick<Destination, "id">[],
): CompletionValidationError[] {
  const errors: CompletionValidationError[] = [];
  if (!input.ctaType) errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: "cta-type", message: "CTA turi tanlanishi shart." });
  if (!input.ctaText.trim()) errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: "cta-text", message: "CTA matni kiritilishi shart." });
  if (input.destinationId && !destinationsInCategory.some((d) => d.id === input.destinationId)) {
    errors.push({ code: "INVALID_FIELD_VALUE", fieldId: "cta-destination-id", message: "Destination shu Problem Category kutubxonasidan bo'lishi kerak." });
  }
  if (isExactDestinationRequired(material.destinationNeeded, input.ctaType) && !input.destinationId) {
    errors.push({ code: "MISSING_REQUIRED_FIELD", fieldId: "cta-destination-id", message: "Bu Material uchun aniq Destination tanlanishi shart." });
  }
  return errors;
}

// --- Dependency metadata for Sprint 6 (section 15) ---

export interface ProductionTaskDependencyMetadata {
  /** Completing this task makes the Material eligible to open a
   * Distribution Plan. */
  readonly unlocksDistributionPlan: boolean;
  /** Not blocking Distribution Plan, but a future Publish rule may require
   * it to be done before actual Publish completion. */
  readonly mayBlockPublishCompletion: boolean;
}

/** Keyed by Task Type name. Sprint 5 only RECORDS this; nothing here
 * enforces publish rules. */
export const PRODUCTION_TASK_DEPENDENCY_METADATA: Readonly<Record<string, ProductionTaskDependencyMetadata>> = {
  Edit: { unlocksDistributionPlan: true, mayBlockPublishCompletion: true },
  Cover: { unlocksDistributionPlan: false, mayBlockPublishCompletion: true },
  Caption: { unlocksDistributionPlan: false, mayBlockPublishCompletion: true },
};

export const VIDEO_FORMATS: readonly MaterialFormat[] = ["REEL", "YOUTUBE"];

export function isVideoFormat(format: MaterialFormat): boolean {
  return VIDEO_FORMATS.includes(format);
}

// --- Ready for Shoot (sections 9-10) ---

/** Derived eligibility: Planning is done (`readyForShoot`) and the
 * Material has not yet been manually placed into a Shoot Session. */
export function getReadyForShootMaterials(state: ContentEntityState): readonly Material[] {
  return state.materials.filter((m) => m.readyForShoot && !m.shootSessionId);
}

export interface ShootSessionInput {
  readonly title: string;
  readonly scheduledAt: string | null;
  readonly assignee: string | null;
  /** Chosen manually from the Ready-for-Shoot list -- never auto-grouped. */
  readonly materialIds: readonly string[];
}

export interface ShootSessionBuild {
  readonly session: ShootSession;
  /** ONE batch Shoot task for the whole session (section 11), never one
   * per Material. */
  readonly shootTaskDraft: TaskInstanceDraft;
  readonly entityActions: readonly ContentEntityAction[];
}

export type ShootSessionBuildResult =
  | { readonly ok: true; readonly build: ShootSessionBuild }
  | { readonly ok: false; readonly message: string };

/** Pure. Only Materials currently in the Ready-for-Shoot list can join a
 * session; anything else is rejected, never silently dropped. */
export function buildShootSession(
  input: ShootSessionInput,
  state: ContentEntityState,
  shootTaskType: TaskType,
  now: () => string = () => new Date().toISOString(),
): ShootSessionBuildResult {
  if (!input.title.trim()) return { ok: false, message: "Shoot Session nomi kerak." };
  if (!input.materialIds.length) return { ok: false, message: "Kamida bitta Material tanlang." };
  const eligibleIds = new Set(getReadyForShootMaterials(state).map((m) => m.id));
  const ineligible = input.materialIds.filter((id) => !eligibleIds.has(id));
  if (ineligible.length) return { ok: false, message: "Faqat Ready-for-Shoot ro'yxatidagi Material'lar tanlanishi mumkin." };

  const session = createShootSession({ title: input.title.trim(), scheduledAt: input.scheduledAt, assignee: input.assignee?.trim() || null, materialIds: input.materialIds }, now);
  const seed = buildStandaloneTaskInstanceSeed(shootTaskType, session.title, null, ref("SHOOT_SESSION", session.id));
  const shootTaskDraft: TaskInstanceDraft = {
    ...seed,
    assignee: session.assignee ?? seed.assignee,
    deadline: session.scheduledAt,
    relatedEntityRefs: session.materialIds.map((id) => ref("MATERIAL", id)),
  };
  const entityActions: ContentEntityAction[] = [
    { type: "ADD_SHOOT_SESSION", session },
    ...session.materialIds.map((id): ContentEntityAction => ({ type: "SET_MATERIAL_PRODUCTION", id, shootSessionId: session.id })),
  ];
  return { ok: true, build: { session, shootTaskDraft, entityActions } };
}

// --- Ready for Distribution (sections 20-21) ---

export interface ProductionTaskStatusView {
  readonly taskType: string;
  readonly status: TaskInstance["status"];
}

export interface ReadyForDistributionItem {
  readonly material: Material;
  readonly destination: Destination | null;
  /** Edit / Cover / Caption statuses -- only meaningful for video formats. */
  readonly productionTasks: readonly ProductionTaskStatusView[];
}

/** Derived: Material.status === "READY" (Carousel/Text after authoring,
 * Reel/YouTube after Edit). The Destination's own status is displayed but
 * never blocks eligibility this sprint. */
export function getReadyForDistribution(
  state: ContentEntityState,
  instances: readonly TaskInstance[],
  taskTypesById: ReadonlyMap<string, TaskType>,
): readonly ReadyForDistributionItem[] {
  return state.materials
    .filter((m) => m.status === "READY")
    .map((material) => {
      const destination = material.destinationId ? state.destinations.find((d) => d.id === material.destinationId) ?? null : null;
      const productionTasks = isVideoFormat(material.format)
        ? instances
            .filter((i) => i.contentRef?.entityType === "MATERIAL" && i.contentRef.entityId === material.id)
            .map((i) => ({ taskType: taskTypesById.get(i.taskTypeId)?.name ?? "", status: i.status }))
            .filter((view) => view.taskType in PRODUCTION_TASK_DEPENDENCY_METADATA)
        : [];
      return { material, destination, productionTasks };
    });
}

/** Task Type that represents a batch Shoot Session (exists in the Task
 * Type library fixtures; looked up by name by the Production Queue UI). */
export const SHOOT_TASK_TYPE_NAME = "Shoot";
