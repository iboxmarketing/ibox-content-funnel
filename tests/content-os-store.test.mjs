import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-content-os-store-"));
for (const name of ["task-type", "task-type-fixtures", "workflow-template", "workflow-template-fixtures", "content-os-store"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  initialContentOsState,
  contentOsReducer,
  activeTaskTypes,
  taskTypeById,
  workflowTemplateById,
} = require(join(dir, "content-os-store.js"));
const { createTaskType, duplicateTaskType } = require(join(dir, "task-type.js"));
const { createWorkflowTemplate } = require(join(dir, "workflow-template.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T01:00:${String(tick++).padStart(2, "0")}.000Z`;

function baseTaskTypeDraft(overrides = {}) {
  return {
    name: "Qualitative Check",
    description: "",
    requiredFields: [],
    optionalFields: [],
    defaultPrompt: null,
    promptVersion: null,
    defaultAssigneeRule: { kind: "DEFAULT_CONTENT_OWNER" },
    recommendedDay: null,
    reviewRequired: false,
    allowedLinkLabels: [],
    completionRequirements: [],
    ...overrides,
  };
}

test("initialContentOsState seeds from the Sprint 1 fixtures", () => {
  const state = initialContentOsState();
  assert.equal(state.taskTypes.length, 22);
  assert.equal(state.workflowTemplates.length, 1);
});

test("ADD_TASK_TYPE adds an already-built task type, visible immediately in state", () => {
  const state = initialContentOsState();
  const taskType = createTaskType(baseTaskTypeDraft(), fixedNow);
  const next = contentOsReducer(state, { type: "ADD_TASK_TYPE", taskType }, fixedNow);
  assert.equal(next.taskTypes.length, 23);
  assert.ok(next.taskTypes.some((t) => t.name === "Qualitative Check"));
  assert.notEqual(next, state, "reducer must not mutate in place");
});

test("REVISE_TASK_TYPE bumps version and is visible by id -- this is the Sprint 1 risk fix: a Task Type edit is immediately visible wherever the shared state is read (e.g. the Workflow Builder)", () => {
  const state = initialContentOsState();
  const blog = state.taskTypes.find((t) => t.name === "Blog");
  const next = contentOsReducer(state, { type: "REVISE_TASK_TYPE", id: blog.id, changes: { description: "Updated description" } }, fixedNow);
  const revised = taskTypeById(next, blog.id);
  assert.equal(revised.version, blog.version + 1);
  assert.equal(revised.description, "Updated description");
  // The workflow step referencing this Task Type by id automatically sees
  // the new version/description -- it was never a copy.
  const template = next.workflowTemplates[0];
  const blogStep = template.steps.find((s) => s.taskTypeId === blog.id);
  assert.ok(blogStep);
  assert.equal(taskTypeById(next, blogStep.taskTypeId).description, "Updated description");
});

test("REVISE_TASK_TYPE against an unknown id is a no-op (returns the same state)", () => {
  const state = initialContentOsState();
  const next = contentOsReducer(state, { type: "REVISE_TASK_TYPE", id: "does-not-exist", changes: { description: "x" } }, fixedNow);
  assert.equal(next, state);
});

test("duplicating a task type (building via lib/task-type.ts, then ADD_TASK_TYPE) adds a copy with version reset to 1", () => {
  const state = initialContentOsState();
  const blog = state.taskTypes.find((t) => t.name === "Blog");
  const copy = duplicateTaskType(blog, fixedNow);
  const next = contentOsReducer(state, { type: "ADD_TASK_TYPE", taskType: copy }, fixedNow);
  assert.equal(next.taskTypes.length, 23);
  assert.equal(taskTypeById(next, copy.id).version, 1);
});

test("SET_TASK_TYPE_ACTIVE toggles isActive", () => {
  const state = initialContentOsState();
  const blog = state.taskTypes.find((t) => t.name === "Blog");
  const next = contentOsReducer(state, { type: "SET_TASK_TYPE_ACTIVE", id: blog.id, isActive: false }, fixedNow);
  assert.equal(taskTypeById(next, blog.id).isActive, false);
  assert.equal(activeTaskTypes(next).length, 21);
});

test("ADD_WORKFLOW_TEMPLATE / ADD_WORKFLOW_STEP / UPDATE_WORKFLOW_STEP / REMOVE_WORKFLOW_STEP all operate on shared state", () => {
  const state = initialContentOsState();
  const taskTypeId = state.taskTypes[0].id;
  const created = createWorkflowTemplate({ name: "New flow", description: "", moduleType: "OTHER" }, fixedNow);
  let next = contentOsReducer(state, { type: "ADD_WORKFLOW_TEMPLATE", template: created }, fixedNow);
  next = contentOsReducer(next, { type: "ADD_WORKFLOW_STEP", templateId: created.id, input: { taskTypeId, nameTemplate: "Step 1", dependsOn: [], blocking: false, skippable: false } }, fixedNow);
  let template = workflowTemplateById(next, created.id);
  assert.equal(template.steps.length, 1);
  const stepId = template.steps[0].id;

  next = contentOsReducer(next, { type: "UPDATE_WORKFLOW_STEP", templateId: created.id, stepId, changes: { nameTemplate: "Renamed" } }, fixedNow);
  template = workflowTemplateById(next, created.id);
  assert.equal(template.steps[0].nameTemplate, "Renamed");

  next = contentOsReducer(next, { type: "REMOVE_WORKFLOW_STEP", templateId: created.id, stepId }, fixedNow);
  template = workflowTemplateById(next, created.id);
  assert.equal(template.steps.length, 0);
});

test("REORDER_WORKFLOW_STEPS reorders without dropping steps", () => {
  const state = initialContentOsState();
  const template = state.workflowTemplates[0];
  const ids = template.steps.map((s) => s.id);
  const reordered = [ids[1], ids[0], ...ids.slice(2)];
  const next = contentOsReducer(state, { type: "REORDER_WORKFLOW_STEPS", templateId: template.id, orderedStepIds: reordered }, fixedNow);
  const result = workflowTemplateById(next, template.id);
  assert.equal(result.steps.length, template.steps.length);
  assert.equal(result.steps[0].id, ids[1]);
  assert.equal(result.steps[1].id, ids[0]);
});

test("an action targeting an unknown templateId is a no-op", () => {
  const state = initialContentOsState();
  const next = contentOsReducer(state, { type: "ADD_WORKFLOW_STEP", templateId: "nope", input: { taskTypeId: "x", nameTemplate: "x", dependsOn: [], blocking: false, skippable: false } }, fixedNow);
  assert.equal(next, state);
});
