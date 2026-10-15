/**
 * Sprint 9C: failure / retry recovery of the persisted Blog review slice, and
 * the server boundary (request handler, config, actor resolution). Faults
 * are injected around the in-memory adapters (which simulate the final Task
 * Bot transition function): "before" fails a call without effect, "after"
 * commits it and then loses the response.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-blog-review-recovery-"));
mkdirSync(join(dir, "persistence"));
symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(dir, "node_modules"), "dir"); // zod for blog-review-api
const compile = (from, to) => writeFileSync(to, ts.transpileModule(readFileSync(new URL(from, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
compile("../lib/content-entity.ts", join(dir, "content-entity.js"));
for (const name of ["task-type-codes", "ports", "idempotency", "transition-contract", "memory-adapter", "supabase-adapter", "blog-review-flow", "config", "blog-review-api"]) {
  compile(`../lib/persistence/${name}.ts`, join(dir, "persistence", `${name}.js`));
}
const require = createRequire(import.meta.url);
const { InMemoryContentOsStore, InMemoryOperationalTaskGateway } = require(join(dir, "persistence", "memory-adapter.js"));
const { BlogReviewFlow } = require(join(dir, "persistence", "blog-review-flow.js"));
const { PersistenceConflictError } = require(join(dir, "persistence", "ports.js"));
const { handleBlogReviewRequest } = require(join(dir, "persistence", "blog-review-api.js"));
const { resolveContentOsPersistenceConfig } = require(join(dir, "persistence", "config.js"));
const { PostgrestClient } = require(join(dir, "persistence", "supabase-adapter.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR = "00000000-0000-4000-8000-0000000000a2";
const REVIEWER = "00000000-0000-4000-8000-0000000000a3";
const OTHER = "00000000-0000-4000-8000-0000000000a4";
const DEADLINE = "2026-10-20T13:00:00.000Z";
const NODE = "11111111-0000-4000-8000-000000000001";

/** Wraps an adapter; `faults.push({ method, when, error? })` fails the next matching call once. */
function faulty(target, faults) {
  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value !== "function") return value;
      return async (...args) => {
        const index = faults.findIndex((f) => f.method === prop && (!f.match || f.match(...args)));
        if (index === -1) return value.apply(obj, args);
        const [fault] = faults.splice(index, 1);
        const error = fault.error ?? new Error(`injected ${fault.when} failure in ${String(prop)}`);
        if (fault.when === "before") throw error;
        await value.apply(obj, args);
        throw error;
      };
    },
  });
}

function world() {
  const store = new InMemoryContentOsStore();
  const tasks = new InMemoryOperationalTaskGateway(store);
  for (const [id, role] of [[HEAD, "HEAD_OF_MARKETING"], [AUTHOR, "CONTENT_MARKETER"], [REVIEWER, "DIGITAL_MARKETER"], [OTHER, "SMM_MANAGER"]]) tasks.addActor({ id, role, isActive: true });
  store.addKnowledgeNode({ id: NODE, problemPartId: "22222222-0000-4000-8000-000000000001", name: "Qaytgan tovar" });
  store.addTaskTypeVersion("BLOG", 1, false);
  store.addTaskTypeVersion("HEAD_REVIEW", 1, false);
  const faults = [];
  const flow = new BlogReviewFlow(faulty(store, faults), faulty(tasks, faults));
  return { store, tasks, faults, flow };
}

const start = (w, key = "req-1") => w.flow.startBlog({ requestKey: key, knowledgeNodeId: NODE, blogTitle: "Blog A", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
const complete = (w, blogTaskId, reviewerId = REVIEWER) => w.flow.completeBlog({ blogTaskId, actorId: AUTHOR, reviewerId, reviewDeadline: DEADLINE });
const counts = (w) => ({ tasks: w.tasks.tasks.size, blogs: w.store.blogs.size, runtimes: w.store.runtimes.size, links: w.store.links.length, revisions: w.tasks.revisions.length });

// --- failure / retry -----------------------------------------------------------

test("F1: Blog completion is ONE Task Bot transaction — a failed completion leaves no DONE Blog without its review; retry converges", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  w.faults.push({ method: "completeBlogWithHeadReview", when: "before" });
  await assert.rejects(() => complete(w, blogTaskId), /injected before failure in completeBlogWithHeadReview/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "IN_PROGRESS", "nothing committed");
  assert.equal(w.tasks.tasks.size, 1, "no orphan Head Review");
  await assert.rejects(() => w.tasks.transition(blogTaskId, AUTHOR, "DONE"), /dedicated Head Review RPC/, "no generic fallback exists");
  const retried = await complete(w, blogTaskId);
  assert.deepEqual([retried.blogStatus, retried.headReviewStatus, retried.headReviewCreated], ["DONE", "IN_PROGRESS", true]);
  assert.equal(w.tasks.tasks.size, 2);
  assert.equal((await w.store.getRuntime(retried.headReviewTaskId)).sourceTaskId, blogTaskId);
});

test("F4: completion response lost after the Task Bot committed Blog DONE + review -> retry (even with another reviewer) returns the SAME review, no second completion", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  w.faults.push({ method: "completeBlogWithHeadReview", when: "after" });
  await assert.rejects(() => complete(w, blogTaskId), /injected after failure/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "DONE");
  const retried = await complete(w, blogTaskId, OTHER);
  assert.equal(retried.headReviewCreated, false);
  assert.equal(w.tasks.tasks.size, 2, "exactly one Blog task and one Head Review task");
  assert.equal(w.tasks.tasks.get(retried.headReviewTaskId).assigneeId, REVIEWER, "the first request's reviewer stands");
  assert.equal(w.tasks.events.filter((e) => e.taskId === blogTaskId && e.eventType === "TASK_COMPLETED").length, 1, "no second completion event");
});

test("F2: revision request retried (after success and after a lost Task Bot response) applies exactly once", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);

  w.faults.push({ method: "transition", when: "after", match: (taskId, _actor, status) => taskId === blogTaskId && status === "REVISION" });
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" }), /injected after failure/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "REVISION");
  assert.equal((await w.tasks.getTask(reviewTaskId)).status, "BLOCKED", "coupled atomically by the Task Bot");
  assert.equal((await w.store.getRuntime(reviewTaskId)).fieldValues["review-decision"], undefined, "decision not yet written");

  const before = counts(w);
  const first = await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  const second = await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  assert.deepEqual(first, second);
  assert.deepEqual([first.blogStatus, first.headReviewStatus, first.decision], ["REVISION", "BLOCKED", "Revision requested"]);
  assert.deepEqual(counts(w), before, "retries changed no task, revision row or link");
  assert.equal(w.tasks.transitions.filter((t) => t.to === "REVISION").length, 1);
});

test("F6: the Content OS decision write fails after the Task Bot transition -> reconcile (or a retry) restores it", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  w.faults.push({ method: "mergeFieldValues", when: "before" });
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" }), /injected before failure in mergeFieldValues/);
  assert.deepEqual([(await w.tasks.getTask(blogTaskId)).status, (await w.tasks.getTask(reviewTaskId)).status], ["REVISION", "BLOCKED"]);

  const reconciled = await w.flow.reconcile(blogTaskId);
  assert.deepEqual(reconciled.actions, ["decision ∅ -> Revision requested"]);
  assert.equal(reconciled.decision, "Revision requested");
  assert.deepEqual((await w.flow.reconcile(blogTaskId)).actions, [], "reconcile is idempotent");
});

test("F3: Blog resubmitted twice -> SAME Head Review ASSIGNED once, decision cleared, no new task", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  const before = counts(w);
  const first = await complete(w, blogTaskId);
  const second = await complete(w, blogTaskId);
  assert.deepEqual(first, second);
  assert.deepEqual([first.blogStatus, first.headReviewStatus, first.decision, first.headReviewCreated], ["DONE", "ASSIGNED", null, false]);
  assert.deepEqual(counts(w), before);
  assert.deepEqual(w.tasks.transitions.filter((t) => t.taskId === reviewTaskId).map((t) => `${t.from}->${t.to}`), ["IN_PROGRESS->BLOCKED", "BLOCKED->ASSIGNED"]);
});

test("F3b: resubmission's decision clear fails -> reconcile clears it; the Task Bot state is already correct", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  w.faults.push({ method: "mergeFieldValues", when: "before" });
  await assert.rejects(() => complete(w, blogTaskId), /mergeFieldValues/);
  assert.deepEqual([(await w.tasks.getTask(blogTaskId)).status, (await w.tasks.getTask(reviewTaskId)).status], ["DONE", "ASSIGNED"]);
  const reconciled = await w.flow.reconcile(blogTaskId);
  assert.deepEqual(reconciled.actions, ["decision Revision requested -> ∅"]);
});

test("F5: a link insert conflict (ignore-duplicates read-back) surfaces, creates nothing twice, and a retry converges", async () => {
  const w = world();
  w.faults.push({ method: "ensureLinks", when: "after", error: new PersistenceConflictError("link BLOG:x (PRIMARY) was not stored") });
  await assert.rejects(() => start(w), /was not stored/);
  const retried = await start(w);
  assert.equal(retried.created, false);
  assert.deepEqual(counts(w), { tasks: 1, blogs: 1, runtimes: 1, links: 2, revisions: 0 });
});

test("the coupled Task Bot change is all-or-nothing: if the parked review is not BLOCKED the Blog stays in REVISION", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  w.tasks.tasks.set(reviewTaskId, { ...w.tasks.tasks.get(reviewTaskId), status: "IN_PROGRESS" }); // out-of-band tamper
  // Content OS refuses before sending (a refused Task Bot transition is 40001, which PostgREST retries without limit)...
  const sent = w.tasks.transitions.length;
  await assert.rejects(() => complete(w, blogTaskId), /not waiting for this Blog \(IN_PROGRESS\)/);
  assert.equal(w.tasks.transitions.length, sent, "no transition was sent");
  // ...and the Task Bot itself would refuse it atomically anyway.
  await assert.rejects(() => w.tasks.completeBlogWithHeadReview({ blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE, reviewTitle: "HR", reviewRequestHash: "a".repeat(64) }), /Head Review state changed concurrently/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "REVISION", "nothing half-applied");
});

test("reconcile reports a missing Head Review without inventing one", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  // Legacy data only (pre-10D): today no path can produce a DONE Blog without its review.
  w.tasks.tasks.set(blogTaskId, { ...w.tasks.tasks.get(blogTaskId), status: "DONE" });
  const result = await w.flow.reconcile(blogTaskId);
  assert.equal(result.headReviewTaskId, null);
  assert.match(result.actions[0], /HEAD_REVIEW_MISSING/);
  assert.equal(w.tasks.tasks.size, 1);
});

test("concurrency: a stale decision write cannot gate anything; reconcile re-derives it from Task Bot state", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Fix intro" });
  // A late write lands out of order (e.g. a delayed retry): the field says "cleared" while the Blog is in REVISION.
  await w.store.mergeFieldValues(reviewTaskId, { "review-decision": null });
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: REVIEWER }), /a BLOCKED Head Review cannot be approved/, "gating uses Task Bot state, not the field");
  assert.equal((await w.flow.reconcile(blogTaskId)).decision, "Revision requested");
});

// --- server boundary ----------------------------------------------------------------

function apiWorld() {
  const w = world();
  return { ...w, deps: { flow: w.flow } };
}

test("API: fail closed (503 not configured, 401 anonymous) and never takes the actor from the body", async () => {
  const { deps } = apiWorld();
  const body = { action: "start", requestKey: "k", knowledgeNodeId: NODE, blogTitle: "B", assigneeId: AUTHOR, deadline: DEADLINE };
  assert.equal((await handleBlogReviewRequest({ body, actorId: AUTHOR }, null)).status, 503);
  assert.equal((await handleBlogReviewRequest({ body, actorId: null }, deps)).status, 401);
  const forged = await handleBlogReviewRequest({ body: { ...body, actorId: HEAD }, actorId: AUTHOR }, deps);
  assert.equal(forged.status, 400, "unknown keys (e.g. actorId) are rejected by the strict schema");
  assert.equal((await handleBlogReviewRequest({ body: { action: "nope" }, actorId: AUTHOR }, deps)).status, 400);
});

test("API: the full slice through the handler with session actors", async () => {
  const w = apiWorld();
  const call = (body, actorId) => handleBlogReviewRequest({ body, actorId }, w.deps);
  const started = await call({ action: "start", requestKey: "api-1", knowledgeNodeId: NODE, blogTitle: "Blog via API", assigneeId: AUTHOR, deadline: DEADLINE }, AUTHOR);
  assert.equal(started.status, 200);
  assert.equal(w.tasks.tasks.get(started.body.blogTaskId).creatorId, AUTHOR, "creator = the resolved actor");
  const completed = await call({ action: "complete", blogTaskId: started.body.blogTaskId, reviewerId: REVIEWER, reviewDeadline: DEADLINE }, AUTHOR);
  assert.equal(completed.status, 200);
  const revision = await call({ action: "request-revision", reviewTaskId: completed.body.headReviewTaskId, note: "Fix" }, REVIEWER);
  assert.deepEqual([revision.status, revision.body.blogStatus, revision.body.headReviewStatus], [200, "REVISION", "BLOCKED"]);
  const denied = await call({ action: "request-revision", reviewTaskId: completed.body.headReviewTaskId, note: "Fix" }, AUTHOR);
  assert.equal(denied.status, 409, "the Blog author cannot decide the review");
  const resubmitted = await call({ action: "complete", blogTaskId: started.body.blogTaskId, reviewerId: REVIEWER, reviewDeadline: DEADLINE }, AUTHOR);
  assert.equal(resubmitted.body.headReviewStatus, "ASSIGNED");
  const approved = await call({ action: "approve", reviewTaskId: completed.body.headReviewTaskId }, REVIEWER);
  assert.deepEqual([approved.status, approved.body.headReviewStatus, approved.body.decision], [200, "DONE", "Approved"]);
  const reconciled = await call({ action: "reconcile", blogTaskId: started.body.blogTaskId }, AUTHOR);
  assert.deepEqual(reconciled.body.actions, []);
});

test("API: Task Bot refusals map to 403 / 409 without leaking internals", async () => {
  const w = apiWorld();
  const { blogTaskId } = await start(w);
  const failing = { flow: { completeBlog: async () => { const e = new Error("x"); e.sqlState = "42501"; throw e; } } };
  const res = await handleBlogReviewRequest({ body: { action: "complete", blogTaskId, reviewerId: REVIEWER, reviewDeadline: DEADLINE }, actorId: AUTHOR }, failing);
  assert.deepEqual([res.status, res.body.code], [403, "FORBIDDEN"]);
});

test("config: disabled by default; explicit and complete or it throws; https only", () => {
  assert.equal(resolveContentOsPersistenceConfig({}), null);
  assert.equal(resolveContentOsPersistenceConfig({ CONTENT_OS_PERSISTENCE_ENABLED: "false" }), null);
  assert.throws(() => resolveContentOsPersistenceConfig({ CONTENT_OS_PERSISTENCE_ENABLED: "yes" }), /not recognized/);
  assert.throws(() => resolveContentOsPersistenceConfig({ CONTENT_OS_PERSISTENCE_ENABLED: "true" }), /CONTENT_OS_SUPABASE_URL, CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY are missing/);
  const base = { CONTENT_OS_PERSISTENCE_ENABLED: "true", CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.throws(() => resolveContentOsPersistenceConfig({ ...base, CONTENT_OS_SUPABASE_URL: "http://x" }), /https/);
  const full = { ...base, CONTENT_OS_SUPABASE_URL: "https://x.supabase.co" };
  assert.deepEqual(resolveContentOsPersistenceConfig(full), { supabaseUrl: "https://x.supabase.co", serviceRoleKey: "k" });
});

test("10D: the Sites/SIWC identity path is gone — forged oai-authenticated-* headers cannot reach any actor", () => {
  for (const removed of ["../app/chatgpt-auth.ts", "../lib/persistence/actor-resolver.ts", "../build/sites-vite-plugin.ts"]) {
    assert.throws(() => readFileSync(new URL(removed, import.meta.url)), /ENOENT/, removed);
  }
  const sources = readdirSync(new URL("../", import.meta.url), { recursive: true })
    .filter((f) => /^(app|lib|components)\//.test(f) && /\.(tsx?|mjs)$/.test(f));
  for (const file of sources) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), /oai-authenticated|getChatGPTUser|OPENAI_SIWC|CONTENT_OS_IDENTITY_TRUST|actor-resolver/, file);
  }
});

test("server/client boundary: only the route touches env; no client code can reach persistence or the service-role key", () => {
  const route = readFileSync(new URL("../app/api/content-os/blog-review/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /"use client"/);
  assert.match(route, /resolveContentOsPersistenceConfig\(process\.env\)/);
  for (const file of readdirSync(new URL("../lib/persistence/", import.meta.url))) {
    assert.doesNotMatch(readFileSync(new URL(`../lib/persistence/${file}`, import.meta.url), "utf8"), /process\.env|NEXT_PUBLIC_[A-Z]|"use client"/, file);
  }
  const clientFiles = readdirSync(new URL("../components/", import.meta.url), { recursive: true }).filter((f) => /\.(tsx?|jsx?)$/.test(f));
  for (const file of clientFiles) {
    const source = readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /lib\/persistence|SERVICE_ROLE|service_role/, file); // calling the session-authenticated HTTP route is fine
  }
  const anyPublicSecret = readdirSync(new URL("../", import.meta.url), { recursive: true })
    .filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.includes("node_modules") && !f.startsWith("dist") && !f.startsWith(".next"))
    .some((f) => /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  assert.equal(anyPublicSecret, false, "no NEXT_PUBLIC_* service-role variable anywhere");
});

// --- Sprint 9D: refuse-before-send, transport classification, structured logs ----------------

test("9D: transitions the Task Bot would refuse (40001 under PostgREST = unbounded retry) are refused before sending", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  await assert.rejects(() => w.flow.completeBlog({ blogTaskId, actorId: REVIEWER, reviewerId: REVIEWER, reviewDeadline: DEADLINE }), /only the Blog assignee/);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  w.tasks.tasks.set(reviewTaskId, { ...w.tasks.tasks.get(reviewTaskId), status: "CANCELLED" });
  const sent = w.tasks.transitions.length;
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: REVIEWER }), /a CANCELLED Head Review cannot be approved/);
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "x" }), /may not send this Blog back/);
  w.tasks.tasks.set(reviewTaskId, { ...w.tasks.tasks.get(reviewTaskId), status: "BLOCKED" });
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: REVIEWER }), /a BLOCKED Head Review cannot be approved/);
  w.tasks.tasks.set(reviewTaskId, { ...w.tasks.tasks.get(reviewTaskId), status: "ASSIGNED" });
  w.tasks.tasks.set(blogTaskId, { ...w.tasks.tasks.get(blogTaskId), status: "REVISION" });
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: REVIEWER }), /only while its source Blog is DONE/);
  assert.equal(w.tasks.tasks.get(reviewTaskId).status, "ASSIGNED", "the review was not accepted before the refusal");
  assert.equal(w.tasks.transitions.length, sent, "nothing was sent");
});

test("9D: PostgREST transport failures are classified (no URL / key in the error)", async () => {
  const { PersistenceTransportError } = require(join(dir, "persistence", "supabase-adapter.js"));
  const client = (fetch) => new PostgrestClient({ baseUrl: "https://x.supabase.co", serviceRoleKey: "secret-key-value", fetch });
  const reply = (status, text) => async () => ({ ok: status < 400, status, text: async () => text });
  const timeout = async () => { const e = new Error("aborted"); e.name = "TimeoutError"; throw e; };
  for (const [fetch, status] of [[timeout, null], [reply(502, "<html>bad gateway</html>"), 502], [reply(503, ""), 503]]) {
    await assert.rejects(() => client(fetch).select("tasks", "id", {}), (e) => e instanceof PersistenceTransportError && e.status === status && !/secret-key-value|supabase\.co/.test(e.message));
  }
  await assert.rejects(() => client(reply(500, JSON.stringify({ code: "40001", message: "m" }))).select("tasks", "id", {}), (e) => e.name === "PostgrestError" && e.pgCode === "40001");
});

test("9D: one structured log record per request, classified, without subject or body", async () => {
  const { PersistenceTransportError } = require(join(dir, "persistence", "supabase-adapter.js"));
  const w = apiWorld();
  const records = [];
  const log = (r) => records.push(r);
  const call = (body, actorId, deps = w.deps) => handleBlogReviewRequest({ body, actorId }, deps, log);
  await call({ action: "reconcile", blogTaskId: NODE }, null);
  await call({ action: "nope" }, AUTHOR);
  const started = await call({ action: "start", requestKey: "log-1", knowledgeNodeId: NODE, blogTitle: "Secret title", assigneeId: AUTHOR, deadline: DEADLINE }, AUTHOR);
  await call({ action: "start", requestKey: "log-1", knowledgeNodeId: NODE, blogTitle: "Secret title", assigneeId: AUTHOR, deadline: DEADLINE }, AUTHOR);
  await call({ action: "approve", reviewTaskId: started.body.blogTaskId }, REVIEWER);
  const down = { flow: { reconcile: async () => { throw new PersistenceTransportError(null, "TimeoutError"); } } };
  const res = await call({ action: "reconcile", blogTaskId: NODE }, AUTHOR, down);
  assert.deepEqual([res.status, res.body.retryable], [503, true]);
  const rejected = { flow: { reconcile: async () => { const e = new Error("x"); e.pgCode = "42501"; throw e; } } };
  await call({ action: "reconcile", blogTaskId: NODE }, AUTHOR, rejected);
  assert.deepEqual(records.map((r) => r.outcome), ["unauthenticated", "invalid_input", "ok", "ok", "content_os_rule", "transport_failure", "task_bot_rejected"]);
  assert.deepEqual(records.slice(2, 4).map((r) => r.created), [true, false], "idempotent replay is visible");
  assert.equal(records[6].sqlState, "42501");
  assert.doesNotMatch(JSON.stringify(records), /Secret title/);
});

// --- Sprint 10D: Head Review independence + Blog completion invariant -------------------------------

test("10D: the Blog author cannot name themselves reviewer — refused BEFORE the Blog moves (no DONE Blog without a review)", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  await assert.rejects(() => complete(w, blogTaskId, AUTHOR), /author cannot review their own Blog/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "IN_PROGRESS", "pre-10D this produced a DONE Blog reviewed by its own author");
  assert.equal(w.tasks.tasks.size, 1, "no Head Review was created");
  w.tasks.addActor({ id: "00000000-0000-4000-8000-0000000000a9", role: "SMM_MANAGER", isActive: false });
  await assert.rejects(() => complete(w, blogTaskId, "00000000-0000-4000-8000-0000000000a9"), /active team member/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "IN_PROGRESS");
  const done = await complete(w, blogTaskId);
  assert.deepEqual([done.blogStatus, done.headReviewStatus, done.headReviewCreated], ["DONE", "IN_PROGRESS", true]);
  assert.equal((await complete(w, blogTaskId)).headReviewTaskId, done.headReviewTaskId, "retry: same Blog, same Head Review");
});

test("10D/10E: the Task Bot records the completing author as the review's creator — and that grants the author nothing", async () => {
  const w = world();
  const { blogTaskId } = await start(w);
  const { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  assert.equal(w.tasks.tasks.get(reviewTaskId).creatorId, AUTHOR, "content_os_complete_blog_with_head_review uses p_actor_id as creator");
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: AUTHOR, note: "x" }), /author cannot decide its Head Review/);
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: AUTHOR }), /author cannot decide its Head Review/);
});

test("10D: when Head writes the Blog, Head cannot decide its review (independence beats role)", async () => {
  const w = world();
  const { blogTaskId } = await w.flow.startBlog({ requestKey: "head-blog", knowledgeNodeId: NODE, blogTitle: "Head's blog", creatorId: HEAD, assigneeId: HEAD, deadline: DEADLINE });
  const { headReviewTaskId: reviewTaskId } = await w.flow.completeBlog({ blogTaskId, actorId: HEAD, reviewerId: REVIEWER, reviewDeadline: DEADLINE });
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: HEAD, note: "x" }), /author cannot decide its Head Review/);
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: HEAD }), /author cannot decide its Head Review/);
  assert.equal((await w.flow.approve({ reviewTaskId, actorId: REVIEWER })).headReviewStatus, "DONE", "the independent reviewer still approves");
});

test("10D: Task Bot PT409 business conflicts map to HTTP 409, never 500", async () => {
  const w = apiWorld();
  const { blogTaskId } = await start(w);
  for (const shape of [{ pgCode: "PT409" }, { sqlState: "PT409" }]) {
    const flow = { completeBlog: async () => { throw Object.assign(new Error("archived task must be restored before mutation"), shape); } };
    const res = await handleBlogReviewRequest({ body: { action: "complete", blogTaskId, reviewerId: REVIEWER, reviewDeadline: DEADLINE }, actorId: AUTHOR }, { flow });
    assert.deepEqual([res.status, res.body.code], [409, "CONFLICT"]);
  }
});

test("10E: the whole Blog lifecycle never sends a generic Blog DONE — completion and resubmission use only the dedicated RPC", async () => {
  const w = world();
  const sent = [];
  const spy = new Proxy(w.tasks, { get(target, prop) {
    const value = target[prop];
    if (typeof value !== "function") return value;
    return (...args) => { sent.push([prop, ...args]); return value.apply(target, args); };
  } });
  const flow = new BlogReviewFlow(w.store, spy);
  const { blogTaskId } = await flow.startBlog({ requestKey: "spy", knowledgeNodeId: NODE, blogTitle: "Spy", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  const done = await flow.completeBlog({ blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE });
  await flow.requestRevision({ reviewTaskId: done.headReviewTaskId, actorId: REVIEWER, note: "Fix" });
  await flow.completeBlog({ blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE });
  await flow.approve({ reviewTaskId: done.headReviewTaskId, actorId: REVIEWER });
  assert.equal(sent.filter(([m, id, , status]) => m === "transition" && id === blogTaskId && status === "DONE").length, 0, "no generic Blog DONE");
  assert.equal(sent.filter(([m]) => m === "completeBlogWithHeadReview").length, 2, "first completion + resubmission");
  assert.equal(sent.filter(([m, input]) => m === "createTaskIdempotent" && input.idempotencyKey.startsWith("head-review:")).length, 0, "Content OS never creates the review itself");
});

// --- Sprint 10E-FIX: final owner decision at the workflow layer ---------------------------------

test("10E review matrix (BlogReviewFlow): assigned reviewer approves; Head approves only when assigned; authors never decide", async () => {
  // Ordinary author.
  let w = world();
  let { blogTaskId } = await start(w);
  let { headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId);
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: AUTHOR }), /author cannot decide/);
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: AUTHOR, note: "x" }), /author cannot decide/);
  // Head, not author, not assigned: supervisory revision allowed, approval refused.
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: HEAD }), /only the Head Review assignee/);
  const revised = await w.flow.requestRevision({ reviewTaskId, actorId: HEAD, note: "Supervisory: tighten the intro" });
  assert.deepEqual([revised.blogStatus, revised.headReviewStatus], ["REVISION", "BLOCKED"]);
  await complete(w, blogTaskId);
  // Assigned reviewer approves.
  assert.equal((await w.flow.approve({ reviewTaskId, actorId: REVIEWER })).headReviewStatus, "DONE");

  // Head who is the CURRENT assignee (not author) may approve.
  w = world();
  ({ blogTaskId } = await start(w, "head-assigned"));
  ({ headReviewTaskId: reviewTaskId } = await complete(w, blogTaskId, HEAD));
  assert.equal((await w.flow.approve({ reviewTaskId, actorId: HEAD })).headReviewStatus, "DONE");

  // Head-author: cannot be reviewer, cannot approve, cannot request revision.
  w = world();
  ({ blogTaskId } = await w.flow.startBlog({ requestKey: "head-author", knowledgeNodeId: NODE, blogTitle: "Head's own", creatorId: HEAD, assigneeId: HEAD, deadline: DEADLINE }));
  await assert.rejects(() => w.flow.completeBlog({ blogTaskId, actorId: HEAD, reviewerId: HEAD, reviewDeadline: DEADLINE }), /author cannot review their own Blog/, "reviewer != author even for Head");
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "IN_PROGRESS");
  ({ headReviewTaskId: reviewTaskId } = await w.flow.completeBlog({ blogTaskId, actorId: HEAD, reviewerId: REVIEWER, reviewDeadline: DEADLINE }));
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: HEAD }), /author cannot decide/);
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: HEAD, note: "x" }), /author cannot decide/);
  assert.equal((await w.flow.approve({ reviewTaskId, actorId: REVIEWER })).headReviewStatus, "DONE", "the independent reviewer decides");
});
