/**
 * LOCAL E2E ONLY (run tests/e2e/setup.sh and `npm run build` first).
 * POST /api/content-os/blog-review through the REAL built Worker (workerd),
 * the real route + handler + adapter, a Supabase-gateway emulator over TLS,
 * real PostgREST 12 and the disposable PostgreSQL 17 database built from the
 * FINAL canonical Task Bot migrations through Sprint 10A.
 * BlogReviewFlow is never called directly; DB state is checked with SQL.
 * Authentication goes through the real challenge/status/redeem/validate RPCs.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ids, rows, sql } from "./lib/db.mjs";
import { mintKey, startGateway } from "./lib/gateway.mjs";
import { makeLocalTls, startWorker } from "./lib/worker.mjs";

const UPSTREAM = process.env.PGRST_UPSTREAM ?? "http://172.17.0.2:3000";
const SERVICE = mintKey("service_role");
const DEADLINE = "2026-10-20T13:00:00.000Z";
let tls, gw, worker, authOnly;
const sessions = {};
let loginIp = 10;

before(async () => {
  tls = makeLocalTls();
  gw = await startGateway({ upstream: UPSTREAM, apiKeys: [SERVICE], tls: { key: readFileSync(tls.key), cert: readFileSync(tls.cert) } });
  const auth = { CONTENT_OS_SUPABASE_URL: gw.url, CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: SERVICE, CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_e2e_bot" };
  worker = await startWorker({ caFile: tls.ca, vars: { ...auth, CONTENT_OS_PERSISTENCE_ENABLED: "true" } });
  authOnly = await startWorker({ caFile: tls.ca, vars: auth });
  sessions.head = await login(9001);
  sessions.author = await login(9002);
  sessions.reviewer = await login(9003);
  sessions.other = await login(9004);
});
after(async () => {
  worker?.stop();
  authOnly?.stop();
  await gw?.close();
  tls?.cleanup();
});

async function request(path, { base = worker.url, method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" && method !== "HEAD" ? { origin: base } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { response, status: response.status, body: json, text };
}

function approveChallenge(challengeId, telegramUserId) {
  return JSON.parse(sql(`set role service_role; select row_to_json(t) from (select * from public.content_os_auth_approve_challenge('${challengeId}'::uuid, ${telegramUserId}::bigint)) t`));
}

async function login(telegramUserId, { base = worker.url } = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const verifierHash = createHash("sha256").update(verifier).digest("hex");
  // Local workerd has no Cloudflare edge to replace CF-Connecting-IP. Give
  // each simulated browser its own edge-provided address so this suite tests
  // auth behavior instead of intentionally exhausting one shared IP bucket.
  const started = await request("/api/auth/telegram/start", {
    base,
    method: "POST",
    body: { verifierHash },
    headers: { "cf-connecting-ip": `198.51.100.${loginIp++}` },
  });
  assert.equal(started.status, 200, started.text);
  assert.match(started.body.telegramDeepLink, new RegExp(`^https://t\\.me/ibox_e2e_bot\\?start=contentos_${started.body.challengeId}$`));
  const approved = approveChallenge(started.body.challengeId, telegramUserId);
  assert.equal(approved.status, "APPROVED");
  const polled = await request(`/api/auth/telegram/status?challengeId=${started.body.challengeId}`, { base });
  assert.deepEqual([polled.status, polled.body.status], [200, "APPROVED"]);
  const completed = await request("/api/auth/telegram/complete", { base, method: "POST", body: { challengeId: started.body.challengeId, verifier } });
  assert.equal(completed.status, 200, completed.text);
  const setCookie = completed.response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(";", 1)[0];
  assert.match(cookie ?? "", /^content_os_session_dev=[A-Za-z0-9_-]{43}$/);
  return cookie;
}

async function call(body, cookie, { base = worker.url, headers = {}, raw = null } = {}) {
  const started = Date.now();
  const result = await request("/api/content-os/blog-review", { base, method: "POST", body: raw ?? body, cookie, headers });
  return { ...result, ms: Date.now() - started };
}

const start = (key, cookie = sessions.head) => call({ action: "start", requestKey: key, knowledgeNodeId: ids.node, blogTitle: `E2E ${key}`, assigneeId: ids.author, deadline: DEADLINE }, cookie);
const complete = (blogTaskId, cookie = sessions.author) => call({ action: "complete", blogTaskId, reviewerId: ids.reviewer, reviewDeadline: DEADLINE }, cookie);
const revise = (reviewTaskId, cookie = sessions.reviewer, note = "Kirishni qisqartiring") => call({ action: "request-revision", reviewTaskId, note }, cookie);
const approve = (reviewTaskId, cookie = sessions.reviewer) => call({ action: "approve", reviewTaskId }, cookie);
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
  const authOnlyCookie = await login(9002, { base: authOnly.url });
  const callsAfterLogin = gw.log.length;
  const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, authOnlyCookie, { base: authOnly.url });
  assert.deepEqual([res.status, res.body.code], [503, "CONTENT_OS_PERSISTENCE_NOT_CONFIGURED"]);
  assert.ok(callsAfterLogin > before);
  assert.equal(gw.log.length, callsAfterLogin + 1, "only session validation reached the database");
});

test("anonymous and forged Sites identity headers are both denied", async () => {
  assert.equal((await call({ action: "reconcile", blogTaskId: randomUUID() }, null)).status, 401);
  const forged = await call({ action: "reconcile", blogTaskId: randomUUID() }, null, { headers: { "oai-authenticated-user-id": "siwc-head" } });
  assert.deepEqual([forged.status, forged.body.code], [401, "UNAUTHENTICATED"]);
});

test("real login RPC flow yields current role, second device, one-device logout, and replay refusal", async () => {
  const first = await request("/api/auth/me", { cookie: sessions.author });
  assert.deepEqual([first.status, first.body.user.id, first.body.user.role], [200, ids.author, "CONTENT_MARKETER"]);
  const secondDevice = await login(9002);
  assert.notEqual(secondDevice, sessions.author);
  const loggedOut = await request("/api/auth/logout", { method: "POST", body: {}, cookie: sessions.author });
  assert.equal(loggedOut.status, 204);
  assert.equal((await request("/api/auth/me", { cookie: sessions.author })).status, 401);
  assert.equal((await request("/api/auth/me", { cookie: secondDevice })).status, 200, "other device remains valid");
  sessions.author = secondDevice;
});

test("unknown/inactive approvals are generic denials; wrong proof and redemption replay fail without duplicate sessions", async () => {
  const begin = async () => {
    const verifier = randomBytes(32).toString("base64url");
    const verifierHash = createHash("sha256").update(verifier).digest("hex");
    const started = await request("/api/auth/telegram/start", { method: "POST", body: { verifierHash } });
    assert.equal(started.status, 200);
    return { verifier, ...started.body };
  };
  for (const telegramId of [999999, 9005]) {
    const challenge = await begin();
    const denied = approveChallenge(challenge.challengeId, telegramId);
    assert.equal(denied.status, "DENIED");
    const polled = await request(`/api/auth/telegram/status?challengeId=${challenge.challengeId}`);
    assert.equal(polled.body.status, "CANCELLED", "browser learns no account detail");
  }

  const challenge = await begin();
  approveChallenge(challenge.challengeId, 9004);
  const before = Number(sql(`select count(*) from private.content_os_web_sessions where user_id = '${ids.other}'`));
  const wrong = await request("/api/auth/telegram/complete", { method: "POST", body: { challengeId: challenge.challengeId, verifier: randomBytes(32).toString("base64url") } });
  assert.deepEqual([wrong.status, wrong.body.reason], [401, "INVALID_PROOF"]);
  const completed = await request("/api/auth/telegram/complete", { method: "POST", body: { challengeId: challenge.challengeId, verifier: challenge.verifier } });
  assert.equal(completed.status, 200);
  const replay = await request("/api/auth/telegram/complete", { method: "POST", body: { challengeId: challenge.challengeId, verifier: challenge.verifier } });
  assert.deepEqual([replay.status, replay.body.reason], [410, "ALREADY_CONSUMED"]);
  assert.equal(Number(sql(`select count(*) from private.content_os_web_sessions where user_id = '${ids.other}'`)), before + 1);
});

test("request hygiene: malformed JSON / unknown fields / actor in body -> 400; wrong content type 415; oversize 413; GET 405; cross-site 403", async () => {
  assert.equal((await call(null, sessions.author, { raw: "{not json" })).status, 400);
  const forged = await call({ action: "start", requestKey: "x", knowledgeNodeId: ids.node, blogTitle: "x", assigneeId: ids.author, deadline: DEADLINE, actorId: ids.head }, sessions.author);
  assert.deepEqual([forged.status, forged.body.code], [400, "INVALID_INPUT"]);
  assert.equal((await call({ action: "start", requestKey: "x", knowledgeNodeId: "not-a-uuid", blogTitle: "x", assigneeId: ids.author, deadline: DEADLINE }, sessions.author)).status, 400);
  const textPlain = await call({ action: "reconcile", blogTaskId: randomUUID() }, sessions.author, { headers: { "content-type": "text/plain" } });
  assert.equal(textPlain.status, 415, "a form/text cross-site POST (no preflight) is refused");
  assert.equal((await call(null, sessions.author, { raw: JSON.stringify({ action: "approve", reviewTaskId: randomUUID(), note: "x".repeat(20_000) }) })).status, 413);
  assert.equal((await fetch(`${worker.url}/api/content-os/blog-review`, { signal: AbortSignal.timeout(30_000) })).status, 405);
  for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://evil.example" }]) {
    const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, sessions.author, { headers });
    assert.deepEqual([res.status, res.body.code], [403, "CROSS_ORIGIN_REQUEST"], JSON.stringify(headers));
  }
  const sameOrigin = await call({ action: "reconcile", blogTaskId: randomUUID() }, sessions.author, { headers: { "sec-fetch-site": "same-origin", origin: worker.url } });
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

  assert.equal((await revise(reviewTaskId, sessions.author)).status, 409, "the Blog author cannot decide");
  assert.equal((await revise(reviewTaskId, sessions.other)).status, 409, "an ordinary active member cannot decide");
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

  const reconciled = await call({ action: "reconcile", blogTaskId }, sessions.author);
  assert.deepEqual([reconciled.status, reconciled.body.actions], [200, []]);
  assert.equal((await approve(reviewTaskId, sessions.head)).status, 409, "only the review assignee completes it");
  const approved = await approve(reviewTaskId);
  assert.equal(approved.status, 200, approved.text);
  assert.deepEqual([status(reviewTaskId), approved.body.decision], ["DONE", "Approved"]);
  assert.deepEqual(events(reviewTaskId).filter((e) => e.event_type === "STATUS_CHANGED").map((e) => e.metadata.coupledContentOsTransition ?? false), [true, true, false, false]);
  assert.equal(tasksTitled(key), 1);
});

test("Head decides a revision; second cycle reuses the SAME Head Review", async () => {
  const { blogTaskId } = (await start(`head-${randomUUID()}`)).body;
  const reviewTaskId = (await complete(blogTaskId)).body.headReviewTaskId;
  assert.equal((await revise(reviewTaskId, sessions.head, "Head: sarlavha")).status, 200);
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

  dropNext((e) => e.path === "/rest/v1/rpc/content_os_complete_blog_with_head_review" && e.body.includes(blogTaskId));
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

  dropNext((e) => e.path === "/rest/v1/rpc/content_os_complete_blog_with_head_review" && e.body.includes(blogTaskId));
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
  gw.faults.push({ match: (e) => e.path === "/rest/v1/content_task_runtime", mode: "hang" });
  const res = await call({ action: "reconcile", blogTaskId: randomUUID() }, sessions.author);
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

test("current role is refreshed and deactivation immediately revokes the existing session", async () => {
  assert.equal((await request("/api/auth/me", { cookie: sessions.other })).body.user.role, "SMM_MANAGER");
  sql(`update public.users set role = 'SEO_SPECIALIST' where id = '${ids.other}'`);
  assert.equal((await request("/api/auth/me", { cookie: sessions.other })).body.user.role, "SEO_SPECIALIST");
  sql(`update public.users set is_active = false where id = '${ids.other}'`);
  assert.equal((await request("/api/auth/me", { cookie: sessions.other })).status, 401);
  sql(`update public.users set is_active = true, role = 'SMM_MANAGER' where id = '${ids.other}'`);
  assert.equal((await request("/api/auth/me", { cookie: sessions.other })).status, 401, "reactivation does not revive a revoked session");
  sessions.other = await login(9004);
  assert.equal((await request("/api/auth/me", { cookie: sessions.other })).status, 200);
});

test("logs: one structured record per request, classified, without key / subject / body", async () => {
  await new Promise((r) => setTimeout(r, 500));
  const out = worker.output();
  const records = out.split("\n").map((line) => line.slice(line.indexOf("{"))).filter((line) => line.includes('"event":"content_os.blog_review"')).map((line) => JSON.parse(line));
  const outcomes = new Set(records.map((r) => r.outcome));
  for (const expected of ["ok", "invalid_input", "content_os_rule", "transport_failure"]) assert.ok(outcomes.has(expected), expected);
  assert.ok(records.some((r) => r.created === false), "idempotent replays are visible");
  assert.ok(!out.includes(SERVICE) && !out.includes(SERVICE.split(".")[2]), "the key is never printed");
  assert.ok(!/Kirishni|E2E /.test(records.map((r) => JSON.stringify(r)).join("\n")), "no request content in the records");
});
