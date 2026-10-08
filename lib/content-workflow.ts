/**
 * Content workflow bridge (V1 Sprint 3): turns a settled TaskInstance into
 * a Generated Preview plan, and a confirmed preview back into content
 * entities + TaskInstance drafts. This is the ONLY place that knows about
 * both lib/workflow-runtime.ts (task graph) and lib/content-entity.ts
 * (content tree) -- neither of those files imports the other.
 *
 * Still local/session only. Never calls TaskClient, never touches
 * Supabase, never assumes `tasks.content_ref` or a `content_task_links`
 * table -- the bridge lives entirely here, in plain objects.
 *
 * Four preview modes, dispatched by the completed Task Type's name:
 *  - "Problem Split"       -> PROBLEM_SPLIT_TO_PARTS   (each candidate: 1 new ProblemPart + 1 new Knowledge Discovery task)
 *  - "Knowledge Discovery" -> KNOWLEDGE_DISCOVERY_TO_NODES (each candidate: 1 new KnowledgeNode; ALL selected nodes share exactly ONE new Research task)
 *  - "Research"            -> RESEARCH_TO_BLOGS        (each candidate: an existing UNPLANNED KnowledgeNode -> 1 new Blog entity + 1 new Blog task)
 *  - anything else         -> STEP_FANOUT               (Sprint 2's generic one-task-per-generated-step behavior, e.g. Blog -> Head Review/SEO/Angle/Performance Consultation)
 *
 * Research covering several KnowledgeNodes is why TaskInstance has
 * `relatedEntityRefs` in addition to `contentRef` (section 7) -- every
 * other mode only ever needs the single primary ref.
 */
import { isTaskInstanceSettled, type TaskInstance, type TaskInstanceDraft } from "./task-instance";
import { getStepsGeneratedBy, buildTaskInstanceSeed, applyContextTransfer, type TransferSelection } from "./workflow-runtime";
import type { WorkflowStep, WorkflowTemplate } from "./workflow-template";
import type { TaskType } from "./task-type";
import { ref, createProblemPart, createKnowledgeNode, createBlog, type Blog, type ContentEntityRef, type KnowledgeNode, type KnowledgeNodeStatus, type ProblemPart } from "./content-entity";
import type { ContentEntityState } from "./content-entity-store";

export type PreviewMode = "PROBLEM_SPLIT_TO_PARTS" | "KNOWLEDGE_DISCOVERY_TO_NODES" | "RESEARCH_TO_BLOGS" | "STEP_FANOUT";

/** KNOWLEDGE_DISCOVERY_TO_NODES's per-candidate rows only carry an entity
 * NAME each (no task is created per node) -- the one shared Research
 * task's own assignee/deadline/context-transfer is a separate selection
 * under this fixed key, always submitted regardless of which individual
 * node candidates are included. */
export const SHARED_TASK_SELECTION_KEY = "__shared_task__";

export interface TextPreviewCandidate {
  readonly kind: "PROBLEM_SPLIT_TO_PARTS" | "KNOWLEDGE_DISCOVERY_TO_NODES";
  readonly key: string;
  readonly text: string;
}

export interface ResearchPreviewCandidate {
  readonly kind: "RESEARCH_TO_BLOGS";
  readonly key: string;
  readonly node: KnowledgeNode;
}

export interface StepFanoutPreviewCandidate {
  readonly kind: "STEP_FANOUT";
  readonly key: string;
  readonly step: WorkflowStep;
  readonly taskType: TaskType;
}

export type PreviewCandidate = TextPreviewCandidate | ResearchPreviewCandidate | StepFanoutPreviewCandidate;

export interface PreviewPlan {
  readonly mode: PreviewMode;
  /** The settled (simulated) source instance this plan was built from. */
  readonly sourceInstance: TaskInstance;
  /** The source instance's own Task Type -- needed to label its fields
   * for Context Transfer. Deliberately distinct from `targetTaskType`
   * (the type of task(s) being generated), which uses a DIFFERENT set of
   * field ids; conflating the two would silently empty out every
   * transfer candidate. */
  readonly sourceTaskType: TaskType;
  /** Shared across every candidate for PROBLEM_SPLIT_TO_PARTS /
   * KNOWLEDGE_DISCOVERY_TO_NODES / RESEARCH_TO_BLOGS (every candidate in
   * those modes produces the same kind of task); null for STEP_FANOUT,
   * where each candidate carries its own step/taskType. */
  readonly targetStep: WorkflowStep | null;
  readonly targetTaskType: TaskType | null;
  readonly candidates: readonly PreviewCandidate[];
}

function splitCandidateLines(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface BuildPreviewPlanInput {
  readonly template: WorkflowTemplate;
  readonly allInstances: readonly TaskInstance[];
  /** Already the settled/simulated version -- see workflow-run-view.tsx. */
  readonly settledSourceInstance: TaskInstance;
  readonly sourceTaskType: TaskType;
  readonly taskTypesById: ReadonlyMap<string, TaskType>;
  readonly contentEntities: ContentEntityState;
}

/** Pure. Returns null when there is nothing to preview (no generated
 * steps, or no candidates once the mode-specific source data is read). */
export function buildPreviewPlan(input: BuildPreviewPlanInput): PreviewPlan | null {
  const generatedSteps = getStepsGeneratedBy(input.template, input.allInstances, input.settledSourceInstance);
  if (!generatedSteps.length) return null;

  const firstTarget = generatedSteps[0];
  const firstTargetTaskType = input.taskTypesById.get(firstTarget.taskTypeId) ?? null;

  if (input.sourceTaskType.name === "Problem Split" && firstTargetTaskType) {
    const lines = splitCandidateLines(input.settledSourceInstance.fieldValues["components"]);
    if (!lines.length) return null;
    const candidates: PreviewCandidate[] = lines.map((text, index) => ({ kind: "PROBLEM_SPLIT_TO_PARTS", key: `part-${index}`, text }));
    return { mode: "PROBLEM_SPLIT_TO_PARTS", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: firstTarget, targetTaskType: firstTargetTaskType, candidates };
  }

  if (input.sourceTaskType.name === "Knowledge Discovery" && firstTargetTaskType) {
    const lines = splitCandidateLines(input.settledSourceInstance.fieldValues["knowledge-nodes"]);
    if (!lines.length) return null;
    const candidates: PreviewCandidate[] = lines.map((text, index) => ({ kind: "KNOWLEDGE_DISCOVERY_TO_NODES", key: `node-${index}`, text }));
    return { mode: "KNOWLEDGE_DISCOVERY_TO_NODES", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: firstTarget, targetTaskType: firstTargetTaskType, candidates };
  }

  if (input.sourceTaskType.name === "Research" && firstTargetTaskType) {
    const relatedNodeIds = input.settledSourceInstance.relatedEntityRefs.filter((r) => r.entityType === "KNOWLEDGE_NODE").map((r) => r.entityId);
    const nodes = relatedNodeIds
      .map((id) => input.contentEntities.knowledgeNodes.find((node) => node.id === id))
      .filter((node): node is KnowledgeNode => node !== undefined && node.status === "UNPLANNED");
    if (!nodes.length) return null;
    const candidates: PreviewCandidate[] = nodes.map((node) => ({ kind: "RESEARCH_TO_BLOGS", key: node.id, node }));
    return { mode: "RESEARCH_TO_BLOGS", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: firstTarget, targetTaskType: firstTargetTaskType, candidates };
  }

  const candidates: PreviewCandidate[] = generatedSteps.flatMap((step) => {
    const taskType = input.taskTypesById.get(step.taskTypeId);
    if (!taskType) return [];
    return [{ kind: "STEP_FANOUT" as const, key: step.id, step, taskType }];
  });
  if (!candidates.length) return null;
  return { mode: "STEP_FANOUT", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: null, targetTaskType: null, candidates };
}

// --- Confirm ---

export interface CandidateSelectionState {
  readonly key: string;
  readonly included: boolean;
  /** Entity name (text-candidate modes) or task title (task-candidate
   * modes) -- whichever this mode's candidate actually produces. */
  readonly title: string;
  readonly assignee: string;
  readonly deadline: string;
  /** Only meaningful for modes that create a task directly from this
   * candidate (RESEARCH_TO_BLOGS, STEP_FANOUT). */
  readonly selections: readonly TransferSelection[];
}

export interface ConfirmOutcome {
  readonly problemParts: readonly ProblemPart[];
  readonly knowledgeNodes: readonly KnowledgeNode[];
  readonly knowledgeNodeStatusUpdates: readonly { readonly id: string; readonly status: KnowledgeNodeStatus }[];
  readonly blogs: readonly Blog[];
  readonly taskDrafts: readonly TaskInstanceDraft[];
}

const EMPTY_OUTCOME: ConfirmOutcome = { problemParts: [], knowledgeNodes: [], knowledgeNodeStatusUpdates: [], blogs: [], taskDrafts: [] };

/** Pure. `plan` must be the exact plan the UI rendered; `selections` is
 * the employee's final edited/include state for each candidate, keyed by
 * `PreviewCandidate.key`. Only `included` candidates produce anything. */
export function confirmPreviewPlan(plan: PreviewPlan, selections: readonly CandidateSelectionState[], now: () => string = () => new Date().toISOString()): ConfirmOutcome {
  const selectionByKey = new Map(selections.filter((s) => s.included).map((s) => [s.key, s]));
  if (!selectionByKey.size) return EMPTY_OUTCOME;

  switch (plan.mode) {
    case "PROBLEM_SPLIT_TO_PARTS":
      return confirmProblemSplit(plan, selectionByKey, now);
    case "KNOWLEDGE_DISCOVERY_TO_NODES":
      return confirmKnowledgeDiscovery(plan, selectionByKey, now);
    case "RESEARCH_TO_BLOGS":
      return confirmResearch(plan, selectionByKey, now);
    case "STEP_FANOUT":
      return confirmStepFanout(plan, selectionByKey, now);
    default:
      return EMPTY_OUTCOME;
  }
}

function confirmProblemSplit(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  if (!plan.targetStep || !plan.targetTaskType) return EMPTY_OUTCOME;
  const problemCategoryRef = plan.sourceInstance.contentRef;
  if (!problemCategoryRef || problemCategoryRef.entityType !== "PROBLEM_CATEGORY") return EMPTY_OUTCOME;

  const problemParts: ProblemPart[] = [];
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates as readonly TextPreviewCandidate[]) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    const part = createProblemPart(problemCategoryRef.entityId, selection.title.trim() || candidate.text, plan.sourceInstance.id, now);
    problemParts.push(part);
    const seed = buildTaskInstanceSeed(plan.targetStep, plan.targetTaskType, plan.sourceInstance.id, ref("PROBLEM_PART", part.id));
    taskDrafts.push({ ...seed, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null });
  }
  return { ...EMPTY_OUTCOME, problemParts, taskDrafts };
}

function confirmKnowledgeDiscovery(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  if (!plan.targetStep || !plan.targetTaskType) return EMPTY_OUTCOME;
  const problemPartRef = plan.sourceInstance.contentRef;
  if (!problemPartRef || problemPartRef.entityType !== "PROBLEM_PART") return EMPTY_OUTCOME;

  const knowledgeNodes: KnowledgeNode[] = [];
  for (const candidate of plan.candidates as readonly TextPreviewCandidate[]) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    knowledgeNodes.push(createKnowledgeNode(problemPartRef.entityId, selection.title.trim() || candidate.text, plan.sourceInstance.id, now));
  }
  if (!knowledgeNodes.length) return EMPTY_OUTCOME;

  // One SHARED Research task for the whole confirmed batch (section 10:
  // "Related Knowledge Nodes may share one Research task") -- never one
  // Research instance per node. Its own assignee/deadline/transfer come
  // from the dedicated SHARED_TASK_SELECTION_KEY entry, not from any one
  // node candidate (node inclusion and the shared task's own fields are
  // independent).
  const relatedEntityRefs: readonly ContentEntityRef[] = knowledgeNodes.map((node) => ref("KNOWLEDGE_NODE", node.id));
  const seed = buildTaskInstanceSeed(plan.targetStep, plan.targetTaskType, plan.sourceInstance.id, problemPartRef, relatedEntityRefs);
  const sharedSelection = selectionByKey.get(SHARED_TASK_SELECTION_KEY);
  const transferred = sharedSelection ? applyContextTransfer(seed, plan.sourceInstance, sharedSelection.selections) : { fieldValues: seed.fieldValues, fieldProvenance: [] };
  const taskDraft: TaskInstanceDraft = {
    ...seed,
    assignee: sharedSelection?.assignee.trim() || null,
    deadline: sharedSelection?.deadline || null,
    fieldValues: transferred.fieldValues,
    fieldProvenance: transferred.fieldProvenance,
  };
  return { ...EMPTY_OUTCOME, knowledgeNodes, taskDrafts: [taskDraft] };
}

function confirmResearch(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  if (!plan.targetStep || !plan.targetTaskType) return EMPTY_OUTCOME;

  const blogs: Blog[] = [];
  const knowledgeNodeStatusUpdates: { id: string; status: KnowledgeNodeStatus }[] = [];
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates as readonly ResearchPreviewCandidate[]) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    const blog = createBlog(candidate.node.id, selection.title.trim() || `${candidate.node.name} — blog`, plan.sourceInstance.id, now);
    blogs.push(blog);
    knowledgeNodeStatusUpdates.push({ id: candidate.node.id, status: "PLANNED" });
    // Blog task's primary "working on" is the KnowledgeNode it writes
    // about (section 14's own example), not the Blog entity it creates.
    const seed = buildTaskInstanceSeed(plan.targetStep, plan.targetTaskType, plan.sourceInstance.id, ref("KNOWLEDGE_NODE", candidate.node.id));
    const transferred = applyContextTransfer(seed, plan.sourceInstance, selection.selections);
    taskDrafts.push({ ...seed, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null, fieldValues: transferred.fieldValues, fieldProvenance: transferred.fieldProvenance });
  }
  // Unselected nodes are simply never touched -- they remain UNPLANNED
  // (section 15): no status write happens for them at all.
  return { ...EMPTY_OUTCOME, blogs, knowledgeNodeStatusUpdates, taskDrafts };
}

function confirmStepFanout(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  void now; // no entity is created here, so no timestamp is needed
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates as readonly StepFanoutPreviewCandidate[]) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    // Entity context propagates down the chain unchanged (e.g. Head
    // Review inherits the same KnowledgeNode Blog was "working on").
    const seed = buildTaskInstanceSeed(candidate.step, candidate.taskType, plan.sourceInstance.id, plan.sourceInstance.contentRef, plan.sourceInstance.relatedEntityRefs);
    const transferred = applyContextTransfer(seed, plan.sourceInstance, selection.selections);
    taskDrafts.push({ ...seed, title: selection.title.trim() || seed.title, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null, fieldValues: transferred.fieldValues, fieldProvenance: transferred.fieldProvenance });
  }
  return { ...EMPTY_OUTCOME, taskDrafts };
}

// --- "Working on" display (section 14) ---

const ENTITY_TYPE_LABELS_UZ: Record<ContentEntityRef["entityType"], string> = {
  DOMAIN: "Domain",
  PROBLEM_CATEGORY: "Muammo toifasi",
  PROBLEM_PART: "Muammo qismi",
  KNOWLEDGE_NODE: "Knowledge Node",
  BLOG: "Blog",
  MATERIAL: "Material",
};

export function entityTypeLabelUz(entityType: ContentEntityRef["entityType"]): string {
  return ENTITY_TYPE_LABELS_UZ[entityType];
}

/** True once `instance` is in a terminal state usable as a Preview source
 * (re-exported here so callers of this module don't also need to import
 * task-instance.ts just for this one check). */
export function isReadyToGenerateFrom(instance: TaskInstance): boolean {
  return isTaskInstanceSettled(instance);
}
