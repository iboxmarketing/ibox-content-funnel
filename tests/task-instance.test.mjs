import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-instance-"));
for (const name of ["task-link", "task-instance"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  createTaskInstance,
  isTaskInstanceSettled,
  setTaskInstanceStatus,
  setTaskInstanceFieldValue,
  addCustomFieldToInstance,
  removeCustomFieldFromInstance,
  editTransferredFieldValue,
  provenanceForField,
  markTaskInstanceDone,
  skipTaskInstance,
  validateFieldValueByType,
  validateTaskInstanceForCompletion,
  canCompleteTaskInstance,
  createTemplateImprovementSuggestion,
  emptyCustomField,
} = require(join(dir, "task-instance.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T03:00:${String(tick++).padStart(2, "0")}.000Z`;

function baseDraft(overrides = {}) {
  return {
    taskTypeId: "tt-blog",
    workflowTemplateId: "wf-1",
    workflowStepId: "step-1",
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

const TEXT_FIELD = { id: "f-text", label: "Title", type: "TEXT", required: true };
const URL_FIELD = { id: "f-url", label: "Link", type: "URL", required: true };
const NUMBER_FIELD = { id: "f-num", label: "Count", type: "NUMBER", required: true };
const SELECT_FIELD = { id: "f-sel", label: "Pick", type: "SELECT", required: true, options: [{ value: "A", label: "A" }] };
const BOOLEAN_FIELD = { id: "f-bool", label: "Approved", type: "BOOLEAN", required: true };

test("createTaskInstance starts ASSIGNED with no outcome", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  assert.equal(instance.status, "ASSIGNED");
  assert.equal(instance.outcome, null);
  assert.equal(instance.skipReason, null);
  assert.deepEqual(instance.fieldProvenance, []);
});

test("createTaskInstance defaults contentRef to null and relatedEntityRefs to empty when not provided", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  assert.equal(instance.contentRef, null);
  assert.deepEqual(instance.relatedEntityRefs, []);
});

test("createTaskInstance honors an explicit contentRef and relatedEntityRefs (section 7's task<->entity relation)", () => {
  const contentRef = { entityType: "KNOWLEDGE_NODE", entityId: "node-1" };
  const related = [{ entityType: "KNOWLEDGE_NODE", entityId: "node-2" }];
  const instance = createTaskInstance(baseDraft({ contentRef, relatedEntityRefs: related }), fixedNow);
  assert.deepEqual(instance.contentRef, contentRef);
  assert.deepEqual(instance.relatedEntityRefs, related);
});

test("createTaskInstance honors an initial fieldProvenance (the Context Transfer result), but never invents one", () => {
  const provenance = [{ fieldId: "seo-notes", sourceTaskId: "ti-source", sourceFieldId: "blog-link" }];
  const instance = createTaskInstance(baseDraft({ fieldProvenance: provenance }), fixedNow);
  assert.deepEqual(instance.fieldProvenance, provenance);
});

test("markTaskInstanceDone sets status DONE and outcome COMPLETED", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const done = markTaskInstanceDone(instance, fixedNow);
  assert.equal(done.status, "DONE");
  assert.equal(done.outcome, "COMPLETED");
  assert.equal(isTaskInstanceSettled(done), true);
});

test("skipTaskInstance uses the existing CANCELLED status plus an outcome flag -- SKIPPED is never added to the status enum", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const skipped = skipTaskInstance(instance, "Not needed this cycle", fixedNow);
  assert.equal(skipped.status, "CANCELLED");
  assert.equal(skipped.outcome, "SKIPPED");
  assert.equal(skipped.skipReason, "Not needed this cycle");
  assert.equal(isTaskInstanceSettled(skipped), true, "a skipped step must still count as settled for dependency progression");
});

test("a plain CANCELLED-without-outcome instance is not settled (distinguishes an ordinary cancel from a skip)", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const cancelled = setTaskInstanceStatus(instance, "CANCELLED", fixedNow);
  assert.equal(isTaskInstanceSettled(cancelled), false);
});

test("an in-progress, non-done instance is not settled", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  assert.equal(isTaskInstanceSettled(setTaskInstanceStatus(instance, "IN_PROGRESS", fixedNow)), false);
});

// --- required-field runtime / by-type validation ---

test("validateFieldValueByType: each Sprint 1 field type validates its own value shape", () => {
  assert.equal(validateFieldValueByType(TEXT_FIELD, "hello"), null);
  assert.equal(validateFieldValueByType(TEXT_FIELD, 5) !== null, true);

  assert.equal(validateFieldValueByType(NUMBER_FIELD, 5), null);
  assert.equal(validateFieldValueByType(NUMBER_FIELD, "5") !== null, true);

  assert.equal(validateFieldValueByType(BOOLEAN_FIELD, true), null);
  assert.equal(validateFieldValueByType(BOOLEAN_FIELD, "true") !== null, true);

  assert.equal(validateFieldValueByType({ ...TEXT_FIELD, type: "DATE" }, "2026-10-08"), null);
  assert.equal(validateFieldValueByType({ ...TEXT_FIELD, type: "DATE" }, "not-a-date") !== null, true);

  assert.equal(validateFieldValueByType(URL_FIELD, "https://example.com"), null);
  assert.equal(validateFieldValueByType(URL_FIELD, "not-a-url") !== null, true);

  assert.equal(validateFieldValueByType(SELECT_FIELD, "A"), null);
  assert.equal(validateFieldValueByType(SELECT_FIELD, "Z") !== null, true);

  const multi = { ...SELECT_FIELD, type: "MULTI_SELECT", options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] };
  assert.equal(validateFieldValueByType(multi, ["A", "B"]), null);
  assert.equal(validateFieldValueByType(multi, ["A", "Z"]) !== null, true);
});

test("validateFieldValueByType does not flag an empty value -- required-ness is checked separately", () => {
  assert.equal(validateFieldValueByType(TEXT_FIELD, null), null);
  assert.equal(validateFieldValueByType(TEXT_FIELD, ""), null);
});

test("Complete is blocked when a required field is missing", () => {
  const instance = createTaskInstance(baseDraft({ deadline: "2026-10-09" }), fixedNow);
  const errors = validateTaskInstanceForCompletion(instance, [TEXT_FIELD]);
  assert.ok(errors.some((e) => e.code === "MISSING_REQUIRED_FIELD" && e.fieldId === "f-text"));
  assert.equal(canCompleteTaskInstance(instance, [TEXT_FIELD]), false);
});

test("Complete is blocked by an invalid URL field even though it is non-empty", () => {
  let instance = createTaskInstance(baseDraft({ deadline: "2026-10-09" }), fixedNow);
  instance = setTaskInstanceFieldValue(instance, "f-url", "not-a-url", fixedNow);
  const errors = validateTaskInstanceForCompletion(instance, [URL_FIELD]);
  assert.ok(errors.some((e) => e.code === "INVALID_FIELD_VALUE" && e.fieldId === "f-url"));
});

test("Complete is blocked when deadline is missing", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const errors = validateTaskInstanceForCompletion(instance, []);
  assert.ok(errors.some((e) => e.code === "MISSING_DEADLINE"));
});

test("an optional field left empty never blocks Complete", () => {
  const optionalField = { ...TEXT_FIELD, id: "f-optional", required: false };
  let instance = createTaskInstance(baseDraft({ deadline: "2026-10-09" }), fixedNow);
  instance = setTaskInstanceFieldValue(instance, "f-text", "filled", fixedNow);
  const errors = validateTaskInstanceForCompletion(instance, [TEXT_FIELD, optionalField]);
  assert.deepEqual(errors, []);
  assert.equal(canCompleteTaskInstance(instance, [TEXT_FIELD, optionalField]), true);
});

test("a BOOLEAN required field is satisfied by an explicit false (false is a real, complete answer)", () => {
  let instance = createTaskInstance(baseDraft({ deadline: "2026-10-09" }), fixedNow);
  instance = setTaskInstanceFieldValue(instance, "f-bool", false, fixedNow);
  assert.equal(canCompleteTaskInstance(instance, [BOOLEAN_FIELD]), true);
});

// --- custom fields (section 5) ---

test("a custom field belongs only to the instance it was added to", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const custom = emptyCustomField("TEXT");
  const withCustom = addCustomFieldToInstance(instance, { ...custom, label: "Extra context", required: true }, fixedNow);
  assert.equal(withCustom.customFields.length, 1);
  assert.equal(instance.customFields.length, 0, "original instance must be untouched");
});

test("a required custom field blocks Complete just like a Task Type required field", () => {
  let instance = createTaskInstance(baseDraft({ deadline: "2026-10-09" }), fixedNow);
  instance = addCustomFieldToInstance(instance, { id: "custom-1", label: "Extra", type: "TEXT", required: true }, fixedNow);
  assert.equal(canCompleteTaskInstance(instance, []), false);
  instance = setTaskInstanceFieldValue(instance, "custom-1", "filled in", fixedNow);
  assert.equal(canCompleteTaskInstance(instance, []), true);
});

test("removeCustomFieldFromInstance drops both the definition and its stored value", () => {
  let instance = createTaskInstance(baseDraft(), fixedNow);
  instance = addCustomFieldToInstance(instance, { id: "custom-1", label: "Extra", type: "TEXT", required: false }, fixedNow);
  instance = setTaskInstanceFieldValue(instance, "custom-1", "value", fixedNow);
  instance = removeCustomFieldFromInstance(instance, "custom-1", fixedNow);
  assert.equal(instance.customFields.length, 0);
  assert.equal("custom-1" in instance.fieldValues, false);
});

test("createTemplateImprovementSuggestion records a local suggestion without touching any TaskType", () => {
  const suggestion = createTemplateImprovementSuggestion(
    { taskInstanceId: "ti-1", taskTypeId: "tt-blog", field: { id: "custom-1", label: "Extra", type: "TEXT", required: false }, note: "Would help every Blog task" },
    fixedNow,
  );
  assert.equal(suggestion.taskTypeId, "tt-blog");
  assert.equal(suggestion.field.label, "Extra");
  assert.ok(suggestion.id);
  // This is the whole point of the Sprint 2 constraint: a suggestion is
  // just a plain record, there is no TaskType mutation function it could
  // have called.
});

// --- provenance / edit-transferred-value (sections 11-12) ---

test("provenanceForField finds a recorded transfer by destination field id", () => {
  const instance = { ...createTaskInstance(baseDraft(), fixedNow), fieldProvenance: [{ fieldId: "f-text", sourceTaskId: "ti-source", sourceFieldId: "f-other" }] };
  const found = provenanceForField(instance, "f-text");
  assert.equal(found.sourceTaskId, "ti-source");
  assert.equal(provenanceForField(instance, "nope"), undefined);
});

test("editTransferredFieldValue only updates the target instance -- writing the source back is a separate, explicit call", () => {
  const instance = createTaskInstance(baseDraft(), fixedNow);
  const edited = editTransferredFieldValue(instance, "f-text", "new value", fixedNow);
  assert.equal(edited.fieldValues["f-text"], "new value");
});
