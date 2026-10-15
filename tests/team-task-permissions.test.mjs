import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-team-task-permissions-"));
const source = readFileSync(new URL("../lib/team-task-permissions.ts", import.meta.url), "utf8");
writeFileSync(join(dir, "team-task-permissions.js"), ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText);
const require = createRequire(import.meta.url);
const permissions = require(join(dir, "team-task-permissions.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const creator = { id: "11111111-1111-4111-8111-111111111111", role: "CONTENT_MARKETER" };
const assignee = { id: "22222222-2222-4222-8222-222222222222", role: "OPERATOR_VIDEO_EDITOR" };
const unrelated = { id: "33333333-3333-4333-8333-333333333333", role: "DIGITAL_MARKETER" };
const head = { id: "44444444-4444-4444-8444-444444444444", role: "HEAD_OF_MARKETING" };
const task = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  creatorId: creator.id,
  assigneeId: assignee.id,
  status: "IN_PROGRESS",
};

test("creator and Head get direct edit/reassign/deadline rights while an unrelated member stays read-only", () => {
  for (const actor of [creator, head]) {
    assert.equal(permissions.canEditTask(actor, task), true);
    assert.equal(permissions.canDirectReassign(actor, task), true);
    assert.equal(permissions.canDirectChangeDeadline(actor, task), true);
  }
  assert.equal(permissions.canEditTask(unrelated, task), false);
  assert.equal(permissions.canDirectReassign(unrelated, task), false);
  assert.equal(permissions.canDirectChangeDeadline(unrelated, task), false);
});

test("ordinary assignee requests changes, but creator/Head use the direct path", () => {
  assert.equal(permissions.canRequestTaskChange(assignee, task), true);
  assert.equal(permissions.canRequestTaskChange(creator, task), false);
  assert.equal(permissions.canRequestTaskChange(head, task), false);
  assert.equal(permissions.canRequestTaskChange(unrelated, task), false);
});

test("a self-assigned creator receives creator rights, not an unnecessary request path", () => {
  const selfAssigned = { ...task, assigneeId: creator.id };
  assert.equal(permissions.isTaskAssignee(creator, selfAssigned), true);
  assert.equal(permissions.canEditTask(creator, selfAssigned), true);
  assert.equal(permissions.canRequestTaskChange(creator, selfAssigned), false);
});

test("finished tasks cannot be directly reassigned or rescheduled and cannot open change requests", () => {
  for (const status of ["DONE", "CANCELLED"]) {
    const finished = { ...task, status };
    assert.equal(permissions.canDirectReassign(creator, finished), false);
    assert.equal(permissions.canDirectChangeDeadline(head, finished), false);
    assert.equal(permissions.canRequestTaskChange(assignee, finished), false);
  }
});

test("archive/restore controls are Head-only in the UI helper", () => {
  assert.equal(permissions.canArchiveTask(head), true);
  for (const actor of [creator, assignee, unrelated]) assert.equal(permissions.canArchiveTask(actor), false);
});
