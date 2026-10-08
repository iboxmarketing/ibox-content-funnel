import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-type-"));
for (const name of ["task-type"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  createTaskType,
  duplicateTaskType,
  reviseTaskType,
  setTaskTypeActive,
  validateTaskType,
  isTaskTypeValid,
} = require(join(dir, "task-type.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T00:00:0${tick++}.000Z`;

function baseDraft(overrides = {}) {
  return {
    name: "Blog",
    description: "Canonical blog draft",
    requiredFields: [{ id: "title", label: "Title", type: "TEXT", required: true }],
    optionalFields: [],
    defaultPrompt: null,
    promptVersion: null,
    defaultAssigneeRule: { kind: "DEFAULT_CONTENT_OWNER" },
    recommendedDay: null,
    reviewRequired: true,
    allowedLinkLabels: ["Reference"],
    completionRequirements: [],
    ...overrides,
  };
}

test("createTaskType assigns a stable id, version 1, isActive true, and matching timestamps", () => {
  const taskType = createTaskType(baseDraft(), fixedNow);
  assert.ok(taskType.id.startsWith("tt-blog-"));
  assert.equal(taskType.version, 1);
  assert.equal(taskType.isActive, true);
  assert.equal(taskType.createdAt, taskType.updatedAt);
});

test("duplicateTaskType gets a new id, resets to version 1, and suffixes the name", () => {
  const original = createTaskType(baseDraft(), fixedNow);
  const copy = duplicateTaskType(original, fixedNow);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.version, 1);
  assert.match(copy.name, /\(nusxa\)$/);
  assert.deepEqual(copy.requiredFields, original.requiredFields);
});

test("reviseTaskType increments version and refreshes updatedAt without changing id or createdAt", () => {
  const original = createTaskType(baseDraft(), fixedNow);
  const revised = reviseTaskType(original, { description: "Updated description" }, fixedNow);
  assert.equal(revised.id, original.id);
  assert.equal(revised.createdAt, original.createdAt);
  assert.equal(revised.version, original.version + 1);
  assert.notEqual(revised.updatedAt, original.updatedAt);
  assert.equal(revised.description, "Updated description");
});

test("setTaskTypeActive toggles isActive and is a no-op (same reference-equal-ish state) when already at the target value", () => {
  const original = createTaskType(baseDraft(), fixedNow);
  const deactivated = setTaskTypeActive(original, false, fixedNow);
  assert.equal(deactivated.isActive, false);
  const idempotent = setTaskTypeActive(deactivated, false, fixedNow);
  assert.equal(idempotent, deactivated, "no change when already at target state");
});

// --- Validation ---

test("a valid TaskType produces zero validation errors", () => {
  assert.deepEqual(validateTaskType(baseDraft()), []);
  assert.equal(isTaskTypeValid(baseDraft()), true);
});

test("MISSING_NAME: an empty or whitespace-only name is rejected", () => {
  assert.ok(validateTaskType(baseDraft({ name: "" })).some((e) => e.code === "MISSING_NAME"));
  assert.ok(validateTaskType(baseDraft({ name: "   " })).some((e) => e.code === "MISSING_NAME"));
});

test("DUPLICATE_FIELD_ID: the same field id across requiredFields/optionalFields is rejected", () => {
  const errors = validateTaskType(baseDraft({
    requiredFields: [{ id: "x", label: "X", type: "TEXT", required: true }],
    optionalFields: [{ id: "x", label: "X again", type: "TEXT", required: false }],
  }));
  assert.ok(errors.some((e) => e.code === "DUPLICATE_FIELD_ID" && e.fieldId === "x"));
});

test("MISSING_FIELD_LABEL: a field with a blank label is rejected", () => {
  const errors = validateTaskType(baseDraft({ requiredFields: [{ id: "x", label: "  ", type: "TEXT", required: true }] }));
  assert.ok(errors.some((e) => e.code === "MISSING_FIELD_LABEL"));
});

test("SELECT_WITHOUT_OPTIONS: SELECT/MULTI_SELECT fields require at least one option", () => {
  const select = validateTaskType(baseDraft({ requiredFields: [{ id: "x", label: "X", type: "SELECT", required: true }] }));
  assert.ok(select.some((e) => e.code === "SELECT_WITHOUT_OPTIONS"));
  const multi = validateTaskType(baseDraft({ requiredFields: [{ id: "x", label: "X", type: "MULTI_SELECT", required: true, options: [] }] }));
  assert.ok(multi.some((e) => e.code === "SELECT_WITHOUT_OPTIONS"));
});

test("a SELECT field with at least one option passes", () => {
  const errors = validateTaskType(baseDraft({ requiredFields: [{ id: "x", label: "X", type: "SELECT", required: true, options: [{ value: "a", label: "A" }] }] }));
  assert.deepEqual(errors, []);
});

test("DUPLICATE_OPTION_VALUE: two options with the same value on one field are rejected", () => {
  const errors = validateTaskType(baseDraft({
    requiredFields: [{ id: "x", label: "X", type: "SELECT", required: true, options: [{ value: "a", label: "A" }, { value: "a", label: "A again" }] }],
  }));
  assert.ok(errors.some((e) => e.code === "DUPLICATE_OPTION_VALUE"));
});

test("INVALID_COMPLETION_FIELD_REF: a completion requirement referencing an unknown field id is rejected", () => {
  const errors = validateTaskType(baseDraft({
    completionRequirements: [{ id: "req-1", labelUz: "Majburiy", requiresFieldId: "unknown-field" }],
  }));
  assert.ok(errors.some((e) => e.code === "INVALID_COMPLETION_FIELD_REF"));
});

test("a completion requirement referencing a real field id passes", () => {
  const errors = validateTaskType(baseDraft({
    requiredFields: [{ id: "title", label: "Title", type: "TEXT", required: true }],
    completionRequirements: [{ id: "req-1", labelUz: "Majburiy", requiresFieldId: "title" }],
  }));
  assert.deepEqual(errors, []);
});

test("DUPLICATE_COMPLETION_REQUIREMENT_ID: two requirements sharing an id are rejected", () => {
  const errors = validateTaskType(baseDraft({
    completionRequirements: [
      { id: "req-1", labelUz: "A", requiresFieldId: null },
      { id: "req-1", labelUz: "B", requiresFieldId: null },
    ],
  }));
  assert.ok(errors.some((e) => e.code === "DUPLICATE_COMPLETION_REQUIREMENT_ID"));
});

test("PROMPT_WITHOUT_VERSION: a defaultPrompt with no promptVersion is rejected", () => {
  const errors = validateTaskType(baseDraft({ defaultPrompt: "Write the thing.", promptVersion: null }));
  assert.ok(errors.some((e) => e.code === "PROMPT_WITHOUT_VERSION"));
});

test("a defaultPrompt with a promptVersion passes", () => {
  const errors = validateTaskType(baseDraft({ defaultPrompt: "Write the thing.", promptVersion: "v1" }));
  assert.deepEqual(errors, []);
});

test("FIXED_ROLE_WITHOUT_ROLE: a FIXED_ROLE assignee rule with a blank role is rejected", () => {
  const errors = validateTaskType(baseDraft({ defaultAssigneeRule: { kind: "FIXED_ROLE", role: "" } }));
  assert.ok(errors.some((e) => e.code === "FIXED_ROLE_WITHOUT_ROLE"));
});

test("validateTaskType never mutates its input", () => {
  const input = baseDraft({ name: "" });
  const snapshot = JSON.stringify(input);
  validateTaskType(input);
  assert.equal(JSON.stringify(input), snapshot);
});
