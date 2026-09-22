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
const SUBJECT = "siwc-user-abc123";
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
  assert.equal(headers[CONTENT_OS_ACTOR_PROVIDER_HEADER], "OPENAI_SIWC");
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

// --- Idempotency (documented gap, same as HttpTaskClient's) ---

test("create() has no client-side idempotency key -- two identical calls produce two separate requests", async () => {
  const { server, requests, baseUrl } = await startMockServer(() => ({ status: 201, body: { task: RAW_TASK, assignee: {}, notification: { status: "SENT" } } }));
  const client = new SignedServiceTaskClient(CONFIG_TEMPLATE(baseUrl), SUBJECT);
  const input = { title: "Same task twice", assigneeId: RAW_TASK.assigneeId, creatorId: RAW_TASK.creatorId, deadline: RAW_TASK.deadline, priority: "normal" };
  await client.create(input);
  await client.create(input);
  await closeServer(server);
  assert.equal(requests.length, 2);
});
