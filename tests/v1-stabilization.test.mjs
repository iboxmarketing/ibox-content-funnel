/**
 * Sprint 7 stabilization regressions: core-runtime genericity, the runtime
 * handler boundary, Problem Split / Knowledge Discovery de-duplication,
 * Copy Prompt fixtures, and the UI fixes found in the manual browser pilot.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const LIBS = [
  "content-entity", "task-type", "task-type-fixtures", "workflow-template", "workflow-template-fixtures",
  "task-instance", "content-entity-fixtures", "content-entity-store", "workflow-runtime", "content-workflow",
  "material-production", "distribution", "task-runtime-handlers", "task-completion",
];
const dir = mkdtempSync(join(tmpdir(), "ibox-v1-stabilization-"));
for (const name of LIBS) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: template } = require(join(dir, "workflow-template-fixtures.js"));
const { createTaskInstance, markTaskInstanceDone } = require(join(dir, "task-instance.js"));
const { ref } = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer } = require(join(dir, "content-entity-store.js"));
const { buildPreviewPlan, confirmPreviewPlan, outcomeToEntityActions, normalizeEntityName } = require(join(dir, "content-workflow.js"));
const handlers = require(join(dir, "task-runtime-handlers.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-12T03:00:${String(tick++).padStart(2, "0")}.000Z`;
const taskTypesById = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const typeByName = (name) => TASK_TYPE_FIXTURES.find((t) => t.name === name);
const stepFor = (name) => template.steps.find((s) => taskTypesById.get(s.taskTypeId).name === name);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// --- Qoldiq is fixture data, never application behavior ---

const CORE_RUNTIME_LIBS = readdirSync(new URL("../lib/", import.meta.url))
  .filter((f) => /^(task-|content-entity|content-workflow|workflow-|material-production|distribution)/.test(f) && f.endsWith(".ts") && !f.includes("fixtures"));
const CORE_RUNTIME_COMPONENTS = [
  "task-detail.tsx", "workflow-run-view.tsx", "generated-task-preview.tsx", "task-runtime-ui-blocks.tsx",
  "material-production-view.tsx", "content-tree-view.tsx", "task-type-library.tsx", "workflow-template-builder.tsx",
];

test("no Qoldiq / inventory-specific logic or hardcoded content ids in the core runtime", () => {
  assert.ok(CORE_RUNTIME_LIBS.length >= 10, CORE_RUNTIME_LIBS.join(","));
  for (const file of [...CORE_RUNTIME_LIBS.map((f) => `lib/${f}`), ...CORE_RUNTIME_COMPONENTS.map((f) => `components/${f}`)]) {
    // The store seeds its initial state from the named fixture -- that
    // import is the one allowed reference.
    const source = read(file).replace(/QOLDIQ_[A-Z_]*FIXTURE/g, "");
    assert.doesNotMatch(source, /qoldiq|ombor|hisobda|inventar/i, file);
    assert.doesNotMatch(source, /["'`](dom|pcat|part|node|blog|mat|dest|angle|ti)-[a-z0-9-]*\d{5,}/, `${file} hardcodes an entity/task id`);
  }
});

test("Start workflow asks for the Problem Category through the handler registry, not a view-level name check", () => {
  assert.equal(handlers.resolveRuntimeHandler("Problem Split").startsOn, "PROBLEM_CATEGORY");
  const view = read("components/workflow-run-view.tsx");
  assert.doesNotMatch(view, /problemCategories\[0\]\s*\?\s*ref/, "no silent 'first seeded category' wiring");
  assert.match(view, /startsOn === "PROBLEM_CATEGORY"/);
});

// --- Runtime handler boundary ---

test("generic task UI never names ANY Task Type (fixtures or registry)", () => {
  const names = new Set([...TASK_TYPE_FIXTURES.map((t) => t.name), ...Object.keys(handlers.TASK_RUNTIME_HANDLERS)]);
  for (const file of ["task-detail.tsx", "workflow-run-view.tsx", "generated-task-preview.tsx", "task-runtime-ui-blocks.tsx"]) {
    const source = read(`components/${file}`);
    for (const name of names) assert.ok(!source.includes(`"${name}"`), `${file} mentions "${name}"`);
    assert.doesNotMatch(source, /taskType\.name\s*===/, `${file} branches on a Task Type name`);
  }
});

test("handler-owned internal fields are hidden from the generic form and from context transfer", () => {
  const dd = handlers.resolveRuntimeHandler("Destination Decision");
  assert.deepEqual([...dd.hiddenFieldIds].sort(), ["chosen-destination-id", "create-new", "destination-type"]);
  assert.match(read("components/generated-task-preview.tsx"), /hiddenFieldIds/);
});

// --- Problem Split / Knowledge Discovery: select existing, never duplicate ---

test("normalizeEntityName ignores case, spacing and Uzbek apostrophe variants", () => {
  assert.equal(normalizeEntityName("Hisobda kam → Omborda ko‘p"), normalizeEntityName("hisobda  kam → omborda ko'p"));
  assert.equal(normalizeEntityName("Oʻzbek"), normalizeEntityName("O’zbek"));
});

function problemSplitPlan(components, state = initialContentEntityState(), allInstances = []) {
  const category = state.problemCategories[0];
  const step = stepFor("Problem Split");
  const source = markTaskInstanceDone(createTaskInstance({
    taskTypeId: step.taskTypeId, workflowTemplateId: template.id, workflowStepId: step.id, title: step.nameTemplate, assignee: null, deadline: "2026-10-20",
    fieldValues: { components }, customFields: [], links: [], sourceTaskId: null, contentRef: ref("PROBLEM_CATEGORY", category.id),
  }, fixedNow), fixedNow);
  return { plan: buildPreviewPlan({ template, allInstances: [source, ...allInstances], settledSourceInstance: source, sourceTaskType: typeByName("Problem Split"), taskTypesById, contentEntities: state }), state, category };
}
const uiDefaults = (plan) => plan.candidates.map((c) => ({ key: c.key, included: c.defaultIncluded !== false, title: "", assignee: "", deadline: "", selections: [] }));

test("Problem Split: a line naming an existing part SELECTS it -- no duplicate ProblemPart", () => {
  const { plan, state, category } = problemSplitPlan("Hisobda kam → Omborda ko‘p\nYangi qism");
  const existing = state.problemParts.find((p) => p.problemCategoryId === category.id && normalizeEntityName(p.name) === normalizeEntityName("Hisobda kam → Omborda ko'p"));
  assert.ok(existing, "fixture has the part");
  const [first, second] = plan.candidates;
  assert.equal(first.existingEntityId, existing.id);
  assert.equal(second.existingEntityId, null);
  const outcome = confirmPreviewPlan(plan, uiDefaults(plan), fixedNow);
  assert.deepEqual(outcome.problemParts.map((p) => p.name), ["Yangi qism"]);
  assert.deepEqual(outcome.taskDrafts.map((d) => d.contentRef.entityId), [existing.id, outcome.problemParts[0].id]);
  const next = outcomeToEntityActions(outcome).reduce((acc, a) => contentEntityReducer(acc, a, fixedNow), state);
  assert.equal(next.problemParts.filter((p) => normalizeEntityName(p.name) === normalizeEntityName(existing.name)).length, 1);
});

test("Problem Split: unmentioned existing parts are offered opt-in; parts that already have a Knowledge Discovery task are not", () => {
  const { plan, state, category } = problemSplitPlan("Yangi qism");
  const offered = plan.candidates.filter((c) => c.defaultIncluded === false);
  assert.equal(offered.length, state.problemParts.filter((p) => p.problemCategoryId === category.id).length);
  assert.equal(confirmPreviewPlan(plan, uiDefaults(plan), fixedNow).taskDrafts.length, 1, "opt-in rows create nothing unless ticked");

  const kd = typeByName("Knowledge Discovery");
  const taken = offered[0].existingEntityId;
  const busy = createTaskInstance({ taskTypeId: kd.id, workflowTemplateId: template.id, workflowStepId: stepFor("Knowledge Discovery").id, title: "KD", assignee: null, deadline: null, fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: ref("PROBLEM_PART", taken) }, fixedNow);
  const again = problemSplitPlan("Yangi qism", state, [busy]).plan;
  assert.ok(!again.candidates.some((c) => c.existingEntityId === taken));
});

test("Knowledge Discovery: an existing node is reused in the shared Research task, not duplicated", () => {
  const state = initialContentEntityState();
  const node = state.knowledgeNodes[0];
  const step = stepFor("Knowledge Discovery");
  const source = markTaskInstanceDone(createTaskInstance({
    taskTypeId: step.taskTypeId, workflowTemplateId: template.id, workflowStepId: step.id, title: step.nameTemplate, assignee: null, deadline: "2026-10-20",
    fieldValues: { "knowledge-nodes": `${node.name.toUpperCase()}\nYangi node` }, customFields: [], links: [], sourceTaskId: null, contentRef: ref("PROBLEM_PART", node.problemPartId),
  }, fixedNow), fixedNow);
  const plan = buildPreviewPlan({ template, allInstances: [source], settledSourceInstance: source, sourceTaskType: typeByName("Knowledge Discovery"), taskTypesById, contentEntities: state });
  const outcome = confirmPreviewPlan(plan, uiDefaults(plan), fixedNow);
  assert.deepEqual(outcome.knowledgeNodes.map((n) => n.name), ["Yangi node"]);
  assert.deepEqual(outcome.taskDrafts[0].relatedEntityRefs.map((r) => r.entityId), [node.id, outcome.knowledgeNodes[0].id]);
});

// --- Copy Prompt fixtures ---

test("each audited Task Type has exactly one prompt, INPUT last and blank, no OS context", () => {
  for (const name of ["Problem Split", "Knowledge Discovery", "Research", "Blog", "Angle", "Repurpose Map", "Reel Script"]) {
    const prompt = typeByName(name).defaultPrompt;
    assert.ok(prompt, `${name} has a prompt`);
    assert.equal(prompt.match(/INPUT:/g).length, 1, name);
    assert.ok(prompt.endsWith("INPUT:\n"), `${name}: INPUT is last and blank`);
    assert.doesNotMatch(prompt, /\{\{|\$\{|Qoldiq|ti-|node-/, `${name}: no injected OS context`);
    assert.equal(typeByName(name).promptVersion, "v1");
  }
  // Copy Prompt copies the Task Type's prompt verbatim -- nothing appended.
  assert.match(read("components/task-detail.tsx"), /writeText\(taskType\.defaultPrompt\)/);
});

// --- Pilot UI fixes ---

test("pilot fixes: task list shows what each task works on; Publish context can set the Destination status; banner present", () => {
  assert.match(read("components/workflow-run-view.tsx"), /workingOnLabel\(contentEntityStore\.state, instance\)/);
  const blocks = read("components/task-runtime-ui-blocks.tsx");
  assert.match(blocks, /aria-label="Destination holati"/);
  assert.match(blocks, /ctaDestinationIdForPublish\(material\)/);
  assert.match(read("components/local-prototype-banner.tsx"), /Local prototype — refresh resets runtime data/);
  assert.equal((read("components/knowledge-os.tsx").match(/<LocalPrototypeBanner \/>/g) ?? []).length, 5);
});

test("pilot fix: Task Type Library rows are not <button>s (rows contain buttons; nested buttons are invalid)", () => {
  const source = read("components/task-type-library.tsx");
  assert.match(source, /<div key=\{taskType\.id\} role="button"/);
});
