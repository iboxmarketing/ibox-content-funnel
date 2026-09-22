import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-client-"));
for (const name of ["task-client-types", "task-client"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TaskBackendNotConfiguredError } = require(join(dir, "task-client-types.js"));
const { BlockedTaskClient, getTaskClient } = require(join(dir, "task-client.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const sampleCreateInput = {
  title: "Draft a carousel",
  priority: "normal",
  assigneeId: "00000000-0000-0000-0000-000000000001",
  creatorId: "00000000-0000-0000-0000-000000000002",
  deadline: "2026-10-01T09:00:00.000Z",
};

test("getTaskClient() returns the blocked implementation today", () => {
  assert.ok(getTaskClient() instanceof BlockedTaskClient);
});

test("every TaskClient mutation rejects with TASK_BACKEND_SETUP_REQUIRED -- no second writable task source exists", async () => {
  const client = new BlockedTaskClient();
  await assert.rejects(() => client.create(sampleCreateInput), TaskBackendNotConfiguredError);
  await assert.rejects(() => client.read("00000000-0000-0000-0000-000000000099"), TaskBackendNotConfiguredError);
  await assert.rejects(() => client.accept("t1", "a1"), TaskBackendNotConfiguredError);
  await assert.rejects(() => client.transition("t1", "a1", "IN_PROGRESS"), TaskBackendNotConfiguredError);
  await assert.rejects(
    () => client.requestDeadlineChange({ taskId: "t1", requestedBy: "a1", requestedDeadline: "2026-10-02T09:00:00.000Z", reason: "client moved the date" }),
    TaskBackendNotConfiguredError,
  );
  await assert.rejects(() => client.submitForReview("t1", "a1"), TaskBackendNotConfiguredError);
  await assert.rejects(() => client.requestRevision("t1", "a1", "needs another pass"), TaskBackendNotConfiguredError);
});

test("the blocked error carries the exact code the existing PATCH /api/production/tasks route already returns", async () => {
  const client = new BlockedTaskClient();
  try {
    await client.create(sampleCreateInput);
    assert.fail("expected a rejection");
  } catch (error) {
    assert.equal(error.code, "TASK_BACKEND_SETUP_REQUIRED");
  }
});

test("no method on BlockedTaskClient resolves -- every path is a dead end until a real backend is wired", async () => {
  const client = new BlockedTaskClient();
  const methods = ["create", "read", "accept", "transition", "requestDeadlineChange", "submitForReview", "requestRevision"];
  for (const method of methods) {
    assert.equal(typeof client[method], "function", method);
  }
});
