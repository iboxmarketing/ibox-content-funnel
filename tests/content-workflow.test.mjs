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
const { initialContentEntityState, contentEntityReducer } = require(join(dir, "content-entity-store.js"));
const { buildPreviewPlan, confirmPreviewPlan, entityTypeLabelUz } = require(join(dir, "content-workflow.js"));
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

test("Repurpose Map remains gated by Head Review even after Sprint 3's rewrite", () => {
  const blogStep = stepByTaskTypeName("Blog");
  const headReviewStep = stepByTaskTypeName("Head Review");
  const blog = markTaskInstanceDone(instanceForStep(blogStep), fixedNow);
  const headReview = markTaskInstanceDone(instanceForStep(headReviewStep, { sourceTaskId: blog.id }), fixedNow);
  const entityState = initialContentEntityState();

  const fromBlog = buildPreviewPlan({ template, allInstances: [blog], settledSourceInstance: blog, sourceTaskType: findTaskTypeFixtureByName("Blog"), taskTypesById, contentEntities: entityState });
  assert.ok(!fromBlog.candidates.some((c) => c.taskType?.name === "Repurpose Map"));

  const fromHeadReview = buildPreviewPlan({ template, allInstances: [blog, headReview], settledSourceInstance: headReview, sourceTaskType: findTaskTypeFixtureByName("Head Review"), taskTypesById, contentEntities: entityState });
  assert.equal(fromHeadReview.mode, "STEP_FANOUT");
  assert.deepEqual(fromHeadReview.candidates.map((c) => c.taskType.name), ["Repurpose Map"]);
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
