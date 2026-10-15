/**
 * Sprint 9B: Content OS persistence adapter foundation (ports, contract,
 * adapters). Uses the in-memory adapters (same invariants as the schema)
 * and a recording fake fetch for the PostgREST adapter. No network, no
 * credentials, no database.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-persistence-adapter-"));
mkdirSync(join(dir, "persistence"));
const compile = (from, to) => writeFileSync(to, ts.transpileModule(readFileSync(new URL(from, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
for (const name of ["content-entity", "task-type", "task-type-fixtures"]) compile(`../lib/${name}.ts`, join(dir, `${name}.js`));
for (const name of ["task-type-codes", "ports", "idempotency", "transition-contract", "memory-adapter", "supabase-adapter", "blog-review-flow", "config", "blog-review-api", "index"]) {
  compile(`../lib/persistence/${name}.ts`, join(dir, "persistence", `${name}.js`));
}
const require = createRequire(import.meta.url);
const codes = require(join(dir, "persistence", "task-type-codes.js"));
const idem = require(join(dir, "persistence", "idempotency.js"));
const contract = require(join(dir, "persistence", "transition-contract.js"));
const { InMemoryContentOsStore, InMemoryOperationalTaskGateway } = require(join(dir, "persistence", "memory-adapter.js"));
const { PostgrestClient, SupabaseContentOsStore, SupabaseOperationalTaskGateway } = require(join(dir, "persistence", "supabase-adapter.js"));
const { getContentOsPersistence } = require(join(dir, "persistence", "index.js"));
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR = "00000000-0000-4000-8000-0000000000a2";
const REVIEWER = "00000000-0000-4000-8000-0000000000a3";
const OTHER = "00000000-0000-4000-8000-0000000000a4";
const DEADLINE = "2026-10-20T13:00:00.000Z";

function world() {
  const store = new InMemoryContentOsStore();
  const tasks = new InMemoryOperationalTaskGateway(store);
  tasks.addActor({ id: HEAD, role: "HEAD_OF_MARKETING", isActive: true });
  tasks.addActor({ id: AUTHOR, role: "CONTENT_MARKETER", isActive: true });
  tasks.addActor({ id: REVIEWER, role: "DIGITAL_MARKETER", isActive: true });
  tasks.addActor({ id: OTHER, role: "SMM_MANAGER", isActive: true });
  const node = store.addKnowledgeNode({ id: "11111111-0000-4000-8000-000000000001", problemPartId: "22222222-0000-4000-8000-000000000001", name: "Qaytgan tovar" });
  const versions = {
    blog: store.addTaskTypeVersion("BLOG", 1, false),
    headReview: store.addTaskTypeVersion("HEAD_REVIEW", 1, false),
    seo: store.addTaskTypeVersion("SEO", 1, false),
    research: store.addTaskTypeVersion("RESEARCH", 1, false),
  };
  return { store, tasks, node, versions };
}

// --- stable codes ---------------------------------------------------------------
test("every Task Type fixture has exactly one unique stable code; BLOG and HEAD_REVIEW match the SQL contract", () => {
  const byName = codes.TASK_TYPE_CODE_BY_FIXTURE_NAME;
  assert.deepEqual(TASK_TYPE_FIXTURES.map((t) => t.name).sort(), Object.keys(byName).sort());
  const values = Object.values(byName);
  assert.equal(new Set(values).size, values.length);
  for (const code of values) assert.match(code, codes.TASK_TYPE_CODE_PATTERN);
  assert.equal(codes.BLOG_TASK_TYPE_CODE, "BLOG");
  assert.equal(codes.HEAD_REVIEW_TASK_TYPE_CODE, "HEAD_REVIEW");
});

// --- requires_review --------------------------------------------------------------

test("requiresReview: pinned step override (boolean) ?? pinned version; malformed fails safe to true", () => {
  const plain = { reviewRequired: false };
  const reviewed = { reviewRequired: true };
  assert.equal(contract.requiresReview(plain, null), false);
  assert.equal(contract.requiresReview(reviewed, null), true);
  assert.equal(contract.requiresReview(plain, { overrides: {} }), false);
  assert.equal(contract.requiresReview(plain, { overrides: { reviewRequired: null } }), false, "JSON null behaves like ?? (fallback)");
  assert.equal(contract.requiresReview(plain, { overrides: { reviewRequired: true } }), true);
  assert.equal(contract.requiresReview(reviewed, { overrides: { reviewRequired: false } }), false);
  for (const malformed of ["no", "false", 0, 1, [], {}]) {
    assert.equal(contract.requiresReview(plain, { overrides: { reviewRequired: malformed } }), true, `malformed ${JSON.stringify(malformed)}`);
  }
  assert.equal(contract.requiresReview(plain, { overrides: "not-an-object" }), true);
});

// --- vertical slice -------------------------------------------------------------------

test("legacy (non-Content OS) tasks keep the legacy matrix in the simulated Task Bot", async () => {
  const w = world();
  const { taskId } = await w.tasks.createTaskIdempotent({ purpose: "CREATE_TASK", idempotencyKey: "legacy", requestHash: "1".repeat(64), creatorId: HEAD, assigneeId: AUTHOR, title: "Telegram task", description: "", priority: "normal", deadline: DEADLINE });
  await assert.rejects(() => w.tasks.transition(taskId, AUTHOR, "DONE"), /changed concurrently/);
  await w.tasks.transition(taskId, AUTHOR, "REVIEW");
  await w.tasks.transition(taskId, HEAD, "DONE");
  await assert.rejects(() => w.tasks.transition(taskId, HEAD, "REVISION"), /changed concurrently/);
});

test("request hash is canonical; deterministic ids are RFC 4122 v5; the #posting tag is neutralized", () => {
  assert.equal(idem.requestHash({ a: 1, b: { c: 2, d: [1, 2] } }), idem.requestHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.match(idem.requestHash({ a: 1 }), /^[0-9a-f]{64}$/);
  assert.notEqual(idem.requestHash({ a: 1 }), idem.requestHash({ a: 2 }));
  const id = idem.deterministicUuid("blog-entity:req-1");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, idem.deterministicUuid("blog-entity:req-1"));
  assert.notEqual(id, idem.deterministicUuid("blog-entity:req-2"));
  // JS equivalent of the Task Bot's ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)'
  const tagRegex = /(^|[^A-Za-z0-9_])#posting([^A-Za-z0-9_]|$)/i;
  for (const title of ["Why #posting matters", "#posting", "Reel #POSTING tips", "a #posting."]) {
    const safe = idem.neutralizePostingTag(title);
    assert.equal(tagRegex.test(safe), false, title);
  }
  assert.equal(idem.neutralizePostingTag("#postings and #post"), "#postings and #post", "only the exact tag is touched");
});

// --- PostgREST adapter (fake fetch) -------------------------------------------------------

function recordingFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 200, body: [] };
    return { ok: next.status < 300, status: next.status, text: async () => (next.body === undefined ? "" : JSON.stringify(next.body)) };
  };
  return { fetch, calls };
}

test("Supabase adapter: runtime keyed by public.tasks.id, insert-if-absent, links PRIMARY/RELATED, no tasks.content_ref", async () => {
  const runtimeRow = { task_id: "t1", task_type_version_id: "v1", workflow_run_id: null, workflow_template_version_id: null, workflow_step_id: null, source_task_id: "b1", outcome: null, skip_reason: null, field_values: {} };
  const { fetch, calls } = recordingFetch([{ status: 201 }, { status: 200, body: [runtimeRow] }, { status: 201 }, { status: 200, body: [{ task_id: "t1", entity_type: "BLOG", entity_id: "e1", relation: "PRIMARY" }] }]);
  const store = new SupabaseContentOsStore(new PostgrestClient({ baseUrl: "https://example.supabase.co/", serviceRoleKey: "test-key", fetch }));
  const stored = await store.ensureRuntime({ taskId: "t1", taskTypeVersionId: "v1", workflowRunId: null, workflowTemplateVersionId: null, workflowStepId: null, sourceTaskId: "b1", outcome: null, skipReason: null, fieldValues: {} });
  assert.equal(stored.sourceTaskId, "b1");
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/content_task_runtime");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Prefer, "resolution=ignore-duplicates,return=minimal");
  assert.equal(calls[0].headers.apikey, "test-key");
  assert.equal(calls[0].body[0].task_id, "t1");
  assert.match(calls[1].url, /content_task_runtime\?select=.*&task_id=eq\.t1$/);
  await store.ensureLinks([{ taskId: "t1", entityType: "BLOG", entityId: "e1", relation: "PRIMARY" }]);
  assert.deepEqual(calls[2].body, [{ task_id: "t1", entity_type: "BLOG", entity_id: "e1", relation: "PRIMARY" }]);
  assert.ok(calls.every((call) => !JSON.stringify(call).includes("content_ref")));
});

test("Supabase store: a link silently dropped by ignore-duplicates (e.g. a second PRIMARY) is detected", async () => {
  const { fetch } = recordingFetch([{ status: 201 }, { status: 200, body: [{ task_id: "t1", entity_type: "KNOWLEDGE_NODE", entity_id: "n1", relation: "PRIMARY" }] }]);
  const store = new SupabaseContentOsStore(new PostgrestClient({ baseUrl: "https://example.supabase.co", serviceRoleKey: "test-key", fetch }));
  await assert.rejects(() => store.ensureLinks([{ taskId: "t1", entityType: "BLOG", entityId: "e1", relation: "PRIMARY" }]), /was not stored/);
});

test("Supabase gateway: tasks only via the idempotent RPC and transition_task_with_events; Postgres errors surface", async () => {
  const { fetch, calls } = recordingFetch([
    { status: 200, body: [{ task_id: "t9", created: true }] },
    { status: 200, body: { id: "t9", status: "DONE", assignee_id: "a", creator_id: "c" } },
    { status: 409, body: { code: "23505", message: "IDEMPOTENCY_KEY_REUSED: CREATE_TASK key k" } },
  ]);
  const gateway = new SupabaseOperationalTaskGateway(new PostgrestClient({ baseUrl: "https://example.supabase.co", serviceRoleKey: "test-key", fetch }));
  const created = await gateway.createTaskIdempotent({ purpose: "CREATE_TASK", idempotencyKey: "k", requestHash: "a".repeat(64), creatorId: "c", assigneeId: "a", title: "Blog — X", description: "", priority: "normal", deadline: DEADLINE });
  assert.deepEqual(created, { taskId: "t9", created: true });
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/content_os_create_task_idempotent");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["p_assignee_id", "p_creator_id", "p_deadline", "p_description", "p_idempotency_key", "p_priority", "p_purpose", "p_request_hash", "p_title"]);
  const moved = await gateway.transition("t9", "a", "DONE");
  assert.equal(moved.status, "DONE");
  assert.equal(calls[1].url, "https://example.supabase.co/rest/v1/rpc/transition_task_with_events");
  assert.deepEqual(calls[1].body, { p_task_id: "t9", p_actor_id: "a", p_new_status: "DONE", p_reason: null });
  await assert.rejects(() => gateway.createTaskIdempotent({ purpose: "CREATE_TASK", idempotencyKey: "k", requestHash: "b".repeat(64), creatorId: "c", assigneeId: "a", title: "x", description: "", priority: "normal", deadline: DEADLINE }),
    (error) => error.name === "PostgrestError" && error.pgCode === "23505");
  assert.ok(!calls.some((call) => call.method !== "GET" && /\/rest\/v1\/(tasks|users)\b/.test(call.url)), "public.tasks / public.users are never written directly");
});

test("the default composition is fail-closed (no env, no network)", async () => {
  const persistence = getContentOsPersistence();
  await assert.rejects(() => persistence.store.getRuntime("t"), /not configured/);
  await assert.rejects(() => persistence.tasks.createTaskIdempotent({}), /not configured/);
  assert.throws(() => new PostgrestClient({ baseUrl: "", serviceRoleKey: "", fetch: async () => ({}) }), /explicit baseUrl/);
});

// --- boundaries ------------------------------------------------------------------------

test("boundaries: components never import persistence; persistence never imports React or reads env; no tasks.content_ref", () => {
  const componentFiles = readdirSync(new URL("../components/", import.meta.url), { recursive: true }).filter((f) => /\.(tsx?|jsx?)$/.test(f));
  assert.ok(componentFiles.length > 10);
  for (const file of componentFiles) {
    assert.doesNotMatch(readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8"), /lib\/persistence/, file);
  }
  const persistenceDir = new URL("../lib/persistence/", import.meta.url);
  for (const file of readdirSync(persistenceDir)) {
    const source = readFileSync(new URL(file, persistenceDir), "utf8");
    assert.doesNotMatch(source, /from "react"|process\.env/, file);
    assert.doesNotMatch(source, /content_ref|contentRef/, file);
    assert.doesNotMatch(source, /\.title\s*===|\.name\s*===/, `${file} must not branch on titles or display names`);
  }
});
