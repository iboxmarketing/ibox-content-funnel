import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-client-http-"));
for (const name of ["task-client-types", "task-backend-wire-mapping", "task-client-http-config", "task-client-http"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TaskBackendHttpError, AmbiguousTransitionError, HttpTaskClient } = require(join(dir, "task-client-http.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

// --- A real, strictly-local (127.0.0.1) mock HTTP server. No egress to any
// real remote host ever happens in this file: only fetch() calls pointed at
// this in-process server's own loopback address are made. ---

function startMockServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        const record = { method: req.method, url: req.url, headers: req.headers, body: bodyText ? JSON.parse(bodyText) : null };
        requests.push(record);
        const { status, body } = handler(record, requests.length);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, requests, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

const CONFIG_TEMPLATE = (baseUrl) => ({ baseUrl, sessionCookie: "test-session-cookie-value" });

const RAW_TASK = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Draft a carousel",
  description: null,
  priority: "normal",
  status: "ASSIGNED",
  creatorId: "22222222-2222-2222-2222-222222222222",
  assigneeId: "33333333-3333-3333-3333-333333333333",
  deadline: "2026-10-01T09:00:00.000Z",
  blockedReason: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:00:00.000Z",
};

// --- Route/method mapping + request serialization + response parsing ---

test("create() POSTs /api/tasks with exactly the bot's CreateTaskInputSchema fields, no contentRef leak", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 201, body: { task: RAW_TASK, assignee: {}, notification: { status: "SENT" } } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));

  const task = await client.create({
    title: "Draft a carousel",
    assigneeId: RAW_TASK.assigneeId,
    creatorId: RAW_TASK.creatorId,
    deadline: RAW_TASK.deadline,
    priority: "normal",
    contentRef: "TPI-042",
  });

  await closeServer(server);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/api/tasks");
  assert.deepEqual(requests[0].body, {
    title: "Draft a carousel",
    assigneeId: RAW_TASK.assigneeId,
    deadline: RAW_TASK.deadline,
    priority: "normal",
  });
  assert.ok(!("contentRef" in requests[0].body), "contentRef must never be sent -- the bot's schema is .strict() and would reject it");
  assert.equal(task.id, RAW_TASK.id);
  assert.equal(task.contentRef, null, "contentRef is always null in the mapped result until a bridge column exists");
});

test("every request carries the session cookie -- auth is 100% cookie-derived, never a payload field", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: RAW_TASK } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await client.read(RAW_TASK.id);
  await closeServer(server);
  assert.match(requests[0].headers.cookie, /marketing_session=test-session-cookie-value/);
});

test("read() GETs /api/tasks/{id} and unwraps the nested `task` field", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: RAW_TASK, events: [], deadlineRequests: [], postingChecklist: null, recurringDefinition: null } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  const task = await client.read(RAW_TASK.id);
  await closeServer(server);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}`);
  assert.equal(task.status, "ASSIGNED");
});

test("read() maps a 404 to null instead of throwing", async () => {
  const { server, baseUrl } = await startMockServer(() => ({ status: 404, body: { error: "Task not found.", code: "NOT_FOUND" } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  const task = await client.read("00000000-0000-0000-0000-000000000000");
  await closeServer(server);
  assert.equal(task, null);
});

test("accept() POSTs the actions endpoint with {action: 'ACCEPT'} and ignores the actorId parameter (no wire field for it)", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: { ...RAW_TASK, status: "IN_PROGRESS" } } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  const task = await client.accept(RAW_TASK.id, "some-other-user-id-that-cannot-be-impersonated");
  await closeServer(server);
  assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}/actions`);
  assert.deepEqual(requests[0].body, { action: "ACCEPT" });
  assert.equal(task.status, "IN_PROGRESS");
});

test("submitForReview() sends action SUBMIT_REVIEW", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: { ...RAW_TASK, status: "REVIEW" } } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await client.submitForReview(RAW_TASK.id, "actor");
  await closeServer(server);
  assert.deepEqual(requests[0].body, { action: "SUBMIT_REVIEW" });
});

test("requestRevision() sends action REQUEST_REVISION with the reason", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: { ...RAW_TASK, status: "REVISION" } } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await client.requestRevision(RAW_TASK.id, "actor", "needs another pass");
  await closeServer(server);
  assert.deepEqual(requests[0].body, { action: "REQUEST_REVISION", reason: "needs another pass" });
});

test("requestDeadlineChange() POSTs the deadline-requests sub-route with exactly requestedDeadline+reason", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({
    status: 201,
    body: { deadlineRequest: { id: "dr-1", taskId: RAW_TASK.id, status: "PENDING" } },
  }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await client.requestDeadlineChange({
    taskId: RAW_TASK.id,
    requestedBy: "should-be-ignored-actor-id",
    requestedDeadline: "2026-10-05T09:00:00.000Z",
    reason: "client moved the launch date",
  });
  await closeServer(server);
  assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}/deadline-requests`);
  assert.deepEqual(requests[0].body, { requestedDeadline: "2026-10-05T09:00:00.000Z", reason: "client moved the launch date" });
});

// --- transition(): unambiguous mappings + the documented IN_PROGRESS gap ---

test("transition() maps each unambiguous target status to the bot's one matching action", async () => {
  const cases = [
    ["BLOCKED", "BLOCK"],
    ["REVIEW", "SUBMIT_REVIEW"],
    ["DONE", "APPROVE"],
    ["REVISION", "REQUEST_REVISION"],
    ["CANCELLED", "CANCEL"],
    ["ASSIGNED", "REOPEN"],
  ];
  for (const [status, action] of cases) {
    const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: { ...RAW_TASK, status } } }));
    const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
    await client.transition(RAW_TASK.id, "actor", status, status === "BLOCKED" ? "blocked reason" : undefined);
    await closeServer(server);
    assert.equal(requests[0].body.action, action, status);
  }
});

test("transition() to IN_PROGRESS throws AmbiguousTransitionError instead of guessing ACCEPT vs RESUME", async () => {
  const client = new HttpTaskClient(CONFIG_TEMPLATE("https://unused.example"));
  await assert.rejects(() => client.transition(RAW_TASK.id, "actor", "IN_PROGRESS"), AmbiguousTransitionError);
});

// --- Error mapping ---

test("a 409 CONFLICT (e.g. retried ACCEPT after it already succeeded) surfaces as TaskBackendHttpError with the bot's code", async () => {
  const { server, baseUrl } = await startMockServer(() => ({ status: 409, body: { error: "ACCEPT is not valid while task is IN_PROGRESS.", code: "CONFLICT" } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await assert.rejects(() => client.accept(RAW_TASK.id, "actor"), (error) => {
    assert.ok(error instanceof TaskBackendHttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "CONFLICT");
    return true;
  });
  await closeServer(server);
});

test("a 400 INVALID_INPUT (Zod validation failure) surfaces its issues array", async () => {
  const { server, baseUrl } = await startMockServer(() => ({
    status: 400,
    body: { error: "Invalid request.", code: "INVALID_INPUT", issues: [{ path: ["reason"], message: "Blocked reason is required" }] },
  }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await assert.rejects(() => client.transition(RAW_TASK.id, "actor", "BLOCKED"), (error) => {
    assert.equal(error.code, "INVALID_INPUT");
    assert.equal(error.issues[0].message, "Blocked reason is required");
    return true;
  });
  await closeServer(server);
});

test("a 401 UNAUTHENTICATED (expired/forged session cookie) surfaces distinctly from a 403", async () => {
  const { server, baseUrl } = await startMockServer(() => ({ status: 401, body: { error: "The session is invalid or expired.", code: "UNAUTHENTICATED" } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  await assert.rejects(() => client.read(RAW_TASK.id), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHENTICATED");
    return true;
  });
  await closeServer(server);
});

// --- Idempotency gap: documented, not hidden ---

test("create() has no client-side idempotency key -- two identical calls produce two separate requests", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 201, body: { task: RAW_TASK, assignee: {}, notification: { status: "SENT" } } }));
  const client = new HttpTaskClient(CONFIG_TEMPLATE(baseUrl));
  const input = { title: "Same task twice", assigneeId: RAW_TASK.assigneeId, creatorId: RAW_TASK.creatorId, deadline: RAW_TASK.deadline, priority: "normal" };
  await client.create(input);
  await client.create(input);
  await closeServer(server);
  assert.equal(requests.length, 2, "the wire contract has no idempotency key field, so a retry is indistinguishable from a second real task");
  assert.deepEqual(requests[0].body, requests[1].body);
});
