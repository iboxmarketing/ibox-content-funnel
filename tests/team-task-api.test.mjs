import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "ibox-team-task-api-"));
const source = readFileSync(new URL("../lib/team-task-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText.replace('require("zod")', `require(${JSON.stringify(require.resolve("zod"))})`);
writeFileSync(join(dir, "team-task-api.js"), compiled);
const { TeamTaskMutationSchema, readTeamTasks, mutateTeamTask } = require(join(dir, "team-task-api.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const ACTOR = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const DEADLINE = "2026-11-01T09:00:00.000Z";

function recordingClient() {
  const calls = [];
  const client = new Proxy({}, {
    get(_target, name) {
      return async (...args) => {
        calls.push([name, ...args]);
        return name === "archive" ? undefined : { source: name };
      };
    },
  });
  return { client, calls };
}

test("read surface selects the exact Task Bot resources and scopes", async () => {
  const { client, calls } = recordingClient();
  await readTeamTasks(new URLSearchParams("resource=tasks&scope=my"), client);
  await readTeamTasks(new URLSearchParams("resource=tasks&scope=all"), client);
  await readTeamTasks(new URLSearchParams("resource=tasks&scope=archived"), client);
  await readTeamTasks(new URLSearchParams(`resource=task&taskId=${TASK}`), client);
  await readTeamTasks(new URLSearchParams("resource=users"), client);
  await readTeamTasks(new URLSearchParams("resource=requests&status=APPROVED"), client);
  assert.deepEqual(calls, [
    ["listTasks", "my"],
    ["listTasks", "all"],
    ["listTasks", "archived"],
    ["getDetails", TASK],
    ["listUsers"],
    ["listChangeRequests", "APPROVED"],
  ]);
});

test("read surface rejects unknown resources, scopes, and malformed ids before calling Task Bot", async () => {
  const { client, calls } = recordingClient();
  await assert.rejects(() => readTeamTasks(new URLSearchParams("resource=admin"), client));
  await assert.rejects(() => readTeamTasks(new URLSearchParams("resource=tasks&scope=deleted"), client));
  await assert.rejects(() => readTeamTasks(new URLSearchParams("resource=task&taskId=nope"), client));
  assert.equal(calls.length, 0);
});

test("every UI mutation maps to one authoritative Task Bot client operation", async () => {
  const cases = [
    [{ action: "create", title: "Draft launch post", description: "Context", priority: "high", assigneeId: USER, deadline: DEADLINE }, ["create", { title: "Draft launch post", description: "Context", priority: "high", assigneeId: USER, creatorId: ACTOR, deadline: DEADLINE }]],
    [{ action: "edit", taskId: TASK, title: "Edited", description: null, priority: "low" }, ["editTask", TASK, { title: "Edited", description: null, priority: "low" }]],
    [{ action: "lifecycle", taskId: TASK, taskAction: "BLOCK", reason: "Waiting" }, ["action", TASK, "BLOCK", "Waiting"]],
    [{ action: "direct-reassign", taskId: TASK, assigneeId: USER }, ["directReassign", TASK, USER]],
    [{ action: "direct-deadline", taskId: TASK, deadline: DEADLINE }, ["directDeadline", TASK, DEADLINE]],
    [{ action: "request-reassign", taskId: TASK, requestedAssigneeId: USER, reason: "Capacity" }, ["requestReassign", TASK, USER, "Capacity"]],
    [{ action: "request-deadline", taskId: TASK, requestedDeadline: DEADLINE, reason: "Dependency" }, ["requestDeadline", TASK, DEADLINE, "Dependency"]],
    [{ action: "resolve-reassign", requestId: REQUEST, approve: true, resolutionNote: "Approved" }, ["resolveReassign", REQUEST, true, "Approved"]],
    [{ action: "resolve-deadline", requestId: REQUEST, approve: false }, ["resolveDeadline", REQUEST, false, undefined]],
    [{ action: "archive", taskId: TASK, reason: "No longer needed" }, ["archive", TASK, "No longer needed"]],
    [{ action: "restore", taskId: TASK }, ["restore", TASK]],
  ];
  for (const [input, expected] of cases) {
    const { client, calls } = recordingClient();
    await mutateTeamTask(input, ACTOR, client);
    assert.deepEqual(calls, [expected]);
  }
});

test("strict mutation schema rejects extra fields and malformed identifiers", () => {
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "restore", taskId: TASK, hardDelete: true }).success, false);
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "direct-reassign", taskId: TASK, assigneeId: "not-a-user" }).success, false);
});
