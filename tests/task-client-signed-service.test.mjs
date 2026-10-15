import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-signed-service-client-"));
for (const name of [
  "task-client-types",
  "task-backend-wire-mapping",
  "content-os-task-backend-signer",
  "task-backend-service-auth-config",
  "task-client-signed-service",
]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  SignedServiceTaskClient,
  getSignedServiceTaskClient,
  TaskBackendHttpError,
  TaskBackendServiceAuthConfigError,
  TaskBackendSignerInputError,
} = require(join(dir, "task-client-signed-service.js"));
const {
  CONTENT_OS_TIMESTAMP_HEADER,
  CONTENT_OS_ACTOR_PROVIDER_HEADER,
  CONTENT_OS_ACTOR_SUBJECT_HEADER,
  CONTENT_OS_SIGNATURE_HEADER,
  signTaskBackendRequest,
} = require(join(dir, "content-os-task-backend-signer.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

// --- A real, strictly-local (127.0.0.1) mock HTTP server. No egress to any
// real remote host ever happens in this file. ---
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

const SECRET = "test-content-os-task-backend-secret";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const CONFIG_TEMPLATE = (baseUrl) => ({ baseUrl, secret: SECRET });

const RAW_TASK = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Draft a carousel",
  description: null,
  priority: "normal",
  status: "ASSIGNED",
  creatorId: "22222222-2222-2222-2222-222222222222",
  assigneeId: "33333333-3333-3333-3333-333333333333",
  deadline: "2026-10-01T09:00:00.000Z",
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:00:00.000Z",
};

// --- Route/method mapping + signed headers present on every request ---

test("create() POSTs /api/tasks with exactly the bot's CreateTaskInputSchema fields, no contentRef leak", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 201, body: { task: RAW_TASK, assignee: {}, notification: { status: "SENT" } } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);

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
  assert.deepEqual(requests[0].body, { title: "Draft a carousel", assigneeId: RAW_TASK.assigneeId, deadline: RAW_TASK.deadline, priority: "normal" });
  assert.ok(!("contentRef" in requests[0].body));
  assert.equal(task.contentRef, null);
});

test("every request carries all four signed headers -- no marketing_session cookie, no secret", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: RAW_TASK } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
  await client.read(RAW_TASK.id);
  await closeServer(server);

  const headers = requests[0].headers;
  assert.ok(headers[CONTENT_OS_TIMESTAMP_HEADER]);
  assert.equal(headers[CONTENT_OS_ACTOR_PROVIDER_HEADER], "CONTENT_OS_TELEGRAM_SESSION");
  assert.equal(headers[CONTENT_OS_ACTOR_SUBJECT_HEADER], SUBJECT);
  assert.match(headers[CONTENT_OS_SIGNATURE_HEADER], /^[0-9a-f]{64}$/);
  assert.equal(headers.cookie, undefined);
  for (const value of Object.values(headers)) {
    assert.doesNotMatch(String(value), new RegExp(SECRET));
  }
});

test("read() unwraps the nested `task` field and maps a 404 to null", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: RAW_TASK } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
  const task = await client.read(RAW_TASK.id);
  await closeServer(server);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}`);
  assert.equal(task.status, "ASSIGNED");
});

test("read() maps a 404 to null", async () => {
  const { server, baseUrl } = await startMockServer(() => ({ status: 404, body: { error: "Task not found.", code: "NOT_FOUND" } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
  const task = await client.read("00000000-0000-0000-0000-000000000000");
  await closeServer(server);
  assert.equal(task, null);
});

test("accept()/submitForReview()/requestRevision() send the expected action verbs", async () => {
  for (const [method, expectedAction, extraArgs] of [
    ["accept", "ACCEPT", []],
    ["submitForReview", "SUBMIT_REVIEW", []],
    ["requestRevision", "REQUEST_REVISION", ["needs another pass"]],
  ]) {
    const { server, requests, baseUrl } = await startMockServer(() => ({ status: 200, body: { task: RAW_TASK } }));
    const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
    await client[method](RAW_TASK.id, "actor", ...extraArgs);
    await closeServer(server);
    assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}/actions`);
    assert.equal(requests[0].body.action, expectedAction);
  }
});

test("requestDeadlineChange() POSTs exactly requestedDeadline+reason", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 201, body: { deadlineRequest: { id: "dr-1" } } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
  await client.requestDeadlineChange({ taskId: RAW_TASK.id, requestedBy: "ignored", requestedDeadline: "2026-10-05T09:00:00.000Z", reason: "date moved" });
  await closeServer(server);
  assert.equal(requests[0].url, `/api/tasks/${RAW_TASK.id}/deadline-requests`);
  assert.deepEqual(requests[0].body, { requestedDeadline: "2026-10-05T09:00:00.000Z", reason: "date moved" });
});

test("team-task list query signs only the pathname, matching Task Bot verification", async () => {
  const calls = [];
  const now = () => new Date("2026-10-15T12:00:00.000Z");
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return Response.json({ tasks: [RAW_TASK] });
  };
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE("https://tasks.example.test"), SUBJECT, fetchImpl, now);
  const tasks = await client.listTasks("all");
  assert.equal(tasks.length, 1);
  assert.equal(calls[0].input, "https://tasks.example.test/api/tasks?scope=all");
  const expected = signTaskBackendRequest(
    { method: "GET", path: "/api/tasks", bodyText: "", externalSubject: SUBJECT },
    SECRET,
    now,
  );
  assert.equal(new Headers(calls[0].init.headers).get(CONTENT_OS_SIGNATURE_HEADER), expected[CONTENT_OS_SIGNATURE_HEADER]);
});

test("the complete team-management client surface maps to Task Bot's canonical routes and payloads", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/api/users") return Response.json({ users: [] });
    if (url.pathname === "/api/requests") return Response.json({ deadlineRequests: [], reassignRequests: [] });
    if (url.pathname.endsWith("/reassign-requests") || url.pathname.startsWith("/api/reassign-requests/")) {
      return Response.json({ reassignRequest: { id: "reassign-request" } });
    }
    if (url.pathname.endsWith("/deadline-requests") || url.pathname.startsWith("/api/deadline-requests/")) {
      return Response.json({ deadlineRequest: { id: "deadline-request" } });
    }
    if (url.pathname.endsWith("/archive")) return Response.json({ archive: { taskId: RAW_TASK.id } });
    if (init.method === "GET" && url.pathname === `/api/tasks/${RAW_TASK.id}`) {
      return Response.json({ task: RAW_TASK, archive: null, events: [], deadlineRequests: [], reassignRequests: [] });
    }
    return Response.json({ task: RAW_TASK });
  };
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE("https://tasks.example.test"), SUBJECT, fetchImpl);

  await client.getDetails(RAW_TASK.id);
  await client.listUsers();
  await client.listChangeRequests("PENDING");
  await client.editTask(RAW_TASK.id, { title: "Edited", description: null, priority: "high" });
  await client.directReassign(RAW_TASK.id, RAW_TASK.assigneeId);
  await client.directDeadline(RAW_TASK.id, "2026-11-01T09:00:00.000Z");
  await client.requestReassign(RAW_TASK.id, RAW_TASK.creatorId, "Capacity");
  await client.requestDeadline(RAW_TASK.id, "2026-11-02T09:00:00.000Z", "Dependency");
  await client.resolveReassign("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true, "Approved");
  await client.resolveDeadline("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", false);
  await client.archive(RAW_TASK.id, "No longer needed");
  await client.restore(RAW_TASK.id);
  await client.action(RAW_TASK.id, "CANCEL", "Stopped");

  assert.deepEqual(calls, [
    { method: "GET", path: `/api/tasks/${RAW_TASK.id}`, body: null },
    { method: "GET", path: "/api/users", body: null },
    { method: "GET", path: "/api/requests?status=PENDING", body: null },
    { method: "PATCH", path: `/api/tasks/${RAW_TASK.id}`, body: { title: "Edited", description: null, priority: "high" } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/reassign`, body: { assigneeId: RAW_TASK.assigneeId } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/deadline`, body: { deadline: "2026-11-01T09:00:00.000Z" } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/reassign-requests`, body: { requestedAssigneeId: RAW_TASK.creatorId, reason: "Capacity" } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/deadline-requests`, body: { requestedDeadline: "2026-11-02T09:00:00.000Z", reason: "Dependency" } },
    { method: "POST", path: "/api/reassign-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/resolve", body: { approve: true, resolutionNote: "Approved" } },
    { method: "POST", path: "/api/deadline-requests/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/resolve", body: { approve: false } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/archive`, body: { reason: "No longer needed" } },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/restore`, body: {} },
    { method: "POST", path: `/api/tasks/${RAW_TASK.id}/actions`, body: { action: "CANCEL", reason: "Stopped" } },
  ]);
});

// --- Error mapping: 401/403/409/503 ---

for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [409, "CONFLICT"], [503, "INTEGRATION_UNAVAILABLE"]]) {
  test(`a ${status} response surfaces as TaskBackendHttpError with the bot's code (${code})`, async () => {
    const { server, baseUrl } = await startMockServer(() => ({ status, body: { error: "bot said no", code } }));
    const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
    await assert.rejects(() => client.accept(RAW_TASK.id, "actor"), (error) => {
      assert.ok(error instanceof TaskBackendHttpError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      return true;
    });
    await closeServer(server);
  });
}

// --- getSignedServiceTaskClient(): fails closed before any network attempt ---

test("getSignedServiceTaskClient() throws (not a rejected promise) when service auth is disabled -- no network attempted", () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("must not be called"); };
  try {
    assert.throws(() => getSignedServiceTaskClient({}, SUBJECT), TaskBackendServiceAuthConfigError);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test("getSignedServiceTaskClient() throws when enabled but externalSubject is missing", () => {
  assert.throws(
    () => getSignedServiceTaskClient({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "true", TASK_BACKEND_BASE_URL: "https://tasks.example.com", CONTENT_OS_TASK_BACKEND_SECRET: "s" }, null),
    TaskBackendSignerInputError,
  );
});

test("getSignedServiceTaskClient() succeeds and returns a usable client when fully configured with a subject", () => {
  const client = getSignedServiceTaskClient(
    { TASK_BACKEND_SERVICE_AUTH_ENABLED: "true", TASK_BACKEND_BASE_URL: "https://tasks.example.com", CONTENT_OS_TASK_BACKEND_SECRET: "s" },
    SUBJECT,
  );
  assert.ok(client instanceof SignedServiceTaskClient);
});
