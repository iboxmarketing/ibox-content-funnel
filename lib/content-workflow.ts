/**
 * Content workflow bridge (V1 Sprint 3, extended Sprint 4): turns a
 * settled TaskInstance into a Generated Preview plan, and a confirmed
 * preview back into content entities + TaskInstance drafts. This is the
 * ONLY place that knows about both lib/workflow-runtime.ts (task graph)
 * and lib/content-entity.ts (content tree) -- neither of those files
 * imports the other.
 *
 * Still local/session only. Never calls TaskClient, never touches
 * Supabase, never assumes `tasks.content_ref` or a `content_task_links`
 * table -- the bridge lives entirely here, in plain objects.
 *
 * Preview modes, dispatched by the completed Task Type's name:
 *  - "Problem Split"       -> PROBLEM_SPLIT_TO_PARTS      (each candidate: 1 new ProblemPart + 1 new Knowledge Discovery task)
 *  - "Knowledge Discovery" -> KNOWLEDGE_DISCOVERY_TO_NODES (each candidate: 1 new KnowledgeNode; ALL selected nodes share exactly ONE new Research task)
 *  - "Research"            -> RESEARCH_TO_BLOGS           (each candidate: an existing UNPLANNED KnowledgeNode -> 1 new Blog entity + 1 new Blog task)
 *  - "Angle"               -> ANGLE_TO_ANGLES             (each text candidate: 1 new Angle entity, no task; MIXED with any STEP_FANOUT candidates genuinely unlocked at the same time, e.g. Destination Decision once Blog+Performance Consultation also settled)
 *  - anything else         -> STEP_FANOUT                 (Sprint 2's generic one-task-per-generated-step behavior, e.g. Blog -> Head Review/SEO/Angle/Performance Consultation)
 *
 * Two flows deliberately do NOT go through buildPreviewPlan/sourceTaskType
 * dispatch, because there is nothing to preview beyond what the task's own
 * fields already captured:
 *  - Destination Decision's reuse-vs-create-new outcome -- see
 *    `applyDestinationDecision`, called directly by the orchestrator at
 *    Complete time. Repurpose Map's eligibility is still checked
 *    separately and normally afterward (plain STEP_FANOUT).
 *  - Repurpose Map's AtomicIdeaDraft -> AtomicIdea conversion -- see
 *    `confirmAtomicIdeaDrafts`, also called directly at Complete time
 *    (the drafts were already live-editable inside the task). The
 *    FORMAT-SPECIFIC previews that follow (section 15) DO go through the
 *    generic preview/confirm pipeline, via `buildFormatPreviewPlan` +
 *    the "MATERIAL_FORMAT_GROUPS" mode.
 *
 * Research covering several KnowledgeNodes is why TaskInstance has
 * `relatedEntityRefs` in addition to `contentRef` (section 7) -- every
 * other mode only ever needs the single primary ref.
 */
import { isTaskInstanceSettled, type AtomicIdeaDraft, type TaskInstance, type TaskInstanceDraft } from "./task-instance";
import { buildStandaloneTaskInstanceSeed, getStepsGeneratedBy, buildTaskInstanceSeed, applyContextTransfer, type TransferSelection } from "./workflow-runtime";
import type { WorkflowStep, WorkflowTemplate } from "./workflow-template";
import type { TaskType } from "./task-type";
import {
  ref,
  createAngle,
  createAngleDestinationLink,
  createAtomicIdea,
  createBlog,
  createDestination,
  createKnowledgeNode,
  createMaterial,
  createProblemPart,
  setMaterialStatus,
  type Angle,
  type AngleDestinationLink,
  type AngleUsage,
  type AnglePriority,
  type AtomicIdea,
  type AtomicIdeaCoverageType,
  type AtomicIdeaDecision,
  type Blog,
  type ContentEntityRef,
  type Destination,
  type DestinationType,
  type KnowledgeNode,
  type KnowledgeNodeStatus,
  type Material,
  type MaterialFormat,
  type ProblemPart,
} from "./content-entity";
import { anglesForKnowledgeNode, type ContentEntityAction, type ContentEntityState } from "./content-entity-store";

export type PreviewMode =
  | "PROBLEM_SPLIT_TO_PARTS"
  | "KNOWLEDGE_DISCOVERY_TO_NODES"
  | "RESEARCH_TO_BLOGS"
  | "ANGLE_TO_ANGLES"
  | "MATERIAL_FORMAT_GROUPS"
  | "SHOOT_PRODUCTION"
  | "CHANNEL_PUBLISH"
  | "REPUBLISH_FIX"
  | "STEP_FANOUT";

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

/** Entity-only, like TextPreviewCandidate -- no task is created directly
 * from an Angle candidate. Kept as its own kind (rather than reusing
 * TextPreviewCandidate) because its confirm step also writes the Angle's
 * classification fields (category/usage/priority), carried on
 * `CandidateSelectionState`, not just a name. */
export interface AnglePreviewCandidate {
  readonly kind: "ANGLE_TO_ANGLES";
  readonly key: string;
  readonly text: string;
}

export interface StepFanoutPreviewCandidate {
  readonly kind: "STEP_FANOUT";
  readonly key: string;
  readonly step: WorkflowStep;
  readonly taskType: TaskType;
}

/** Section 16-17: one confirmed CREATE_CONTENT AtomicIdea x one of its
 * selected formats -> one Material + one standalone first production
 * task (never a WorkflowStep -- the production chain isn't in any
 * WorkflowTemplate graph this sprint). */
export interface MaterialPreviewCandidate {
  readonly kind: "MATERIAL_FROM_ATOMIC_IDEA";
  readonly key: string;
  readonly atomicIdea: AtomicIdea;
  readonly format: MaterialFormat;
  readonly blogId: string;
  readonly taskType: TaskType;
}

/** Sprint 5 (sections 12-13): one of Edit / Cover / Caption for ONE
 * Material of a completed Shoot Session. All three are REQUIRED -- the
 * approved rule is that Shoot completion opens them in parallel, so the
 * preview lets the employee edit title/assignee/deadline but never drop
 * one (a dropped Edit would silently strand that Material before
 * Distribution). */
export interface ProductionTaskPreviewCandidate {
  readonly kind: "PRODUCTION_TASK";
  readonly key: string;
  readonly material: Material;
  readonly taskType: TaskType;
  readonly required: true;
}

/** Sprint 6 (section 7): one selected channel of a Distribution Plan ->
 * one Publish/Schedule task for (Material x Channel). */
export interface ChannelPublishPreviewCandidate {
  readonly kind: "CHANNEL_PUBLISH";
  readonly key: string;
  readonly channel: string;
  readonly material: Material;
  readonly taskType: TaskType;
}

/** Sprint 6 (section 18): an OFFERED Fix / Republish task after a failed
 * or problematic Publish Check. Never created without Confirm. */
export interface RepublishFixPreviewCandidate {
  readonly kind: "REPUBLISH_FIX";
  readonly key: string;
  readonly channel: string;
  readonly material: Material;
  readonly taskType: TaskType;
}

export type PreviewCandidate =
  | ChannelPublishPreviewCandidate
  | RepublishFixPreviewCandidate
  | TextPreviewCandidate
  | ResearchPreviewCandidate
  | AnglePreviewCandidate
  | StepFanoutPreviewCandidate
  | MaterialPreviewCandidate
  | ProductionTaskPreviewCandidate;

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
   * those modes produces the same kind of task); null for modes where
   * each candidate carries its own step/taskType (STEP_FANOUT,
   * ANGLE_TO_ANGLES, MATERIAL_FORMAT_GROUPS). */
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

function stepFanoutCandidatesFor(generatedSteps: readonly WorkflowStep[], taskTypesById: ReadonlyMap<string, TaskType>): PreviewCandidate[] {
  return generatedSteps.flatMap((step) => {
    const taskType = taskTypesById.get(step.taskTypeId);
    return taskType ? [{ kind: "STEP_FANOUT" as const, key: step.id, step, taskType }] : [];
  });
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

  const firstTarget = generatedSteps[0];
  const firstTargetTaskType = firstTarget ? input.taskTypesById.get(firstTarget.taskTypeId) ?? null : null;

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

  if (input.sourceTaskType.name === "Angle") {
    const lines = splitCandidateLines(input.settledSourceInstance.fieldValues["angles"]);
    const angleCandidates: PreviewCandidate[] = lines.map((text, index) => ({ kind: "ANGLE_TO_ANGLES", key: `angle-${index}`, text }));
    // Mixed plan (section 4 architecture note): Angle entity creation and
    // any genuinely-unlocked next step (e.g. Destination Decision, once
    // Blog + Performance Consultation have ALSO settled) are independent
    // outcomes of the same Complete -- never conflated into one.
    const candidates = [...angleCandidates, ...stepFanoutCandidatesFor(generatedSteps, input.taskTypesById)];
    if (!candidates.length) return null;
    return { mode: "ANGLE_TO_ANGLES", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: null, targetTaskType: null, candidates };
  }

  const candidates = stepFanoutCandidatesFor(generatedSteps, input.taskTypesById);
  if (!candidates.length) return null;
  return { mode: "STEP_FANOUT", sourceInstance: input.settledSourceInstance, sourceTaskType: input.sourceTaskType, targetStep: null, targetTaskType: null, candidates };
}

// --- Format-specific previews (section 15-17), built separately from the
// WorkflowStep graph -- Material production tasks are standalone. ---

const FIRST_PRODUCTION_TASK_TYPE_NAME_BY_FORMAT: Record<MaterialFormat, string> = {
  REEL: "Reel Script",
  CAROUSEL: "Carousel",
  TEXT_POST: "Text Post",
  YOUTUBE: "YouTube",
};

/** Pure. One candidate per (CREATE_CONTENT AtomicIdea x selected format)
 * pair -- the same idea selected for Reel + Carousel produces two
 * candidates here, and later two Material entities (section 16). Returns
 * null when there is nothing to preview (no CREATE_CONTENT ideas, or none
 * with a selected format, or the mapped Task Type is missing). */
export function buildFormatPreviewPlan(
  repurposeMapInstance: TaskInstance,
  blogId: string,
  atomicIdeas: readonly AtomicIdea[],
  taskTypesById: ReadonlyMap<string, TaskType>,
): PreviewPlan | null {
  const sourceTaskType = taskTypesById.get(repurposeMapInstance.taskTypeId);
  if (!sourceTaskType) return null;
  const taskTypeByName = new Map([...taskTypesById.values()].map((t) => [t.name, t]));

  const candidates: PreviewCandidate[] = [];
  for (const idea of atomicIdeas) {
    if (idea.decision !== "CREATE_CONTENT") continue;
    for (const format of idea.selectedFormats) {
      const taskType = taskTypeByName.get(FIRST_PRODUCTION_TASK_TYPE_NAME_BY_FORMAT[format]);
      if (!taskType) continue;
      candidates.push({ kind: "MATERIAL_FROM_ATOMIC_IDEA", key: `${idea.id}-${format}`, atomicIdea: idea, format, blogId, taskType });
    }
  }
  if (!candidates.length) return null;
  return { mode: "MATERIAL_FORMAT_GROUPS", sourceInstance: repurposeMapInstance, sourceTaskType, targetStep: null, targetTaskType: null, candidates };
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
   * candidate (RESEARCH_TO_BLOGS, STEP_FANOUT, MATERIAL_FORMAT_GROUPS). */
  readonly selections: readonly TransferSelection[];
  /** Only meaningful for ANGLE_TO_ANGLES. */
  /** Only meaningful for CHANNEL_PUBLISH. */
  readonly publishMode?: string;
  readonly note?: string;
  readonly category?: string;
  readonly usage?: AngleUsage;
  readonly priority?: AnglePriority;
}

export interface ConfirmOutcome {
  readonly problemParts: readonly ProblemPart[];
  readonly knowledgeNodes: readonly KnowledgeNode[];
  readonly knowledgeNodeStatusUpdates: readonly { readonly id: string; readonly status: KnowledgeNodeStatus }[];
  readonly blogs: readonly Blog[];
  readonly angles: readonly Angle[];
  readonly materials: readonly Material[];
  readonly taskDrafts: readonly TaskInstanceDraft[];
  /** Any further content-entity mutation a mode needs beyond the typed
   * fields above (e.g. marking a ShootSession COMPLETED). */
  readonly entityActions: readonly ContentEntityAction[];
}

const EMPTY_OUTCOME: ConfirmOutcome = { problemParts: [], knowledgeNodes: [], knowledgeNodeStatusUpdates: [], blogs: [], angles: [], materials: [], taskDrafts: [], entityActions: [] };

/** Pure. Every content-entity mutation a confirmed outcome implies, as
 * reducer actions -- so the orchestrator applies ANY outcome (generic or
 * handler-produced) through one code path. */
export function outcomeToEntityActions(outcome: ConfirmOutcome): ContentEntityAction[] {
  const actions: ContentEntityAction[] = [];
  if (outcome.problemParts.length) actions.push({ type: "ADD_PROBLEM_PARTS", parts: outcome.problemParts });
  if (outcome.knowledgeNodes.length) actions.push({ type: "ADD_KNOWLEDGE_NODES", nodes: outcome.knowledgeNodes });
  if (outcome.blogs.length) actions.push({ type: "ADD_BLOGS", blogs: outcome.blogs });
  if (outcome.angles.length) actions.push({ type: "ADD_ANGLES", angles: outcome.angles });
  if (outcome.materials.length) actions.push({ type: "ADD_MATERIALS", materials: outcome.materials });
  for (const update of outcome.knowledgeNodeStatusUpdates) actions.push({ type: "SET_KNOWLEDGE_NODE_STATUS", id: update.id, status: update.status });
  actions.push(...outcome.entityActions);
  return actions;
}

/** Pure. `plan` must be the exact plan the UI rendered; `selections` is
 * the employee's final edited/include state for each candidate, keyed by
 * `PreviewCandidate.key`. Only `included` candidates produce anything. */
export function confirmPreviewPlan(plan: PreviewPlan, selections: readonly CandidateSelectionState[], now: () => string = () => new Date().toISOString()): ConfirmOutcome {
  const selectionByKey = new Map(selections.filter((s) => s.included).map((s) => [s.key, s]));
  // SHOOT_PRODUCTION's tasks are all required, so "nothing selected" is not
  // a way to create nothing there -- only Cancel (never calling confirm) is.
  if (!selectionByKey.size && plan.mode !== "SHOOT_PRODUCTION") return EMPTY_OUTCOME;

  switch (plan.mode) {
    case "PROBLEM_SPLIT_TO_PARTS":
      return confirmProblemSplit(plan, selectionByKey, now);
    case "KNOWLEDGE_DISCOVERY_TO_NODES":
      return confirmKnowledgeDiscovery(plan, selectionByKey, now);
    case "RESEARCH_TO_BLOGS":
      return confirmResearch(plan, selectionByKey, now);
    case "ANGLE_TO_ANGLES":
      return confirmAngle(plan, selectionByKey, now);
    case "MATERIAL_FORMAT_GROUPS":
      return confirmMaterialFormatGroups(plan, selectionByKey, now);
    case "SHOOT_PRODUCTION":
      return confirmShootProduction(plan, selections, now);
    case "CHANNEL_PUBLISH":
      return confirmChannelPublish(plan, selectionByKey);
    case "REPUBLISH_FIX":
      return confirmRepublishFix(plan, selectionByKey);
    case "STEP_FANOUT":
      return { ...EMPTY_OUTCOME, taskDrafts: confirmStepFanoutCandidates(plan, plan.candidates as readonly StepFanoutPreviewCandidate[], selectionByKey) };
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

function confirmAngle(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  const nodeRef = plan.sourceInstance.contentRef;
  const angles: Angle[] = [];
  if (nodeRef && nodeRef.entityType === "KNOWLEDGE_NODE") {
    for (const candidate of plan.candidates.filter((c): c is AnglePreviewCandidate => c.kind === "ANGLE_TO_ANGLES")) {
      const selection = selectionByKey.get(candidate.key);
      if (!selection) continue;
      angles.push(
        createAngle(
          nodeRef.entityId,
          { title: selection.title.trim() || candidate.text, category: selection.category, usage: selection.usage, priority: selection.priority },
          plan.sourceInstance.id,
          now,
        ),
      );
    }
  }
  const fanoutCandidates = plan.candidates.filter((c): c is StepFanoutPreviewCandidate => c.kind === "STEP_FANOUT");
  const taskDrafts = confirmStepFanoutCandidates(plan, fanoutCandidates, selectionByKey);
  return { ...EMPTY_OUTCOME, angles, taskDrafts };
}

function confirmMaterialFormatGroups(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>, now: () => string): ConfirmOutcome {
  const materials: Material[] = [];
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates as readonly MaterialPreviewCandidate[]) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    const idea = candidate.atomicIdea;
    const material = createMaterial(
      {
        blogId: candidate.blogId,
        title: selection.title.trim() || `${idea.text} — ${candidate.format}`,
        format: candidate.format,
        primaryAtomicIdeaId: idea.id,
        angleId: idea.angleId,
        destinationNeeded: idea.destinationNeeded,
        sourceTaskId: plan.sourceInstance.id,
      },
      now,
    );
    // Section 16: the first authoring task is created together with the
    // Material, so it starts IN_PRODUCTION rather than lingering PLANNED.
    materials.push(setMaterialStatus(material, "IN_PRODUCTION", now));
    // Only the FIRST production task is created (section 17) -- never
    // the rest of the chain. Standalone: Material production isn't part
    // of any WorkflowTemplate graph.
    const seed = buildStandaloneTaskInstanceSeed(candidate.taskType, material.title, plan.sourceInstance.id, ref("MATERIAL", material.id));
    const transferred = applyContextTransfer(seed, plan.sourceInstance, selection.selections);
    taskDrafts.push({ ...seed, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null, fieldValues: transferred.fieldValues, fieldProvenance: transferred.fieldProvenance });
  }
  return { ...EMPTY_OUTCOME, materials, taskDrafts };
}

/** Shared by STEP_FANOUT and ANGLE_TO_ANGLES's mixed fanout extras: entity
 * context propagates down the chain unchanged (e.g. Head Review inherits
 * the same KnowledgeNode Blog was "working on"). */
function confirmStepFanoutCandidates(
  plan: PreviewPlan,
  candidates: readonly StepFanoutPreviewCandidate[],
  selectionByKey: ReadonlyMap<string, CandidateSelectionState>,
): TaskInstanceDraft[] {
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of candidates) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    const seed = buildTaskInstanceSeed(candidate.step, candidate.taskType, plan.sourceInstance.id, plan.sourceInstance.contentRef, plan.sourceInstance.relatedEntityRefs);
    const transferred = applyContextTransfer(seed, plan.sourceInstance, selection.selections);
    taskDrafts.push({ ...seed, title: selection.title.trim() || seed.title, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null, fieldValues: transferred.fieldValues, fieldProvenance: transferred.fieldProvenance });
  }
  return taskDrafts;
}

// --- Shoot completion (Sprint 5, sections 11-13) ---

/** The three tasks every Material of a completed Shoot Session gets, in
 * parallel. Approved product rule -- not configurable per session. */
export const SHOOT_PRODUCTION_TASK_TYPE_NAMES = ["Edit", "Cover", "Caption"] as const;

/** Pure. `shootInstance`'s contentRef points at the ShootSession (the
 * smallest clear representation of a batch task -- see
 * material-production.ts); its materials come from the session, never
 * from guessing. One candidate per (Material x Edit/Cover/Caption); returns
 * null if the session or its materials cannot be resolved. */
export function buildShootProductionPlan(
  shootInstance: TaskInstance,
  contentEntities: ContentEntityState,
  taskTypesById: ReadonlyMap<string, TaskType>,
): PreviewPlan | null {
  const sessionRef = shootInstance.contentRef;
  if (!sessionRef || sessionRef.entityType !== "SHOOT_SESSION") return null;
  const session = contentEntities.shootSessions.find((s) => s.id === sessionRef.entityId);
  const sourceTaskType = taskTypesById.get(shootInstance.taskTypeId);
  if (!session || !sourceTaskType) return null;
  const taskTypeByName = new Map([...taskTypesById.values()].map((t) => [t.name, t]));

  const candidates: PreviewCandidate[] = [];
  for (const materialId of session.materialIds) {
    const material = contentEntities.materials.find((m) => m.id === materialId);
    if (!material) continue;
    for (const name of SHOOT_PRODUCTION_TASK_TYPE_NAMES) {
      const taskType = taskTypeByName.get(name);
      if (!taskType) continue;
      candidates.push({ kind: "PRODUCTION_TASK", key: `${material.id}-${name}`, material, taskType, required: true });
    }
  }
  if (!candidates.length) return null;
  return { mode: "SHOOT_PRODUCTION", sourceInstance: shootInstance, sourceTaskType, targetStep: null, targetTaskType: null, candidates };
}

function confirmShootProduction(plan: PreviewPlan, selections: readonly CandidateSelectionState[], now: () => string): ConfirmOutcome {
  void now;
  const selectionByKey = new Map(selections.map((s) => [s.key, s]));
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates.filter((c): c is ProductionTaskPreviewCandidate => c.kind === "PRODUCTION_TASK")) {
    // Required: an `included: false` selection is ignored on purpose.
    const selection = selectionByKey.get(candidate.key);
    const defaultTitle = `${candidate.taskType.name} — ${candidate.material.title}`;
    const seed = buildStandaloneTaskInstanceSeed(candidate.taskType, defaultTitle, plan.sourceInstance.id, ref("MATERIAL", candidate.material.id));
    const transferred = selection ? applyContextTransfer(seed, plan.sourceInstance, selection.selections) : { fieldValues: seed.fieldValues, fieldProvenance: [] };
    taskDrafts.push({
      ...seed,
      title: selection?.title.trim() || defaultTitle,
      assignee: selection ? selection.assignee.trim() || null : seed.assignee,
      deadline: selection?.deadline || null,
      fieldValues: transferred.fieldValues,
      fieldProvenance: transferred.fieldProvenance,
    });
  }
  const sessionRef = plan.sourceInstance.contentRef;
  const entityActions: ContentEntityAction[] = sessionRef?.entityType === "SHOOT_SESSION" ? [{ type: "SET_SHOOT_SESSION_STATUS", id: sessionRef.entityId, status: "COMPLETED" }] : [];
  return { ...EMPTY_OUTCOME, taskDrafts, entityActions };
}

// --- Distribution Plan -> per-channel Publish/Schedule (Sprint 6) ---

/** Pure. One candidate per channel selected in the Distribution Plan's
 * `channels` field. Returns null when none is selected or the Publish
 * Task Type is missing. */
export function buildChannelPublishPlan(
  planInstance: TaskInstance,
  contentEntities: ContentEntityState,
  taskTypesById: ReadonlyMap<string, TaskType>,
  publishTaskTypeName: string,
): PreviewPlan | null {
  const materialRef = planInstance.contentRef;
  if (!materialRef || materialRef.entityType !== "MATERIAL") return null;
  const material = contentEntities.materials.find((m) => m.id === materialRef.entityId);
  const sourceTaskType = taskTypesById.get(planInstance.taskTypeId);
  const taskType = [...taskTypesById.values()].find((t) => t.name === publishTaskTypeName);
  const channels = planInstance.fieldValues["channels"];
  if (!material || !sourceTaskType || !taskType || !Array.isArray(channels) || !channels.length) return null;
  const candidates: PreviewCandidate[] = channels.map((channel) => ({ kind: "CHANNEL_PUBLISH" as const, key: `${material.id}-${channel}`, channel, material, taskType }));
  return { mode: "CHANNEL_PUBLISH", sourceInstance: planInstance, sourceTaskType, targetStep: null, targetTaskType: null, candidates };
}

function confirmChannelPublish(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>): ConfirmOutcome {
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates.filter((c): c is ChannelPublishPreviewCandidate => c.kind === "CHANNEL_PUBLISH")) {
    const selection = selectionByKey.get(candidate.key); // excluded channel: no selection, no task
    if (!selection) continue;
    const defaultTitle = `${candidate.taskType.name} — ${candidate.channel} — ${candidate.material.title}`;
    const seed = buildStandaloneTaskInstanceSeed(candidate.taskType, defaultTitle, plan.sourceInstance.id, ref("MATERIAL", candidate.material.id));
    taskDrafts.push({
      ...seed,
      title: selection.title.trim() || defaultTitle,
      assignee: selection.assignee.trim() || null,
      deadline: selection.deadline || null,
      fieldValues: { channel: candidate.channel, "publish-mode": selection.publishMode === "PUBLISH_NOW" ? "PUBLISH_NOW" : "SCHEDULE", ...(selection.note?.trim() ? { "channel-note": selection.note.trim() } : {}) },
    });
  }
  return { ...EMPTY_OUTCOME, taskDrafts };
}

/** Pure. Offers one Fix / Republish task for a failed or problematic
 * Publish Check. Returns null when the Task Type is missing. */
export function buildRepublishFixPlan(
  checkInstance: TaskInstance,
  contentEntities: ContentEntityState,
  taskTypesById: ReadonlyMap<string, TaskType>,
  fixTaskTypeName: string,
): PreviewPlan | null {
  const materialRef = checkInstance.contentRef;
  if (!materialRef || materialRef.entityType !== "MATERIAL") return null;
  const material = contentEntities.materials.find((m) => m.id === materialRef.entityId);
  const sourceTaskType = taskTypesById.get(checkInstance.taskTypeId);
  const taskType = [...taskTypesById.values()].find((t) => t.name === fixTaskTypeName);
  if (!material || !sourceTaskType || !taskType) return null;
  const channel = typeof checkInstance.fieldValues["channel"] === "string" ? checkInstance.fieldValues["channel"] : "";
  const candidates: PreviewCandidate[] = [{ kind: "REPUBLISH_FIX", key: `${checkInstance.id}-fix`, channel, material, taskType }];
  return { mode: "REPUBLISH_FIX", sourceInstance: checkInstance, sourceTaskType, targetStep: null, targetTaskType: null, candidates };
}

function confirmRepublishFix(plan: PreviewPlan, selectionByKey: ReadonlyMap<string, CandidateSelectionState>): ConfirmOutcome {
  const taskDrafts: TaskInstanceDraft[] = [];
  for (const candidate of plan.candidates.filter((c): c is RepublishFixPreviewCandidate => c.kind === "REPUBLISH_FIX")) {
    const selection = selectionByKey.get(candidate.key);
    if (!selection) continue;
    const defaultTitle = `${candidate.taskType.name} — ${candidate.channel} — ${candidate.material.title}`;
    const seed = buildStandaloneTaskInstanceSeed(candidate.taskType, defaultTitle, plan.sourceInstance.id, ref("MATERIAL", candidate.material.id));
    taskDrafts.push({ ...seed, title: selection.title.trim() || defaultTitle, assignee: selection.assignee.trim() || null, deadline: selection.deadline || null, fieldValues: { channel: candidate.channel } });
  }
  return { ...EMPTY_OUTCOME, taskDrafts };
}

// --- Destination Decision (sections 7-9): handled directly, not through
// buildPreviewPlan -- there is nothing left to "preview": the task's own
// fields already captured the decision. ---

const DESTINATION_CREATION_TASK_TYPE_NAME: Record<DestinationType, string> = {
  YOUTUBE: "YouTube Outline",
  CHECKLIST_OR_PDF: "Checklist / PDF Creation",
  EXTERNAL_TOOL_OR_URL: "External Tool Setup",
};

export interface DestinationDecisionOutcome {
  readonly destination: Destination | null;
  readonly angleDestinationLinks: readonly AngleDestinationLink[];
  readonly firstTaskDraft: TaskInstanceDraft | null;
}

const EMPTY_DESTINATION_DECISION_OUTCOME: DestinationDecisionOutcome = { destination: null, angleDestinationLinks: [], firstTaskDraft: null };

/**
 * Pure. `instance` must be the settled Destination Decision TaskInstance.
 * Reads `create-new` + `chosen-destination-id` + `destination-type` from
 * its own fieldValues (populated by Task Detail's reuse/create-new UI,
 * not typed in directly). On reuse, links every Angle under the same
 * KnowledgeNode to the chosen Destination -- no new entity. On create
 * new, creates one PLANNED Destination + prepares its first local
 * creation task (section 9), then links the same Angles to it.
 */
export function applyDestinationDecision(
  instance: TaskInstance,
  contentEntities: ContentEntityState,
  taskTypesById: ReadonlyMap<string, TaskType>,
  now: () => string = () => new Date().toISOString(),
): DestinationDecisionOutcome {
  const nodeRef = instance.contentRef;
  if (!nodeRef || nodeRef.entityType !== "KNOWLEDGE_NODE") return EMPTY_DESTINATION_DECISION_OUTCOME;
  const node = contentEntities.knowledgeNodes.find((n) => n.id === nodeRef.entityId);
  if (!node) return EMPTY_DESTINATION_DECISION_OUTCOME;
  const problemPart = contentEntities.problemParts.find((p) => p.id === node.problemPartId);
  if (!problemPart) return EMPTY_DESTINATION_DECISION_OUTCOME;

  const createNew = instance.fieldValues["create-new"] === true;
  const chosenDestinationId = typeof instance.fieldValues["chosen-destination-id"] === "string" ? instance.fieldValues["chosen-destination-id"] : "";

  let destination: Destination | null = null;
  let destinationId = chosenDestinationId;
  let firstTaskDraft: TaskInstanceDraft | null = null;

  if (createNew) {
    const destinationType = (instance.fieldValues["destination-type"] as DestinationType | undefined) ?? "EXTERNAL_TOOL_OR_URL";
    destination = createDestination({ problemCategoryId: problemPart.problemCategoryId, name: `${node.name} — destination`, type: destinationType, sourceTaskId: instance.id }, now);
    destinationId = destination.id;
    const taskTypeName = DESTINATION_CREATION_TASK_TYPE_NAME[destinationType];
    const taskType = [...taskTypesById.values()].find((t) => t.name === taskTypeName);
    if (taskType) firstTaskDraft = buildStandaloneTaskInstanceSeed(taskType, taskTypeName, instance.id, ref("DESTINATION", destination.id));
  }

  if (!destinationId) return { destination, angleDestinationLinks: [], firstTaskDraft };
  const angleDestinationLinks = anglesForKnowledgeNode(contentEntities, node.id).map((angle) => createAngleDestinationLink(angle.id, destinationId, now));
  return { destination, angleDestinationLinks, firstTaskDraft };
}

// --- Repurpose Map's AtomicIdeaDraft -> AtomicIdea conversion (sections
// 12-13): handled directly at Complete time, same reasoning as
// Destination Decision -- the drafts were already live-edited inside the
// task, there is nothing further to "preview" about them. ---

export function confirmAtomicIdeaDrafts(repurposeMapId: string, drafts: readonly AtomicIdeaDraft[], now: () => string = () => new Date().toISOString()): readonly AtomicIdea[] {
  return drafts.map((draft) =>
    createAtomicIdea(
      { repurposeMapId, text: draft.text, coverageType: draft.coverageType, decision: draft.decision, selectedFormats: draft.selectedFormats, angleId: draft.angleId, destinationNeeded: draft.destinationNeeded },
      now,
    ),
  );
}

export type { AtomicIdeaCoverageType, AtomicIdeaDecision };

// --- "Working on" display (section 14) ---

const ENTITY_TYPE_LABELS_UZ: Record<ContentEntityRef["entityType"], string> = {
  DOMAIN: "Domain",
  PROBLEM_CATEGORY: "Muammo toifasi",
  PROBLEM_PART: "Muammo qismi",
  KNOWLEDGE_NODE: "Knowledge Node",
  BLOG: "Blog",
  MATERIAL: "Material",
  ANGLE: "Angle",
  DESTINATION: "Destination",
  REPURPOSE_MAP: "Repurpose Map",
  SHOOT_SESSION: "Shoot Session",
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
