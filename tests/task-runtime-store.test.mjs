import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-runtime-store-"));
for (const name of ["task-link", "task-instance", "task-runtime-store"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  initialTaskRuntimeState,
  taskRuntimeReducer,
  instanceById,
  instancesForTemplate,
} = require(join(dir, "task-runtime-store.js"));
const { createTaskInstance } = require(join(dir, "task-instance.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T05:00:${String(tick++).padStart(2, "0")}.000Z`;

function draft(overrides = {}) {
  return {
    taskTypeId: "tt-blog",
    workflowTemplateId: "wf-1",
    workflowStepId: "step-blog",
    title: "Blog",
    assignee: null,
    deadline: null,
    fieldValues: {},
    customFields: [],
    links: [],
    sourceTaskId: null,
    ...overrides,
  };
}

function addInstances(state, drafts) {
  const instances = drafts.map((d) => createTaskInstance(d, fixedNow));
  return taskRuntimeReducer(state, { type: "ADD_INSTANCES", instances }, fixedNow);
}

test("initialTaskRuntimeState starts empty -- nothing is pre-created", () => {
  const state = initialTaskRuntimeState();
  assert.deepEqual(state.instances, []);
  assert.deepEqual(state.suggestions, []);
});

test("ADD_INSTANCES is the only action that adds instances -- this models Confirm; Cancel simply never dispatches it", () => {
  const state = initialTaskRuntimeState();
  const next = addInstances(state, [draft(), draft({ workflowStepId: "step-seo", title: "SEO" })]);
  assert.equal(next.instances.length, 2);
  assert.notEqual(next, state);
});

test("confirm creates only the already-built instances actually passed in, never anything else (models 'only selected/immediate tasks')", () => {
  const state = initialTaskRuntimeState();
  const next = addInstances(state, [draft({ workflowStepId: "step-seo", title: "SEO" })]);
  assert.equal(next.instances.length, 1);
  assert.equal(next.instances[0].title, "SEO");
});

test("SET_STATUS / SET_FIELD_VALUE / COMPLETE / SKIP target one instance by id", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft()]);
  const id = state.instances[0].id;

  state = taskRuntimeReducer(state, { type: "SET_STATUS", instanceId: id, status: "IN_PROGRESS" }, fixedNow);
  assert.equal(instanceById(state, id).status, "IN_PROGRESS");

  state = taskRuntimeReducer(state, { type: "SET_FIELD_VALUE", instanceId: id, fieldId: "blog-title", value: "Hello" }, fixedNow);
  assert.equal(instanceById(state, id).fieldValues["blog-title"], "Hello");

  state = taskRuntimeReducer(state, { type: "COMPLETE", instanceId: id }, fixedNow);
  assert.equal(instanceById(state, id).status, "DONE");
  assert.equal(instanceById(state, id).outcome, "COMPLETED");
});

test("SKIP requires and records a skipReason, represented as CANCELLED+SKIPPED", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft()]);
  const id = state.instances[0].id;
  state = taskRuntimeReducer(state, { type: "SKIP", instanceId: id, reason: "Not applicable" }, fixedNow);
  const instance = instanceById(state, id);
  assert.equal(instance.status, "CANCELLED");
  assert.equal(instance.outcome, "SKIPPED");
  assert.equal(instance.skipReason, "Not applicable");
});

test("ADD_CUSTOM_FIELD / REMOVE_CUSTOM_FIELD are instance-scoped and never touch any TaskType", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft()]);
  const id = state.instances[0].id;
  state = taskRuntimeReducer(state, { type: "ADD_CUSTOM_FIELD", instanceId: id, field: { id: "custom-1", label: "Extra", type: "TEXT", required: false } }, fixedNow);
  assert.equal(instanceById(state, id).customFields.length, 1);
  state = taskRuntimeReducer(state, { type: "REMOVE_CUSTOM_FIELD", instanceId: id, fieldId: "custom-1" }, fixedNow);
  assert.equal(instanceById(state, id).customFields.length, 0);
});

test("ADD_LINK / UPDATE_LINK / REMOVE_LINK manage multiple named links", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft()]);
  const id = state.instances[0].id;
  state = taskRuntimeReducer(state, { type: "ADD_LINK", instanceId: id, draft: { label: "Script", url: "https://example.com/script" } }, fixedNow);
  state = taskRuntimeReducer(state, { type: "ADD_LINK", instanceId: id, draft: { label: "Raw", url: "https://example.com/raw" } }, fixedNow);
  assert.equal(instanceById(state, id).links.length, 2);
  const linkId = instanceById(state, id).links[0].id;
  state = taskRuntimeReducer(state, { type: "UPDATE_LINK", instanceId: id, linkId, changes: { url: "https://example.com/script-v2" } }, fixedNow);
  assert.equal(instanceById(state, id).links.find((l) => l.id === linkId).url, "https://example.com/script-v2");
  state = taskRuntimeReducer(state, { type: "REMOVE_LINK", instanceId: id, linkId }, fixedNow);
  assert.equal(instanceById(state, id).links.length, 1);
});

test("EDIT_TRANSFERRED_FIELD_VALUE without alsoUpdateSourceTaskId only changes the target instance", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft({ workflowStepId: "step-blog" }), draft({ workflowStepId: "step-seo", title: "SEO" })]);
  const [sourceId, targetId] = state.instances.map((i) => i.id);
  state = taskRuntimeReducer(state, { type: "SET_FIELD_VALUE", instanceId: sourceId, fieldId: "blog-link", value: "https://example.com/original" }, fixedNow);
  state = taskRuntimeReducer(state, { type: "EDIT_TRANSFERRED_FIELD_VALUE", instanceId: targetId, fieldId: "seo-notes", value: "https://example.com/edited" }, fixedNow);
  assert.equal(instanceById(state, targetId).fieldValues["seo-notes"], "https://example.com/edited");
  assert.equal(instanceById(state, sourceId).fieldValues["blog-link"], "https://example.com/original", "source must be unaffected by default -- 'Only this task'");
});

test("EDIT_TRANSFERRED_FIELD_VALUE with alsoUpdateSourceTaskId writes the source back too -- 'Update source task too'", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft({ workflowStepId: "step-blog" }), draft({ workflowStepId: "step-seo", title: "SEO" })]);
  const [sourceId, targetId] = state.instances.map((i) => i.id);
  state = taskRuntimeReducer(state, { type: "SET_FIELD_VALUE", instanceId: sourceId, fieldId: "blog-link", value: "https://example.com/original" }, fixedNow);
  state = taskRuntimeReducer(
    state,
    { type: "EDIT_TRANSFERRED_FIELD_VALUE", instanceId: targetId, fieldId: "seo-notes", value: "https://example.com/edited", alsoUpdateSourceTaskId: sourceId, sourceFieldId: "blog-link" },
    fixedNow,
  );
  assert.equal(instanceById(state, targetId).fieldValues["seo-notes"], "https://example.com/edited");
  assert.equal(instanceById(state, sourceId).fieldValues["blog-link"], "https://example.com/edited");
});

test("ADD_SUGGESTION records a local suggestion without creating or mutating any instance", () => {
  const state = taskRuntimeReducer(initialTaskRuntimeState(), { type: "ADD_SUGGESTION", taskInstanceId: "ti-1", taskTypeId: "tt-blog", field: { id: "custom-1", label: "Extra", type: "TEXT", required: false }, note: "Useful everywhere" }, fixedNow);
  assert.equal(state.suggestions.length, 1);
  assert.equal(state.instances.length, 0);
});

test("instancesForTemplate filters by workflowTemplateId", () => {
  const state = addInstances(initialTaskRuntimeState(), [draft({ workflowTemplateId: "wf-1" }), draft({ workflowTemplateId: "wf-2" })]);
  assert.equal(instancesForTemplate(state, "wf-1").length, 1);
  assert.equal(instancesForTemplate(state, "wf-2").length, 1);
});

test("an action targeting an unknown instanceId is a no-op", () => {
  const state = addInstances(initialTaskRuntimeState(), [draft()]);
  const next = taskRuntimeReducer(state, { type: "COMPLETE", instanceId: "does-not-exist" }, fixedNow);
  assert.equal(next, state);
});

test("ADD_ATOMIC_IDEA_DRAFT / UPDATE_ATOMIC_IDEA_DRAFT / REMOVE_ATOMIC_IDEA_DRAFT manage Repurpose Map's draft list", () => {
  let state = addInstances(initialTaskRuntimeState(), [draft()]);
  const id = state.instances[0].id;
  const atomicDraft = { id: "d1", text: "Muammo nima?", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL"], angleId: null, destinationNeeded: false };
  state = taskRuntimeReducer(state, { type: "ADD_ATOMIC_IDEA_DRAFT", instanceId: id, draft: atomicDraft }, fixedNow);
  assert.equal(instanceById(state, id).atomicIdeaDrafts.length, 1);
  state = taskRuntimeReducer(state, { type: "UPDATE_ATOMIC_IDEA_DRAFT", instanceId: id, draftId: "d1", changes: { decision: "LATER" } }, fixedNow);
  assert.equal(instanceById(state, id).atomicIdeaDrafts[0].decision, "LATER");
  state = taskRuntimeReducer(state, { type: "REMOVE_ATOMIC_IDEA_DRAFT", instanceId: id, draftId: "d1" }, fixedNow);
  assert.equal(instanceById(state, id).atomicIdeaDrafts.length, 0);
});
