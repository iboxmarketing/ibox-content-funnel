import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-workflow-template-"));
// workflow-template.ts only imports *types* from ./task-type (`import type`),
// which TypeScript fully erases at transpile time -- no runtime require for
// it exists in the compiled output, so it does not need to be in this list.
for (const name of ["workflow-template"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  createWorkflowTemplate,
  reviseWorkflowTemplate,
  setWorkflowTemplateActive,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  effectiveAssigneeRule,
  effectiveRecommendedDay,
  effectiveReviewRequired,
  effectiveRequiredFields,
  validateWorkflowTemplate,
  isWorkflowTemplateValid,
} = require(join(dir, "workflow-template.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T00:00:0${tick++}.000Z`;

function baseStepInput(overrides = {}) {
  return {
    taskTypeId: "tt-blog",
    nameTemplate: "Blog",
    dependsOn: [],
    blocking: false,
    skippable: false,
    ...overrides,
  };
}

function freshTemplate() {
  return createWorkflowTemplate({ name: "Test workflow", description: "", moduleType: "BLOG" }, fixedNow);
}

// --- CRUD / version behavior ---

test("createWorkflowTemplate assigns a stable id, version 1, isActive true, and no steps", () => {
  const template = freshTemplate();
  assert.ok(template.id.startsWith("wf-test-workflow-"));
  assert.equal(template.version, 1);
  assert.equal(template.isActive, true);
  assert.deepEqual(template.steps, []);
});

test("reviseWorkflowTemplate increments version, keeps id, and updates the changed field", () => {
  const template = freshTemplate();
  const revised = reviseWorkflowTemplate(template, { description: "Now with a description" }, fixedNow);
  assert.equal(revised.id, template.id);
  assert.equal(revised.version, template.version + 1);
  assert.equal(revised.description, "Now with a description");
});

test("a second revision increments version again, from the already-revised value", () => {
  const template = freshTemplate();
  const r1 = reviseWorkflowTemplate(template, { description: "v2" }, fixedNow);
  const r2 = reviseWorkflowTemplate(r1, { description: "v3" }, fixedNow);
  assert.equal(r2.version, 3);
});

test("setWorkflowTemplateActive is a no-op when already at the target state", () => {
  const template = freshTemplate();
  const same = setWorkflowTemplateActive(template, true, fixedNow);
  assert.equal(same, template);
});

test("addStep appends with an incrementing order and a generated id", () => {
  let template = freshTemplate();
  template = addStep(template, baseStepInput({ nameTemplate: "Step A" }), fixedNow);
  template = addStep(template, baseStepInput({ nameTemplate: "Step B" }), fixedNow);
  assert.equal(template.steps.length, 2);
  assert.equal(template.steps[0].order, 0);
  assert.equal(template.steps[1].order, 1);
  assert.notEqual(template.steps[0].id, template.steps[1].id);
  assert.equal(template.steps[0].templateId, template.id);
});

test("removeStep removes the step and strips it from any other step's dependsOn", () => {
  let template = freshTemplate();
  template = addStep(template, baseStepInput({ nameTemplate: "A" }), fixedNow);
  const aId = template.steps[0].id;
  template = addStep(template, baseStepInput({ nameTemplate: "B", dependsOn: [aId] }), fixedNow);
  template = removeStep(template, aId, fixedNow);
  assert.equal(template.steps.length, 1);
  assert.deepEqual(template.steps[0].dependsOn, []);
});

test("updateStep patches only the named step and reorderSteps reindexes order", () => {
  let template = freshTemplate();
  template = addStep(template, baseStepInput({ nameTemplate: "A" }), fixedNow);
  template = addStep(template, baseStepInput({ nameTemplate: "B" }), fixedNow);
  const [a, b] = template.steps;
  template = updateStep(template, a.id, { blocking: true }, fixedNow);
  assert.equal(template.steps.find((s) => s.id === a.id).blocking, true);
  assert.equal(template.steps.find((s) => s.id === b.id).blocking, false);

  template = reorderSteps(template, [b.id, a.id], fixedNow);
  assert.deepEqual(template.steps.map((s) => s.id), [b.id, a.id]);
  assert.deepEqual(template.steps.map((s) => s.order), [0, 1]);
});

// --- Step override behavior ---

test("effectiveAssigneeRule falls back to the TaskType default when the step has no override", () => {
  const step = baseStepInput();
  const taskTypeDefault = { kind: "FIXED_ROLE", role: "SEO" };
  assert.deepEqual(effectiveAssigneeRule(taskTypeDefault, step), taskTypeDefault);
});

test("effectiveAssigneeRule uses the step's override when present", () => {
  const step = baseStepInput({ overrides: { assigneeRule: { kind: "MANUAL" } } });
  assert.deepEqual(effectiveAssigneeRule({ kind: "DEFAULT_CONTENT_OWNER" }, step), { kind: "MANUAL" });
});

test("effectiveRecommendedDay distinguishes an explicit null override from no override at all", () => {
  const noOverride = baseStepInput();
  assert.equal(effectiveRecommendedDay("MONDAY", noOverride), "MONDAY");
  const explicitNull = baseStepInput({ overrides: { recommendedDay: null } });
  assert.equal(effectiveRecommendedDay("MONDAY", explicitNull), null);
  const explicitOther = baseStepInput({ overrides: { recommendedDay: "TUESDAY" } });
  assert.equal(effectiveRecommendedDay("MONDAY", explicitOther), "TUESDAY");
});

test("effectiveReviewRequired falls back to the TaskType default when unset", () => {
  assert.equal(effectiveReviewRequired(true, baseStepInput()), true);
  assert.equal(effectiveReviewRequired(true, baseStepInput({ overrides: { reviewRequired: false } })), false);
});

test("effectiveRequiredFields appends the step's additional fields to the TaskType's own", () => {
  const taskTypeFields = [{ id: "title", label: "Title", type: "TEXT", required: true }];
  const step = baseStepInput({ overrides: { additionalRequiredFields: [{ id: "extra", label: "Extra", type: "TEXT", required: true }] } });
  const result = effectiveRequiredFields(taskTypeFields, step);
  assert.deepEqual(result.map((f) => f.id), ["title", "extra"]);
});

// --- Dependency validation ---

const TASK_TYPE_IDS = new Set(["tt-a", "tt-b", "tt-c"]);

function templateWithSteps(steps) {
  let template = freshTemplate();
  for (const step of steps) template = addStep(template, step, fixedNow);
  return template;
}

test("a valid, acyclic template with known Task Types produces zero errors", () => {
  const template = templateWithSteps([
    baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" }),
  ]);
  assert.deepEqual(validateWorkflowTemplate(template, TASK_TYPE_IDS), []);
  assert.equal(isWorkflowTemplateValid(template, TASK_TYPE_IDS), true);
});

test("MISSING_NAME on the template itself", () => {
  const template = reviseWorkflowTemplate(freshTemplate(), { name: "" }, fixedNow);
  assert.ok(validateWorkflowTemplate(template, TASK_TYPE_IDS).some((e) => e.code === "MISSING_NAME"));
});

test("MISSING_TASK_TYPE: a step referencing an unknown Task Type id is rejected", () => {
  const template = templateWithSteps([baseStepInput({ taskTypeId: "tt-does-not-exist", nameTemplate: "A" })]);
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.ok(errors.some((e) => e.code === "MISSING_TASK_TYPE"));
});

test("DUPLICATE_STEP_ID: two steps sharing an id after a manual id collision are rejected", () => {
  let template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" })]);
  const duplicate = { ...template.steps[0], nameTemplate: "A again" };
  template = { ...template, steps: [...template.steps, duplicate] };
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.ok(errors.some((e) => e.code === "DUPLICATE_STEP_ID" && e.stepId === duplicate.id));
});

test("SELF_DEPENDENCY: a step listing its own id in dependsOn is rejected", () => {
  let template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" })]);
  const selfId = template.steps[0].id;
  template = updateStep(template, selfId, { dependsOn: [selfId] }, fixedNow);
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.ok(errors.some((e) => e.code === "SELF_DEPENDENCY" && e.stepId === selfId));
});

test("UNKNOWN_DEPENDENCY: a step depending on a step id that doesn't exist is rejected", () => {
  const template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A", dependsOn: ["step-does-not-exist"] })]);
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.ok(errors.some((e) => e.code === "UNKNOWN_DEPENDENCY"));
});

test("DEPENDENCY_CYCLE: a two-step A->B->A cycle is detected for both steps", () => {
  let template = templateWithSteps([
    baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" }),
    baseStepInput({ taskTypeId: "tt-b", nameTemplate: "B" }),
  ]);
  const [a, b] = template.steps;
  template = updateStep(template, a.id, { dependsOn: [b.id] }, fixedNow);
  template = updateStep(template, b.id, { dependsOn: [a.id] }, fixedNow);
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS).filter((e) => e.code === "DEPENDENCY_CYCLE");
  assert.deepEqual(new Set(errors.map((e) => e.stepId)), new Set([a.id, b.id]));
});

test("DEPENDENCY_CYCLE: a longer A->B->C->A cycle is fully detected", () => {
  let template = templateWithSteps([
    baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" }),
    baseStepInput({ taskTypeId: "tt-b", nameTemplate: "B" }),
    baseStepInput({ taskTypeId: "tt-c", nameTemplate: "C" }),
  ]);
  const [a, b, c] = template.steps;
  template = updateStep(template, a.id, { dependsOn: [b.id] }, fixedNow);
  template = updateStep(template, b.id, { dependsOn: [c.id] }, fixedNow);
  template = updateStep(template, c.id, { dependsOn: [a.id] }, fixedNow);
  const cycleStepIds = new Set(validateWorkflowTemplate(template, TASK_TYPE_IDS).filter((e) => e.code === "DEPENDENCY_CYCLE").map((e) => e.stepId));
  assert.deepEqual(cycleStepIds, new Set([a.id, b.id, c.id]));
});

test("a non-cyclic diamond dependency (A<-B, A<-C, B+C<-D) produces no cycle error", () => {
  let template = templateWithSteps([
    baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A" }),
    baseStepInput({ taskTypeId: "tt-b", nameTemplate: "B" }),
    baseStepInput({ taskTypeId: "tt-c", nameTemplate: "C" }),
    baseStepInput({ taskTypeId: "tt-a", nameTemplate: "D" }),
  ]);
  const [a, b, c, d] = template.steps;
  template = updateStep(template, b.id, { dependsOn: [a.id] }, fixedNow);
  template = updateStep(template, c.id, { dependsOn: [a.id] }, fixedNow);
  template = updateStep(template, d.id, { dependsOn: [b.id, c.id] }, fixedNow);
  assert.deepEqual(validateWorkflowTemplate(template, TASK_TYPE_IDS).filter((e) => e.code === "DEPENDENCY_CYCLE"), []);
});

test("INVALID_BLOCKING_CONFIG: a step marked blocking with no dependents is flagged", () => {
  const template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A", blocking: true })]);
  const errors = validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.ok(errors.some((e) => e.code === "INVALID_BLOCKING_CONFIG"));
});

test("a blocking step with a real dependent is not flagged", () => {
  let template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A", blocking: true })]);
  const aId = template.steps[0].id;
  template = addStep(template, baseStepInput({ taskTypeId: "tt-b", nameTemplate: "B", dependsOn: [aId] }), fixedNow);
  assert.deepEqual(validateWorkflowTemplate(template, TASK_TYPE_IDS).filter((e) => e.code === "INVALID_BLOCKING_CONFIG"), []);
});

test("a non-blocking step with no dependents is never flagged", () => {
  const template = templateWithSteps([baseStepInput({ taskTypeId: "tt-a", nameTemplate: "A", blocking: false })]);
  assert.deepEqual(validateWorkflowTemplate(template, TASK_TYPE_IDS).filter((e) => e.code === "INVALID_BLOCKING_CONFIG"), []);
});

test("validateWorkflowTemplate never mutates its input template", () => {
  const template = templateWithSteps([baseStepInput({ taskTypeId: "tt-does-not-exist", nameTemplate: "A", dependsOn: ["x"] })]);
  const snapshot = JSON.stringify(template);
  validateWorkflowTemplate(template, TASK_TYPE_IDS);
  assert.equal(JSON.stringify(template), snapshot);
});
