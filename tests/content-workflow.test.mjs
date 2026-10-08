import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-content-workflow-"));
for (const name of [
  "task-type",
  "task-type-fixtures",
  "workflow-template",
  "workflow-template-fixtures",
  "task-link",
  "task-instance",
  "content-entity",
  "content-entity-fixtures",
  "content-entity-store",
  "workflow-runtime",
  "content-workflow",
]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES, findTaskTypeFixtureByName } = require(join(dir, "task-type-fixtures.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE } = require(join(dir, "workflow-template-fixtures.js"));
const { createTaskInstance, markTaskInstanceDone } = require(join(dir, "task-instance.js"));
const { ref, createKnowledgeNode } = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer, destinationsForProblemCategory } = require(join(dir, "content-entity-store.js"));
const {
  buildPreviewPlan,
  confirmPreviewPlan,
  entityTypeLabelUz,
  applyDestinationDecision,
  confirmAtomicIdeaDrafts,
  buildFormatPreviewPlan,
} = require(join(dir, "content-workflow.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-09T02:00:${String(tick++).padStart(2, "0")}.000Z`;

const template = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE;
const taskTypesById = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const stepByTaskTypeName = (name) => template.steps.find((s) => taskTypesById.get(s.taskTypeId)?.name === name);

function instanceForStep(step, overrides = {}) {
  const taskType = taskTypesById.get(step.taskTypeId);
  return createTaskInstance({
    taskTypeId: taskType.id,
    workflowTemplateId: template.id,
    workflowStepId: step.id,
    title: step.nameTemplate,
    assignee: null,
    deadline: "2026-10-20",
    fieldValues: {},
    customFields: [],
    links: [],
    sourceTaskId: null,
    ...overrides,
  }, fixedNow);
}

function selectAll(plan, overrides = {}) {
  return plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "", selections: [], ...overrides }));
}

// --- Problem Split -> ProblemPart candidates ---

test("Problem Split: multiple Components lines become preview candidates", () => {
  const problemSplitStep = stepByTaskTypeName("Problem Split");
  const entityState = initialContentEntityState();
  const problemCategory = entityState.problemCategories[0];
  const source = markTaskInstanceDone(instanceForStep(problemSplitStep, {
    fieldValues: { components: "Komponent A\nKomponent B\nKomponent C" },
    contentRef: ref("PROBLEM_CATEGORY", problemCategory.id),
  }), fixedNow);

  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Problem Split"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "PROBLEM_SPLIT_TO_PARTS");
  assert.equal(plan.candidates.length, 3);
  assert.deepEqual(plan.candidates.map((c) => c.text), ["Komponent A", "Komponent B", "Komponent C"]);
});

test("Problem Split: selected components create ProblemPart entities and one Knowledge Discovery task each", () => {
  const problemSplitStep = stepByTaskTypeName("Problem Split");
  const entityState = initialContentEntityState();
  const problemCategory = entityState.problemCategories[0];
  const source = markTaskInstanceDone(instanceForStep(problemSplitStep, {
    fieldValues: { components: "Komponent A\nKomponent B\nKomponent C" },
    contentRef: ref("PROBLEM_CATEGORY", problemCategory.id),
  }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Problem Split"), taskTypesById, contentEntities: entityState });

  const selections = selectAll(plan).map((s, i) => (i === 1 ? { ...s, included: false } : s)); // exclude "Komponent B"
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);
  assert.equal(outcome.problemParts.length, 2);
  assert.deepEqual(outcome.problemParts.map((p) => p.name), ["Komponent A", "Komponent C"]);
  assert.equal(outcome.taskDrafts.length, 2);
  for (const draft of outcome.taskDrafts) {
    assert.equal(taskTypesById.get(draft.taskTypeId).name, "Knowledge Discovery");
    assert.equal(draft.contentRef.entityType, "PROBLEM_PART");
  }
  assert.equal(outcome.problemParts[0].sourceTaskId, source.id);
});

// --- Knowledge Discovery -> KnowledgeNode candidates, ONE shared Research task ---

test("Knowledge Discovery: selected candidates create KnowledgeNode entities", () => {
  const knowledgeDiscoveryStep = stepByTaskTypeName("Knowledge Discovery");
  const entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const source = markTaskInstanceDone(instanceForStep(knowledgeDiscoveryStep, {
    fieldValues: { "knowledge-nodes": "Node A\nNode B" },
    contentRef: ref("PROBLEM_PART", problemPart.id),
  }), fixedNow);

  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Knowledge Discovery"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "KNOWLEDGE_DISCOVERY_TO_NODES");

  const outcome = confirmPreviewPlan(plan, selectAll(plan), fixedNow);
  assert.equal(outcome.knowledgeNodes.length, 2);
  for (const node of outcome.knowledgeNodes) {
    assert.equal(node.problemPartId, problemPart.id);
    assert.equal(node.status, "UNPLANNED");
  }
});

test("Knowledge Discovery confirm creates exactly ONE shared Research task referencing every selected node", () => {
  const knowledgeDiscoveryStep = stepByTaskTypeName("Knowledge Discovery");
  const entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const source = markTaskInstanceDone(instanceForStep(knowledgeDiscoveryStep, {
    fieldValues: { "knowledge-nodes": "Node A\nNode B\nNode C" },
    contentRef: ref("PROBLEM_PART", problemPart.id),
  }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Knowledge Discovery"), taskTypesById, contentEntities: entityState });

  const outcome = confirmPreviewPlan(plan, selectAll(plan), fixedNow);
  assert.equal(outcome.taskDrafts.length, 1, "one shared Research task, not one per node");
  const [researchDraft] = outcome.taskDrafts;
  assert.equal(taskTypesById.get(researchDraft.taskTypeId).name, "Research");
  assert.equal(researchDraft.relatedEntityRefs.length, 3);
  assert.deepEqual(researchDraft.relatedEntityRefs.map((r) => r.entityType), ["KNOWLEDGE_NODE", "KNOWLEDGE_NODE", "KNOWLEDGE_NODE"]);
});

// --- Research -> multiple Blogs (the critical multiplicity demo) ---

test("Research: one research can reference multiple KnowledgeNodes, and only selected nodes get Blog tasks", () => {
  const researchStep = stepByTaskTypeName("Research");
  let entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const nodeA = createKnowledgeNode(problemPart.id, "Node A", "ti-kd-1", fixedNow);
  const nodeB = createKnowledgeNode(problemPart.id, "Node B", "ti-kd-1", fixedNow);
  const nodeC = createKnowledgeNode(problemPart.id, "Node C", "ti-kd-1", fixedNow);
  entityState = contentEntityReducer(entityState, { type: "ADD_KNOWLEDGE_NODES", nodes: [nodeA, nodeB, nodeC] }, fixedNow);

  const source = markTaskInstanceDone(instanceForStep(researchStep, {
    fieldValues: { "research-link": "https://example.com/research", "research-summary": "Summary" },
    contentRef: ref("PROBLEM_PART", problemPart.id),
    relatedEntityRefs: [ref("KNOWLEDGE_NODE", nodeA.id), ref("KNOWLEDGE_NODE", nodeB.id), ref("KNOWLEDGE_NODE", nodeC.id)],
  }), fixedNow);

  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Research"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "RESEARCH_TO_BLOGS");
  assert.equal(plan.candidates.length, 3);

  // Select only Node A and Node B for a Blog task now; Node C stays unplanned.
  const selections = plan.candidates.map((c) => ({ key: c.key, included: c.node.id !== nodeC.id, title: "", assignee: "", deadline: "", selections: [] }));
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);

  assert.equal(outcome.blogs.length, 2);
  assert.equal(outcome.taskDrafts.length, 2);
  for (const draft of outcome.taskDrafts) assert.equal(taskTypesById.get(draft.taskTypeId).name, "Blog");
  assert.deepEqual(outcome.knowledgeNodeStatusUpdates.map((u) => u.id).sort(), [nodeA.id, nodeB.id].sort());
  assert.ok(!outcome.knowledgeNodeStatusUpdates.some((u) => u.id === nodeC.id), "unselected Node C must not get a status update -- it stays UNPLANNED");
});

test("the plan always carries the SOURCE instance's own Task Type, distinct from targetTaskType -- needed so Context Transfer labels the source's own fields, not the target's", () => {
  const researchStep = stepByTaskTypeName("Research");
  let entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const node = createKnowledgeNode(problemPart.id, "Node A", "ti-kd-1", fixedNow);
  entityState = contentEntityReducer(entityState, { type: "ADD_KNOWLEDGE_NODES", nodes: [node] }, fixedNow);
  const source = markTaskInstanceDone(instanceForStep(researchStep, { relatedEntityRefs: [ref("KNOWLEDGE_NODE", node.id)] }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Research"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.sourceTaskType.name, "Research");
  assert.equal(plan.targetTaskType.name, "Blog");
  assert.notEqual(plan.sourceTaskType.id, plan.targetTaskType.id);
});

test("Research: a Blog task's contentRef is the KnowledgeNode it writes about", () => {
  const researchStep = stepByTaskTypeName("Research");
  let entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const node = createKnowledgeNode(problemPart.id, "Node A", "ti-kd-1", fixedNow);
  entityState = contentEntityReducer(entityState, { type: "ADD_KNOWLEDGE_NODES", nodes: [node] }, fixedNow);
  const source = markTaskInstanceDone(instanceForStep(researchStep, { relatedEntityRefs: [ref("KNOWLEDGE_NODE", node.id)] }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Research"), taskTypesById, contentEntities: entityState });
  const outcome = confirmPreviewPlan(plan, selectAll(plan), fixedNow);
  assert.deepEqual(outcome.taskDrafts[0].contentRef, ref("KNOWLEDGE_NODE", node.id));
  assert.equal(entityTypeLabelUz("KNOWLEDGE_NODE"), "Knowledge Node");
});

test("Research: an already-PLANNED node is never offered again as a candidate", () => {
  const researchStep = stepByTaskTypeName("Research");
  let entityState = initialContentEntityState();
  const problemPart = entityState.problemParts[0];
  const node = createKnowledgeNode(problemPart.id, "Node A", "ti-kd-1", fixedNow);
  entityState = contentEntityReducer(entityState, { type: "ADD_KNOWLEDGE_NODES", nodes: [node] }, fixedNow);
  entityState = contentEntityReducer(entityState, { type: "SET_KNOWLEDGE_NODE_STATUS", id: node.id, status: "PLANNED" }, fixedNow);
  const source = markTaskInstanceDone(instanceForStep(researchStep, { relatedEntityRefs: [ref("KNOWLEDGE_NODE", node.id)] }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Research"), taskTypesById, contentEntities: entityState });
  assert.equal(plan, null);
});

// --- Task / entity relation does not change the task status model ---

test("a task references an entity via contentRef without any new task status, and no tasks.content_ref field exists", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const instance = instanceForStep(blogStep, { contentRef: ref("KNOWLEDGE_NODE", "node-1") });
  assert.ok(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"].includes(instance.status));
  assert.equal("content_ref" in instance, false);
  assert.deepEqual(instance.contentRef, { entityType: "KNOWLEDGE_NODE", entityId: "node-1" });
});

// --- Blog parallel branch still works under Sprint 3's rewrite ---

test("Blog completion still exposes Head Review + SEO + Angle + Performance Consultation as parallel immediate tasks", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const source = markTaskInstanceDone(instanceForStep(blogStep), fixedNow);
  const entityState = initialContentEntityState();
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Blog"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "STEP_FANOUT");
  const names = plan.candidates.map((c) => c.taskType.name).sort();
  assert.deepEqual(names, ["Angle", "Head Review", "Performance Consultation", "SEO"]);
});

test("Repurpose Map (V1 Sprint 4) is gated by BOTH Head Review and Destination Decision, which itself needs Blog + Angle + Performance Consultation (not SEO)", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const headReviewStep = stepByTaskTypeName("Head Review");
  const angleStep = stepByTaskTypeName("Angle");
  const perfStep = stepByTaskTypeName("Performance Consultation");
  const destinationDecisionStep = stepByTaskTypeName("Destination Decision");
  const entityState = initialContentEntityState();

  const node = entityState.knowledgeNodes[0];
  const nodeRef = ref("KNOWLEDGE_NODE", node.id);

  const blog = markTaskInstanceDone(instanceForStep(blogStep, { contentRef: nodeRef }), fixedNow);
  const headReview = markTaskInstanceDone(instanceForStep(headReviewStep, { sourceTaskId: blog.id, contentRef: nodeRef }), fixedNow);

  // Blog alone: Destination Decision not yet generatable (Angle/Performance Consultation not done).
  const fromBlog = buildPreviewPlan({ template, allInstances: [blog], settledSourceInstance: blog, sourceTaskType: findTaskTypeFixtureByName("Blog"), taskTypesById, contentEntities: entityState });
  assert.ok(!fromBlog.candidates.some((c) => c.taskType?.name === "Destination Decision"));

  // Head Review alone: Repurpose Map not yet eligible (Destination Decision not settled).
  const fromHeadReviewOnly = buildPreviewPlan({ template, allInstances: [blog, headReview], settledSourceInstance: headReview, sourceTaskType: findTaskTypeFixtureByName("Head Review"), taskTypesById, contentEntities: entityState });
  assert.equal(fromHeadReviewOnly, null, "Repurpose Map must wait for Destination Decision too");

  const angle = markTaskInstanceDone(instanceForStep(angleStep, { sourceTaskId: blog.id, contentRef: nodeRef, fieldValues: { angles: "" } }), fixedNow);
  const perf = markTaskInstanceDone(instanceForStep(perfStep, { sourceTaskId: blog.id, contentRef: nodeRef }), fixedNow);

  // Angle alone (no Performance Consultation yet): Destination Decision still not eligible.
  const fromAngleOnly = buildPreviewPlan({ template, allInstances: [blog, headReview, angle], settledSourceInstance: angle, sourceTaskType: findTaskTypeFixtureByName("Angle"), taskTypesById, contentEntities: entityState });
  assert.ok(!fromAngleOnly || !fromAngleOnly.candidates.some((c) => c.taskType?.name === "Destination Decision"));

  // Performance Consultation completes last: Destination Decision becomes generatable (resolved via shared contentRef, not ancestor lineage).
  const fromPerf = buildPreviewPlan({ template, allInstances: [blog, headReview, angle, perf], settledSourceInstance: perf, sourceTaskType: findTaskTypeFixtureByName("Performance Consultation"), taskTypesById, contentEntities: entityState });
  assert.equal(fromPerf.mode, "STEP_FANOUT");
  assert.deepEqual(fromPerf.candidates.map((c) => c.taskType.name), ["Destination Decision"]);

  const destinationDecision = markTaskInstanceDone(instanceForStep(destinationDecisionStep, { sourceTaskId: perf.id, contentRef: nodeRef }), fixedNow);
  const allInstances = [blog, headReview, angle, perf, destinationDecision];

  // Now Repurpose Map is eligible from EITHER Head Review's or Destination Decision's completion.
  const fromHeadReview = buildPreviewPlan({ template, allInstances, settledSourceInstance: headReview, sourceTaskType: findTaskTypeFixtureByName("Head Review"), taskTypesById, contentEntities: entityState });
  assert.deepEqual(fromHeadReview.candidates.map((c) => c.taskType.name), ["Repurpose Map"]);
  const fromDestinationDecision = buildPreviewPlan({ template, allInstances, settledSourceInstance: destinationDecision, sourceTaskType: findTaskTypeFixtureByName("Destination Decision"), taskTypesById, contentEntities: entityState });
  assert.deepEqual(fromDestinationDecision.candidates.map((c) => c.taskType.name), ["Repurpose Map"]);
});

// --- Angle (section 3-4): mixed entity-creation + fanout plan ---

test("Angle: at least 5 angle candidates are previewed; confirm creates Angle entities tied to the KnowledgeNode, no task", () => {
  const angleStep = stepByTaskTypeName("Angle");
  const entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];
  const source = markTaskInstanceDone(instanceForStep(angleStep, {
    fieldValues: { angles: "Ortiqcha xarid\nMuzlagan pul\nSotilmay qolgan bor tovar\nXodim jarayoni\nRahbar noto'g'ri qarori" },
    contentRef: ref("KNOWLEDGE_NODE", node.id),
  }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Angle"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "ANGLE_TO_ANGLES");
  assert.equal(plan.candidates.length, 5);

  const selections = plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "", selections: [], category: "Moliya", usage: "BOTH", priority: "NOW" }));
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);
  assert.equal(outcome.angles.length, 5);
  for (const angle of outcome.angles) {
    assert.equal(angle.knowledgeNodeId, node.id);
    assert.equal(angle.category, "Moliya");
  }
  assert.equal(outcome.taskDrafts.length, 0, "Angle candidates never create a task directly");
});

test("Angle: an excluded candidate is never persisted as an Angle entity", () => {
  const angleStep = stepByTaskTypeName("Angle");
  const entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];
  const source = markTaskInstanceDone(instanceForStep(angleStep, { fieldValues: { angles: "Angle A\nAngle B" }, contentRef: ref("KNOWLEDGE_NODE", node.id) }), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Angle"), taskTypesById, contentEntities: entityState });
  const selections = [
    { key: plan.candidates[0].key, included: true, title: "", assignee: "", deadline: "", selections: [] },
    { key: plan.candidates[1].key, included: false, title: "", assignee: "", deadline: "", selections: [] },
  ];
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);
  assert.equal(outcome.angles.length, 1);
  assert.equal(outcome.angles[0].title, "Angle A");
});

test("Angle plan mixes in a STEP_FANOUT candidate when Destination Decision is independently also unlocked by this completion", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const angleStep = stepByTaskTypeName("Angle");
  const perfStep = stepByTaskTypeName("Performance Consultation");
  const entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];

  const blog = markTaskInstanceDone(instanceForStep(blogStep, { contentRef: ref("KNOWLEDGE_NODE", node.id) }), fixedNow);
  const perf = markTaskInstanceDone(instanceForStep(perfStep, { sourceTaskId: blog.id, contentRef: ref("KNOWLEDGE_NODE", node.id) }), fixedNow);
  const angle = markTaskInstanceDone(instanceForStep(angleStep, { sourceTaskId: blog.id, contentRef: ref("KNOWLEDGE_NODE", node.id), fieldValues: { angles: "Angle A" } }), fixedNow);

  const plan = buildPreviewPlan({ template, allInstances: [blog, perf, angle], settledSourceInstance: angle, sourceTaskType: findTaskTypeFixtureByName("Angle"), taskTypesById, contentEntities: entityState });
  assert.equal(plan.mode, "ANGLE_TO_ANGLES");
  const kinds = plan.candidates.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["ANGLE_TO_ANGLES", "STEP_FANOUT"]);
  const fanout = plan.candidates.find((c) => c.kind === "STEP_FANOUT");
  assert.equal(fanout.taskType.name, "Destination Decision");
});

test("cancel (no selections at all) produces an empty outcome -- nothing is created", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const source = markTaskInstanceDone(instanceForStep(blogStep), fixedNow);
  const entityState = initialContentEntityState();
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: findTaskTypeFixtureByName("Blog"), taskTypesById, contentEntities: entityState });
  const outcome = confirmPreviewPlan(plan, plan.candidates.map((c) => ({ key: c.key, included: false, title: "", assignee: "", deadline: "", selections: [] })), fixedNow);
  assert.deepEqual(outcome.taskDrafts, []);
  assert.deepEqual(outcome.problemParts, []);
  assert.deepEqual(outcome.knowledgeNodes, []);
  assert.deepEqual(outcome.blogs, []);
});

// --- Destination Decision (sections 7-9): handled directly, not via buildPreviewPlan ---

function destinationDecisionInstance(nodeRef, fieldValues) {
  const destinationDecisionStep = stepByTaskTypeName("Destination Decision");
  return markTaskInstanceDone(instanceForStep(destinationDecisionStep, { contentRef: nodeRef, fieldValues }), fixedNow);
}

test("Destination Decision: reusing an existing destination creates a relation, not a duplicate entity", () => {
  const entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];
  const existing = entityState.destinations[0]; // the "Qoldiq audit checklist" fixture
  const instance = destinationDecisionInstance(ref("KNOWLEDGE_NODE", node.id), { "create-new": false, "chosen-destination-id": existing.id });
  const outcome = applyDestinationDecision(instance, entityState, taskTypesById, fixedNow);
  assert.equal(outcome.destination, null, "reuse must never create a new Destination entity");
  assert.equal(outcome.firstTaskDraft, null);
  assert.deepEqual(destinationsForProblemCategory(entityState, entityState.problemCategories[0].id).map((d) => d.id), [existing.id], "reuse must not duplicate the entity");
});

test("Destination Decision: create-new produces exactly one new Destination entity, starting PLANNED, plus its first creation task", () => {
  const entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];
  const instance = destinationDecisionInstance(ref("KNOWLEDGE_NODE", node.id), { "create-new": true, "chosen-destination-id": "", "destination-type": "CHECKLIST_OR_PDF" });
  const outcome = applyDestinationDecision(instance, entityState, taskTypesById, fixedNow);
  assert.ok(outcome.destination);
  assert.equal(outcome.destination.status, "PLANNED");
  assert.equal(outcome.destination.type, "CHECKLIST_OR_PDF");
  assert.equal(outcome.destination.problemCategoryId, entityState.problemCategories[0].id);
  assert.ok(outcome.firstTaskDraft);
  assert.equal(taskTypesById.get(outcome.firstTaskDraft.taskTypeId).name, "Checklist / PDF Creation");
  assert.deepEqual(outcome.firstTaskDraft.contentRef, ref("DESTINATION", outcome.destination.id));
});

test("Destination Decision: links every Angle under the same KnowledgeNode to the chosen/created destination", () => {
  let entityState = initialContentEntityState();
  const node = entityState.knowledgeNodes[0];
  const angleStep = stepByTaskTypeName("Angle");
  const angleSource = markTaskInstanceDone(instanceForStep(angleStep, { contentRef: ref("KNOWLEDGE_NODE", node.id), fieldValues: { angles: "A\nB" } }), fixedNow);
  const anglePlan = buildPreviewPlan({ template, allInstances: [angleSource], settledSourceInstance: angleSource, sourceTaskType: findTaskTypeFixtureByName("Angle"), taskTypesById, contentEntities: entityState });
  const angleOutcome = confirmPreviewPlan(anglePlan, anglePlan.candidates.filter((c) => c.kind === "ANGLE_TO_ANGLES").map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "", selections: [] })), fixedNow);
  entityState = contentEntityReducer(entityState, { type: "ADD_ANGLES", angles: angleOutcome.angles }, fixedNow);
  assert.equal(angleOutcome.angles.length, 2);

  const instance = destinationDecisionInstance(ref("KNOWLEDGE_NODE", node.id), { "create-new": true, "chosen-destination-id": "", "destination-type": "YOUTUBE" });
  const outcome = applyDestinationDecision(instance, entityState, taskTypesById, fixedNow);
  assert.equal(outcome.angleDestinationLinks.length, 2);
  assert.ok(outcome.angleDestinationLinks.every((link) => link.destinationId === outcome.destination.id));
});

test("Destination Decision: an unresolvable KnowledgeNode (bad contentRef) yields the empty outcome, never a guess", () => {
  const entityState = initialContentEntityState();
  const instance = destinationDecisionInstance(ref("KNOWLEDGE_NODE", "does-not-exist"), { "create-new": true, "destination-type": "YOUTUBE" });
  const outcome = applyDestinationDecision(instance, entityState, taskTypesById, fixedNow);
  assert.deepEqual(outcome, { destination: null, angleDestinationLinks: [], firstTaskDraft: null });
});

// --- Repurpose Map AtomicIdeaDraft -> AtomicIdea, then format-specific Material previews (sections 12-17) ---

test("confirmAtomicIdeaDrafts converts drafts into AtomicIdea entities tied to the RepurposeMap", () => {
  const drafts = [
    { id: "d1", text: "Muammo nima?", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL", "CAROUSEL"], angleId: null, destinationNeeded: true },
    { id: "d2", text: "Keyinroq", coverageType: "OTHER", decision: "LATER", selectedFormats: [], angleId: null, destinationNeeded: false },
  ];
  const ideas = confirmAtomicIdeaDrafts("rmap-1", drafts, fixedNow);
  assert.equal(ideas.length, 2);
  assert.equal(ideas[0].repurposeMapId, "rmap-1");
  assert.deepEqual(ideas[0].selectedFormats, ["REEL", "CAROUSEL"]);
  assert.notEqual(ideas[0].id, "d1", "a real AtomicIdea gets its own id, independent of the draft id");
});

test("buildFormatPreviewPlan: one atomic idea selecting Reel+Carousel+Text produces three candidates; confirm creates three Material entities and three first-tasks only", () => {
  const repurposeMapStep = stepByTaskTypeName("Repurpose Map");
  const repurposeMapInstance = markTaskInstanceDone(instanceForStep(repurposeMapStep), fixedNow);
  const ideas = confirmAtomicIdeaDrafts("rmap-1", [
    { id: "d1", text: "Muammo nima?", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL", "CAROUSEL", "TEXT_POST"], angleId: "angle-1", destinationNeeded: true },
  ], fixedNow);

  const plan = buildFormatPreviewPlan(repurposeMapInstance, "blog-1", ideas, taskTypesById);
  assert.equal(plan.mode, "MATERIAL_FORMAT_GROUPS");
  assert.equal(plan.candidates.length, 3);
  assert.deepEqual(plan.candidates.map((c) => c.format).sort(), ["CAROUSEL", "REEL", "TEXT_POST"]);

  const selections = plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "", selections: [] }));
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);
  assert.equal(outcome.materials.length, 3);
  assert.equal(outcome.taskDrafts.length, 3, "only the first production task per Material, never a chain");
  for (const material of outcome.materials) {
    assert.equal(material.blogId, "blog-1");
    assert.equal(material.primaryAtomicIdeaId, ideas[0].id);
    assert.equal(material.angleId, "angle-1");
    assert.equal(material.destinationNeeded, true);
    assert.equal(material.destinationId, null, "exact destination is chosen later, never forced here");
    assert.ok(!material.id.startsWith("ti-"), "Material ids are independent from TaskInstance ids");
  }
  const taskTypeNames = outcome.taskDrafts.map((d) => taskTypesById.get(d.taskTypeId).name).sort();
  assert.deepEqual(taskTypeNames, ["Carousel", "Reel Script", "Text Post"]);
  for (const draft of outcome.taskDrafts) {
    assert.equal(draft.workflowStepId, null, "production tasks are standalone, not part of any WorkflowTemplate");
    assert.equal(draft.contentRef.entityType, "MATERIAL");
  }
});

test("buildFormatPreviewPlan excludes BLOG_ONLY/LATER ideas and ideas with no selected formats", () => {
  const repurposeMapStep = stepByTaskTypeName("Repurpose Map");
  const repurposeMapInstance = markTaskInstanceDone(instanceForStep(repurposeMapStep), fixedNow);
  const ideas = confirmAtomicIdeaDrafts("rmap-1", [
    { id: "d1", text: "Blog only", coverageType: "OTHER", decision: "BLOG_ONLY", selectedFormats: ["REEL"] },
    { id: "d2", text: "Later", coverageType: "OTHER", decision: "LATER", selectedFormats: ["REEL"] },
    { id: "d3", text: "No formats", coverageType: "OTHER", decision: "CREATE_CONTENT", selectedFormats: [] },
  ], fixedNow);
  const plan = buildFormatPreviewPlan(repurposeMapInstance, "blog-1", ideas, taskTypesById);
  assert.equal(plan, null);
});

test("Confirm creates only the selected format candidates -- cancel/exclude creates nothing for that item", () => {
  const repurposeMapStep = stepByTaskTypeName("Repurpose Map");
  const repurposeMapInstance = markTaskInstanceDone(instanceForStep(repurposeMapStep), fixedNow);
  const ideas = confirmAtomicIdeaDrafts("rmap-1", [
    { id: "d1", text: "Idea", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL", "YOUTUBE"] },
  ], fixedNow);
  const plan = buildFormatPreviewPlan(repurposeMapInstance, "blog-1", ideas, taskTypesById);
  const reelCandidate = plan.candidates.find((c) => c.format === "REEL");
  const selections = [
    { key: reelCandidate.key, included: true, title: "", assignee: "", deadline: "", selections: [] },
    { key: plan.candidates.find((c) => c.format === "YOUTUBE").key, included: false, title: "", assignee: "", deadline: "", selections: [] },
  ];
  const outcome = confirmPreviewPlan(plan, selections, fixedNow);
  assert.equal(outcome.materials.length, 1);
  assert.equal(outcome.materials[0].format, "REEL");
});
