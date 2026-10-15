/**
 * LOCAL E2E ONLY (run tests/e2e/setup.sh and `npm run build` first).
 * POST /api/content-os/blog-review through the REAL built Worker (workerd),
 * the real route + handler + adapter, a Supabase-gateway emulator over TLS,
 * real PostgREST 12 and the disposable PostgreSQL 17 database built from the
 * FINAL Task Bot migrations (a9ed78a) + Content OS drafts 00..06.
 * BlogReviewFlow is never called directly; DB state is checked with SQL.
 *
 * The identity header is sent by this test directly to the Worker, which is
 * exactly what the platform dispatcher does — and also what an attacker
 * could do if the Worker were reachable without the dispatcher (see the
 * "identity header is not verified" test).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ids, rows, sql } from "./lib/db.mjs";
import { mintKey, startGateway } from "./lib/gateway.mjs";
import { makeLocalTls, startWorker } from "./lib/worker.mjs";

const UPSTREAM = process.env.PGRST_UPSTREAM ?? "http://172.17.0.2:3000";
const SERVICE = mintKey("service_role");
const DEADLINE = "2026-10-20T13:00:00.000Z";
let tls, gw, worker, bare, unconfirmed;

before(async () => {
  tls = makeLocalTls();
  gw = await startGateway({ upstream: UPSTREAM, apiKeys: [SERVICE], tls: { key: readFileSync(tls.key), cert: readFileSync(tls.cert) } });
  const db = { CONTENT_OS_PERSISTENCE_ENABLED: "true", CONTENT_OS_SUPABASE_URL: gw.url, CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: SERVICE, CONTENT_OS_IDENTITY_TENANT_KEY: "site-e2e" };
  // `worker` simulates a deployment whose trusted ingress the platform owner has confirmed.
  worker = await startWorker({ caFile: tls.ca, vars: { ...db, CONTENT_OS_IDENTITY_TRUST: "OPENAI_SITES_DISPATCH" } });
  bare = await startWorker({});
  unconfirmed = await startWorker({ caFile: tls.ca, vars: db });
});
after(async () => {
  worker?.stop();
  bare?.stop();
  unconfirmed?.stop();
  await gw?.close();
  tls?.cleanup();
});

async function call(body, subject, { base = worker.url, headers = {}, raw = null } = {}) {
  const started = Date.now();
  const response = await fetch(`${base}/api/content-os/blog-review`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(subject ? { "oai-authenticated-user-id": subject, "oai-authenticated-user-email": `${subject}@sites.test` } : {}), ...headers },
    body: raw ?? JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, body: json, text, ms: Date.now() - started };
}

const start = (key, who = "siwc-head") => call({ action: "start", requestKey: key, knowledgeNodeId: ids.node, blogTitle: `E2E ${key}`, assigneeId: ids.author, deadline: DEADLINE }, who);
const complete = (blogTaskId, who = "siwc-author") => call({ action: "complete", blogTaskId, reviewerId: ids.reviewer, reviewDeadline: DEADLINE }, who);
const revise = (reviewTaskId, who = "siwc-reviewer", note = "Kirishni qisqartiring") => call({ action: "request-revision", reviewTaskId, note }, who);
const approve = (reviewTaskId, who = "siwc-reviewer") => call({ action: "approve", reviewTaskId }, who);
const status = (id) => sql(`select status from public.tasks where id = '${id}'`);
const task = (id) => rows(`select status, blocked_reason, assignee_id, creator_id from public.tasks where id = '${id}'`)[0];
const events = (id) => rows(`select event_type, metadata from public.task_events where task_id = '${id}' order by created_at, id`);
const headReviewsOf = (blogTaskId) => rows(`select r.task_id from public.content_task_runtime r join public.content_task_type_versions v on v.id = r.task_type_version_id join public.content_task_types t on t.id = v.task_type_id where r.source_task_id = '${blogTaskId}' and t.code = 'HEAD_REVIEW'`);
const decision = (reviewTaskId) => rows(`select field_values from public.content_task_runtime where task_id = '${reviewTaskId}'`)[0].field_values;
const tasksTitled = (key) => Number(sql(`select count(*) from public.tasks where title = 'Blog — E2E ${key}'`));
const snapshot = (blogTaskId, reviewTaskId) => ({
  tasks: Number(sql("select count(*) from public.tasks")),
  events: Number(sql(`select count(*) from public.task_events where task_id in ('${blogTaskId}', '${reviewTaskId ?? blogTaskId}')`)),
  revisions: Number(sql(`select count(*) from public.task_revisions where task_id = '${blogTaskId}'`)),
});

// --- 503 / 401 / 403 / 400 ------------------------------------------------------------

test("no persistence config -> 503 (nothing called)", async () => {
  const before = gw.log.length;
  const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, "siwc-author", { base: bare.url });
  assert.deepEqual([res.status, res.body.code], [503, "CONTENT_OS_PERSISTENCE_NOT_CONFIGURED"]);
  assert.equal(gw.log.length, before);
});

test("anonymous -> 401; unknown / revoked / wrong-tenant / inactive-user identities -> 403", async () => {
  assert.equal((await call({ action: "reconcile", blogTaskId: randomUUID() }, null)).status, 401);
  for (const subject of ["siwc-unknown", "siwc-revoked", "siwc-other-tenant", "siwc-former"]) {
    const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, subject);
    assert.deepEqual([res.status, res.body.code], [403, "EXTERNAL_IDENTITY_NOT_LINKED"], subject);
  }
});

test("request hygiene: malformed JSON / unknown fields / actor in body -> 400; wrong content type 415; oversize 413; GET 405; cross-site 403", async () => {
  assert.equal((await call(null, "siwc-author", { raw: "{not json" })).status, 400);
  const forged = await call({ action: "start", requestKey: "x", knowledgeNodeId: ids.node, blogTitle: "x", assigneeId: ids.author, deadline: DEADLINE, actorId: ids.head }, "siwc-author");
  assert.deepEqual([forged.status, forged.body.code], [400, "INVALID_INPUT"]);
  assert.equal((await call({ action: "start", requestKey: "x", knowledgeNodeId: "not-a-uuid", blogTitle: "x", assigneeId: ids.author, deadline: DEADLINE }, "siwc-author")).status, 400);
  const textPlain = await call({ action: "reconcile", blogTaskId: randomUUID() }, "siwc-author", { headers: { "content-type": "text/plain" } });
  assert.equal(textPlain.status, 415, "a form/text cross-site POST (no preflight) is refused");
  assert.equal((await call(null, "siwc-author", { raw: JSON.stringify({ action: "approve", reviewTaskId: randomUUID(), note: "x".repeat(20_000) }) })).status, 413);
  assert.equal((await fetch(`${worker.url}/api/content-os/blog-review`, { signal: AbortSignal.timeout(30_000) })).status, 405);
  for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://evil.example" }]) {
    const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, "siwc-author", { headers });
    assert.deepEqual([res.status, res.body.code], [403, "CROSS_ORIGIN_REQUEST"], JSON.stringify(headers));
  }
  const sameOrigin = await call({ action: "reconcile", blogTaskId: randomUUID() }, "siwc-author", { headers: { "sec-fetch-site": "same-origin", origin: worker.url } });
  assert.notEqual(sameOrigin.status, 403);
  const preflight = await fetch(`${worker.url}/api/content-os/blog-review`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" }, signal: AbortSignal.timeout(30_000) });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null, "no CORS grant");
});

// --- full slice with DB verification -------------------------------------------------------

test("full slice through the route: start -> complete -> revision (BLOCKED) -> resubmit (ASSIGNED) -> approve (DONE)", async () => {
  const key = `route-${randomUUID()}`;
  const started = await start(key);
  assert.equal(started.status, 200, started.text);
  const { blogTaskId, blogId } = started.body;
  assert.deepEqual(task(blogTaskId), { status: "IN_PROGRESS", blocked_reason: null, assignee_id: ids.author, creator_id: ids.head });
  assert.deepEqual(rows(`select entity_type, entity_id, relation from public.content_task_links where task_id = '${blogTaskId}' order by relation`), [
    { entity_type: "BLOG", entity_id: blogId, relation: "PRIMARY" }, { entity_type: "KNOWLEDGE_NODE", entity_id: ids.node, relation: "RELATED" }]);

  const done = await complete(blogTaskId);
  assert.equal(done.status, 200, done.text);
  const reviewTaskId = done.body.headReviewTaskId;
  assert.deepEqual([status(blogTaskId), status(reviewTaskId), done.body.headReviewCreated], ["DONE", "IN_PROGRESS", true]);
  assert.deepEqual(headReviewsOf(blogTaskId), [{ task_id: reviewTaskId }]);
  assert.equal(task(reviewTaskId).assignee_id, ids.reviewer);
  assert.deepEqual(rows(`select entity_type, entity_id, relation from public.content_task_links where task_id = '${reviewTaskId}' order by relation`)[0], { entity_type: "BLOG", entity_id: blogId, relation: "PRIMARY" });

  assert.equal((await revise(reviewTaskId, "siwc-author")).status, 409, "the Blog author cannot decide");
  assert.equal((await revise(reviewTaskId, "siwc/odd,subject (x)&y=z")).status, 409, "an ordinary linked member cannot decide");
  const revised = await revise(reviewTaskId);
  assert.equal(revised.status, 200, revised.text);
  assert.deepEqual(task(blogTaskId).status, "REVISION");
  assert.deepEqual(task(reviewTaskId), { status: "BLOCKED", blocked_reason: "Waiting for source Blog revision", assignee_id: ids.reviewer, creator_id: ids.author });
  assert.equal(decision(reviewTaskId)["review-decision"], "Revision requested");
  assert.equal(events(blogTaskId).find((e) => e.event_type === "REVISION_REQUESTED").metadata.reviewTaskId, reviewTaskId);
  assert.ok(events(reviewTaskId).some((e) => e.event_type === "TASK_BLOCKED" && e.metadata.coupledContentOsTransition === true && e.metadata.sourceTaskId === blogTaskId));
  assert.equal((await approve(reviewTaskId)).status, 409, "no approval while the Blog is in revision");

  const resubmitted = await complete(blogTaskId);
  assert.equal(resubmitted.status, 200, resubmitted.text);
  assert.deepEqual([status(blogTaskId), status(reviewTaskId), resubmitted.body.decision, resubmitted.body.headReviewCreated], ["DONE", "ASSIGNED", null, false]);
  assert.equal(task(reviewTaskId).blocked_reason, null);
  assert.deepEqual(headReviewsOf(blogTaskId), [{ task_id: reviewTaskId }], "SAME Head Review, none added");

  const reconciled = await call({ action: "reconcile", blogTaskId }, "siwc-author");
  assert.deepEqual([reconciled.status, reconciled.body.actions], [200, []]);
  assert.equal((await approve(reviewTaskId, "siwc-head")).status, 409, "only the review assignee completes it");
  const approved = await approve(reviewTaskId);
  assert.equal(approved.status, 200, approved.text);
  assert.deepEqual([status(reviewTaskId), approved.body.decision], ["DONE", "Approved"]);
  assert.deepEqual(events(reviewTaskId).filter((e) => e.event_type === "STATUS_CHANGED").map((e) => e.metadata.coupledContentOsTransition ?? false), [true, true, false, false]);
  assert.equal(tasksTitled(key), 1);
});

test("Head decides a revision; second cycle reuses the SAME Head Review", async () => {
  const { blogTaskId } = (await start(`head-${randomUUID()}`)).body;
  const reviewTaskId = (await complete(blogTaskId)).body.headReviewTaskId;
  assert.equal((await revise(reviewTaskId, "siwc-head", "Head: sarlavha")).status, 200);
  assert.deepEqual([status(blogTaskId), status(reviewTaskId)], ["REVISION", "BLOCKED"]);
  assert.equal((await complete(blogTaskId)).body.headReviewStatus, "ASSIGNED");
  assert.equal((await revise(reviewTaskId)).status, 200, "the reviewer picks it up (ASSIGNED -> IN_PROGRESS) and sends it back again");
  assert.deepEqual([status(blogTaskId), status(reviewTaskId)], ["REVISION", "BLOCKED"]);
  assert.equal(Number(sql(`select count(*) from public.task_revisions where task_id = '${blogTaskId}'`)), 2);
  assert.equal(headReviewsOf(blogTaskId).length, 1);
});

// --- retries / network failures -------------------------------------------------------------

test("exact duplicates of every operation: same state, no new task / event / revision", async () => {
  const key = `dup-${randomUUID()}`;
  const first = await start(key);
  assert.deepEqual((await start(key)).body, { ...first.body, created: false });
  const { blogTaskId } = first.body;
  const c1 = await complete(blogTaskId);
  const reviewTaskId = c1.body.headReviewTaskId;
  let snap = snapshot(blogTaskId, reviewTaskId);
  assert.deepEqual((await complete(blogTaskId)).body, { ...c1.body, headReviewCreated: false });
  assert.deepEqual(snapshot(blogTaskId, reviewTaskId), snap);

  const r1 = await revise(reviewTaskId);
  snap = snapshot(blogTaskId, reviewTaskId);
  assert.deepEqual((await revise(reviewTaskId)).body, r1.body);
  assert.deepEqual(snapshot(blogTaskId, reviewTaskId), snap);

  const s1 = await complete(blogTaskId);
  snap = snapshot(blogTaskId, reviewTaskId);
  assert.deepEqual((await complete(blogTaskId)).body, s1.body);
  assert.deepEqual(snapshot(blogTaskId, reviewTaskId), snap);

  const a1 = await approve(reviewTaskId);
  snap = snapshot(blogTaskId, reviewTaskId);
  assert.deepEqual((await approve(reviewTaskId)).body, a1.body);
  assert.deepEqual(snapshot(blogTaskId, reviewTaskId), snap);
  assert.equal(tasksTitled(key), 1);
});

test("response lost after commit (Blog creation, Head Review creation, revision, resubmit, approve) -> 503 retryable, exact retry converges", async () => {
  const key = `lost-${randomUUID()}`;
  const dropNext = (match) => gw.faults.push({ match, mode: "drop-after-commit" });

  dropNext((e) => e.path === "/rest/v1/rpc/content_os_create_task_idempotent" && e.body.includes(`blog:${key}`));
  const lostStart = await start(key);
  assert.deepEqual([lostStart.status, lostStart.body.code, lostStart.body.retryable], [503, "PERSISTENCE_TRANSPORT_FAILURE", true]);
  assert.equal(tasksTitled(key), 1, "the Task Bot committed the Blog task");
  const started = await start(key);
  assert.deepEqual([started.status, started.body.created], [200, false]);
  const { blogTaskId } = started.body;

  dropNext((e) => e.path === "/rest/v1/rpc/content_os_create_task_idempotent" && e.body.includes(`head-review:${blogTaskId}`));
  assert.equal((await complete(blogTaskId)).status, 503);
  assert.equal(status(blogTaskId), "DONE");
  const done = await complete(blogTaskId);
  assert.deepEqual([done.status, done.body.headReviewCreated], [200, false], "the retry found the review the lost response created");
  const reviewTaskId = done.body.headReviewTaskId;
  assert.equal(headReviewsOf(blogTaskId).length, 1);
  assert.equal(Number(sql(`select count(*) from public.content_os_idempotency_keys where idempotency_key = 'head-review:${blogTaskId}'`)), 1);

  dropNext((e) => e.path === "/rest/v1/rpc/transition_task_with_events" && e.body.includes('"p_new_status":"REVISION"') && e.body.includes(blogTaskId));
  assert.equal((await revise(reviewTaskId)).status, 503);
  assert.deepEqual([status(blogTaskId), status(reviewTaskId)], ["REVISION", "BLOCKED"]);
  const revised = await revise(reviewTaskId);
  assert.deepEqual([revised.status, revised.body.decision], [200, "Revision requested"]);
  assert.equal(Number(sql(`select count(*) from public.task_revisions where task_id = '${blogTaskId}'`)), 1);

  dropNext((e) => e.path === "/rest/v1/rpc/transition_task_with_events" && e.body.includes('"p_new_status":"DONE"') && e.body.includes(blogTaskId));
  assert.equal((await complete(blogTaskId)).status, 503);
  assert.deepEqual([status(blogTaskId), status(reviewTaskId)], ["DONE", "ASSIGNED"]);
  const resubmitted = await complete(blogTaskId);
  assert.deepEqual([resubmitted.status, resubmitted.body.headReviewStatus, resubmitted.body.decision], [200, "ASSIGNED", null]);

  dropNext((e) => e.path === "/rest/v1/rpc/transition_task_with_events" && e.body.includes('"p_new_status":"DONE"') && e.body.includes(reviewTaskId));
  assert.equal((await approve(reviewTaskId)).status, 503);
  assert.equal(status(reviewTaskId), "DONE");
  const approved = await approve(reviewTaskId);
  assert.deepEqual([approved.status, approved.body.headReviewStatus, approved.body.decision], [200, "DONE", "Approved"]);
  assert.equal(events(blogTaskId).filter((e) => e.event_type === "TASK_COMPLETED").length, 2, "one per real completion, none from retries");
  assert.equal(events(reviewTaskId).filter((e) => e.event_type === "TASK_COMPLETED").length, 1);
});

test("a database API that never answers is cut off by the route timeout (503, not a hung request)", async () => {
  gw.faults.push({ match: (e) => e.path === "/rest/v1/external_identity_links", mode: "hang" });
  const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, "siwc-author");
  assert.deepEqual([res.status, res.body.code], [503, "PERSISTENCE_TRANSPORT_FAILURE"]);
  assert.ok(res.ms < 20_000, `took ${res.ms}ms`);
});

test("states the Task Bot would refuse with 40001 are refused by Content OS first (409, fast, nothing sent)", async () => {
  const { blogTaskId } = (await start(`livelock-${randomUUID()}`)).body;
  const reviewTaskId = (await complete(blogTaskId)).body.headReviewTaskId;
  await revise(reviewTaskId);
  // Out of band (e.g. the reviewer taps RESUME in Telegram): legacy BLOCKED -> IN_PROGRESS.
  sql(`select status from public.transition_task_with_events('${reviewTaskId}', '${ids.reviewer}', 'IN_PROGRESS')`);
  const transitionsSent = () => gw.log.filter((e) => e.path === "/rest/v1/rpc/transition_task_with_events").length;
  let sentBefore = transitionsSent();
  const resubmit = await complete(blogTaskId);
  assert.deepEqual([resubmit.status, resubmit.body.code], [409, "CONTENT_OS_RULE"]);
  assert.ok(resubmit.ms < 5_000);
  assert.equal(transitionsSent(), sentBefore, "the refused resubmission was not sent");
  // Cancelled review cannot be approved.
  const other = (await start(`cancel-${randomUUID()}`)).body.blogTaskId;
  const otherReview = (await complete(other)).body.headReviewTaskId;
  sql(`select status from public.transition_task_with_events('${otherReview}', '${ids.head}', 'CANCELLED')`);
  sentBefore = transitionsSent();
  const res = await approve(otherReview);
  assert.deepEqual([res.status, res.body.code], [409, "CONTENT_OS_RULE"]);
  assert.equal(transitionsSent(), sentBefore, "the refused approval was not sent");
  assert.equal(Number(sql("select count(*) from pg_stat_activity where usename = 'authenticator' and state <> 'idle' and query not like 'LISTEN%'")), 0, "no request is stuck in the database");
});

test("direct spoof without a confirmed trust boundary fails closed: Head / reviewer / author / arbitrary / wrong tenant -> 503, nothing read or written", async () => {
  const before = gw.log.length;
  const tasks = Number(sql("select count(*) from public.tasks"));
  for (const subject of ["siwc-head", "siwc-reviewer", "siwc-author", "anything-at-all", "siwc-other-tenant"]) {
    for (const body of [{ action: "start", requestKey: `spoof-${randomUUID()}`, knowledgeNodeId: ids.node, blogTitle: "x", assigneeId: ids.author, deadline: DEADLINE }, { action: "reconcile", blogTaskId: randomUUID() }]) {
      const res = await call(body, subject, { base: unconfirmed.url });
      assert.deepEqual([res.status, res.body.code], [503, "CONTENT_OS_PERSISTENCE_CONFIG_ERROR"], subject);
    }
  }
  assert.equal(gw.log.length, before, "no database API call was made");
  assert.equal(Number(sql("select count(*) from public.tasks")), tasks);
});

test("DELEGATED TRUST (documents the residual risk): with the acknowledgement set, the app acts on whatever identity header reaches it", async () => {
  // Same request a browser would get injected by the dispatcher — sent straight to the Worker.
  const res = await start(`spoof-${randomUUID()}`, "siwc-head");
  assert.equal(res.status, 200);
  assert.equal(task(res.body.blogTaskId).creator_id, ids.head, "the Worker trusted the header as the Head");
});

test("logs: one structured record per request, classified, without key / subject / body", async () => {
  await new Promise((r) => setTimeout(r, 500));
  const out = worker.output();
  const records = out.split("\n").map((line) => line.slice(line.indexOf("{"))).filter((line) => line.includes('"event":"content_os.blog_review"')).map((line) => JSON.parse(line));
  const outcomes = new Set(records.map((r) => r.outcome));
  for (const expected of ["ok", "unauthenticated", "actor_not_linked", "invalid_input", "content_os_rule", "transport_failure"]) assert.ok(outcomes.has(expected), expected);
  assert.ok(records.some((r) => r.created === false), "idempotent replays are visible");
  assert.ok(!out.includes(SERVICE) && !out.includes(SERVICE.split(".")[2]), "the key is never printed");
  assert.ok(!/siwc-|Kirishni|E2E /.test(records.map((r) => JSON.stringify(r)).join("\n")), "no subject or request content in the records");
});
