import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-workflow-fixtures-"));
for (const name of ["task-type", "task-type-fixtures", "workflow-template", "workflow-template-fixtures"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES, findTaskTypeFixtureByName } = require(join(dir, "task-type-fixtures.js"));
const { validateTaskType } = require(join(dir, "task-type.js"));
const { validateWorkflowTemplate } = require(join(dir, "workflow-template.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE, WORKFLOW_TEMPLATE_FIXTURES } = require(join(dir, "workflow-template-fixtures.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const EXPECTED_TASK_TYPE_NAMES = [
  "Problem Split", "Knowledge Discovery", "Research", "Blog", "Head Review", "SEO", "Angle",
  "Performance Consultation", "Destination Decision", "Repurpose Map", "Reel Script", "Carousel",
  "Text Post", "Planning", "Shoot", "Edit", "Cover", "Caption", "Distribution Plan",
  "Publish / Schedule", "Publish Check", "Learning",
];

test("all 22 approved Task Type fixtures exist, by name, exactly once each", () => {
  assert.equal(TASK_TYPE_FIXTURES.length, 22);
  const names = TASK_TYPE_FIXTURES.map((t) => t.name);
  assert.deepEqual(names.slice().sort(), EXPECTED_TASK_TYPE_NAMES.slice().sort());
  assert.equal(new Set(names).size, names.length, "no duplicate names");
});

test("every Task Type fixture is independently valid and active", () => {
  for (const taskType of TASK_TYPE_FIXTURES) {
    assert.deepEqual(validateTaskType(taskType), [], `fixture "${taskType.name}" should be valid`);
    assert.equal(taskType.isActive, true);
  }
});

test("every Task Type fixture has a unique id", () => {
  const ids = TASK_TYPE_FIXTURES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("role exceptions from the approved methodology are reflected: SEO/Shoot/Edit/Performance Consultation use a FIXED_ROLE", () => {
  const seo = findTaskTypeFixtureByName("SEO");
  const shoot = findTaskTypeFixtureByName("Shoot");
  const edit = findTaskTypeFixtureByName("Edit");
  const performance = findTaskTypeFixtureByName("Performance Consultation");
  assert.deepEqual(seo.defaultAssigneeRule, { kind: "FIXED_ROLE", role: "SEO" });
  assert.deepEqual(shoot.defaultAssigneeRule, { kind: "FIXED_ROLE", role: "Operator / Montajer" });
  assert.deepEqual(edit.defaultAssigneeRule, { kind: "FIXED_ROLE", role: "Operator / Montajer" });
  assert.deepEqual(performance.defaultAssigneeRule, { kind: "FIXED_ROLE", role: "Digital marketer" });
});

test("Blog requires Head review per the approved methodology", () => {
  assert.equal(findTaskTypeFixtureByName("Blog").reviewRequired, true);
});

// --- Qoldiq noto'g'ri workflow fixture ---

test("the Qoldiq noto'g'ri workflow fixture is valid against the Task Type fixture library", () => {
  const taskTypeIds = new Set(TASK_TYPE_FIXTURES.map((t) => t.id));
  assert.deepEqual(validateWorkflowTemplate(QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE, taskTypeIds), []);
});

test("the fixture has exactly the demonstrated chain: Problem Split -> Knowledge Discovery -> Research -> Blog", () => {
  const byName = (name) => QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith(name));
  const problemSplit = byName("Problem Split");
  const knowledgeDiscovery = byName("Knowledge Discovery");
  const research = byName("Research");
  const blog = byName("Blog");
  assert.deepEqual(problemSplit.dependsOn, []);
  assert.deepEqual(knowledgeDiscovery.dependsOn, [problemSplit.id]);
  assert.deepEqual(research.dependsOn, [knowledgeDiscovery.id]);
  assert.deepEqual(blog.dependsOn, [research.id]);
  for (const step of [problemSplit, knowledgeDiscovery, research, blog]) assert.equal(step.blocking, true);
});

test("Blog branches to Head Review, SEO, Angle, and Performance Consultation, each depending only on Blog", () => {
  const blog = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith("Blog"));
  for (const name of ["Head Review", "SEO", "Angle", "Performance Consultation"]) {
    const step = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith(name));
    assert.deepEqual(step.dependsOn, [blog.id], name);
  }
});

test("Head Review is blocking; SEO, Angle, and Performance Consultation are non-blocking", () => {
  const blocking = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith("Head Review"));
  assert.equal(blocking.blocking, true);
  for (const name of ["SEO", "Angle", "Performance Consultation"]) {
    const step = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith(name));
    assert.equal(step.blocking, false, name);
  }
});

test("Repurpose Map is modeled as depending on Head Review (not merely Blog) -- configuration only, not runtime-generated", () => {
  const headReview = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith("Head Review"));
  const repurpose = QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps.find((s) => s.nameTemplate.endsWith("Repurpose Map"));
  assert.deepEqual(repurpose.dependsOn, [headReview.id]);
});

test("every step in the fixture references a real, active Task Type fixture", () => {
  const ids = new Set(TASK_TYPE_FIXTURES.map((t) => t.id));
  for (const step of QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE.steps) assert.ok(ids.has(step.taskTypeId), step.nameTemplate);
});

test("WORKFLOW_TEMPLATE_FIXTURES exposes the one seeded workflow", () => {
  assert.equal(WORKFLOW_TEMPLATE_FIXTURES.length, 1);
  assert.equal(WORKFLOW_TEMPLATE_FIXTURES[0], QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE);
});
