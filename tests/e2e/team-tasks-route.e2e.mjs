/**
 * LOCAL CROSS-REPO E2E ONLY. Runs the built Content OS Worker and built Task
 * Bot against real local PostgREST/PostgreSQL 17. Telegram HTTP is stubbed
 * inside the Task Bot child process and recorded; no external host is used.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ids, sql } from "./lib/db.mjs";
import { mintKey, startGateway } from "./lib/gateway.mjs";
import { startTaskBot } from "./lib/task-bot.mjs";
import { makeLocalTls, startWorker } from "./lib/worker.mjs";

const UPSTREAM = process.env.PGRST_UPSTREAM ?? "http://172.17.0.2:3000";
const SERVICE = mintKey("service_role");
const ANON = mintKey("anon");
const SHARED_SECRET = "local-cross-repo-content-os-secret-10b";
const DEADLINE_1 = "2030-11-01T09:00:00.000Z";
const DEADLINE_2 = "2030-11-05T09:00:00.000Z";
const WEBHOOK_SECRET = "local_e2e_webhook_secret_123";
let tls, gateway, taskBot, worker;
const sessions = {};
let loginIp = 10;
let callbackUpdateId = 700_000;
const flow = {};

before(async () => {
  tls = makeLocalTls();
  gateway = await startGateway({
    upstream: UPSTREAM,
    apiKeys: [SERVICE, ANON],
    tls: { key: readFileSync(tls.key), cert: readFileSync(tls.cert) },
  });
  taskBot = await startTaskBot({
    supabaseUrl: gateway.url,
    anonKey: ANON,
    serviceKey: SERVICE,
    serviceSecret: SHARED_SECRET,
    caFile: tls.ca,
  });
  worker = await startWorker({
    caFile: tls.ca,
    vars: {
      CONTENT_OS_SUPABASE_URL: gateway.url,
      CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_e2e_bot",
      CONTENT_OS_PERSISTENCE_ENABLED: "true",
      TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
      TASK_BACKEND_BASE_URL: taskBot.url,
      CONTENT_OS_TASK_BACKEND_SECRET: SHARED_SECRET,
    },
  });
  for (const [name, telegramId] of Object.entries({
    head: 9001,
    author: 9002,
    digital: 9003,
    smm: 9004,
    operator: 9006,
    seo: 9007,
  })) sessions[name] = await login(telegramId);
});

after(async () => {
  worker?.stop();
  taskBot?.stop();
  await gateway?.close();
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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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

async function login(telegramUserId) {
  const verifier = randomBytes(32).toString("base64url");
  const verifierHash = createHash("sha256").update(verifier).digest("hex");
  // Local workerd has no Cloudflare edge to replace CF-Connecting-IP. Give
  // each simulated browser its own edge-provided address so this suite tests
  // team behavior instead of intentionally exhausting one shared IP bucket.
  const started = await request("/api/auth/telegram/start", {
    method: "POST",
    body: { verifierHash },
    headers: { "cf-connecting-ip": `203.0.113.${loginIp++}` },
  });
  assert.equal(started.status, 200, started.text);
  assert.equal(approveChallenge(started.body.challengeId, telegramUserId).status, "APPROVED");
  const completed = await request("/api/auth/telegram/complete", {
    method: "POST",
    body: { challengeId: started.body.challengeId, verifier },
  });
  assert.equal(completed.status, 200, completed.text);
  return completed.response.headers.get("set-cookie").split(";", 1)[0];
}

const teamRead = (cookie, query) => request(`/api/team/tasks?${query}`, { cookie });
const teamWrite = (cookie, body) => request("/api/team/tasks", { method: "POST", body, cookie });
const blogWrite = (cookie, body) => request("/api/content-os/blog-review", { method: "POST", body, cookie });

async function telegramResolve(kind, requestId, decision = "APPROVE") {
  callbackUpdateId += 1;
  return request("/api/telegram/webhook", {
    base: taskBot.url,
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
    body: {
      update_id: callbackUpdateId,
      callback_query: {
        id: `callback-${callbackUpdateId}`,
        from: { id: 9001, is_bot: false, first_name: "Head" },
        message: { message_id: callbackUpdateId, chat: { id: 9001, type: "private" } },
        data: `${kind}:${requestId}:${decision}`,
      },
    },
  });
}

const sentTo = (telegramId) => taskBot.telegramMessages()
  .filter((entry) => entry.url.endsWith("/sendMessage") && String(entry.body?.chat_id) === String(telegramId));

test("FLOW 1 — all active roles log in; manual task, all-task visibility, deadline request, Content OS approval, notifications", async () => {
  const expectedRoles = {
    head: "HEAD_OF_MARKETING",
    author: "CONTENT_MARKETER",
    digital: "DIGITAL_MARKETER",
    smm: "SMM_MANAGER",
    operator: "OPERATOR_VIDEO_EDITOR",
    seo: "SEO_SPECIALIST",
  };
  for (const [name, role] of Object.entries(expectedRoles)) {
    const me = await request("/api/auth/me", { cookie: sessions[name] });
    assert.deepEqual([me.status, me.body.user.role], [200, role]);
    const tasks = await teamRead(sessions[name], "resource=tasks&scope=all");
    assert.equal(tasks.status, 200, `${tasks.text}\nTASK BOT OUTPUT:\n${taskBot.output()}\nWORKER OUTPUT:\n${worker.output()}`);
  }

  const title = `10B manual ${randomUUID()}`;
  const notificationCount = sentTo(9006).length;
  const created = await teamWrite(sessions.author, {
    action: "create",
    title,
    description: "Disposable cross-repo rehearsal",
    priority: "high",
    assigneeId: ids.operator,
    deadline: DEADLINE_1,
  });
  assert.equal(created.status, 200, created.text);
  flow.manualTaskId = created.body.task.id;
  assert.equal(created.body.task.creatorId, ids.author);
  assert.equal(created.body.task.assigneeId, ids.operator);
  assert.equal(sentTo(9006).length, notificationCount + 1);
  assert.match(sentTo(9006).at(-1).body.text, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const operatorTasks = await teamRead(sessions.operator, "resource=tasks&scope=my");
  assert.ok(operatorTasks.body.tasks.some((task) => task.id === flow.manualTaskId));
  const digitalTasks = await teamRead(sessions.digital, "resource=tasks&scope=all");
  assert.ok(digitalTasks.body.tasks.some((task) => task.id === flow.manualTaskId));

  const requested = await teamWrite(sessions.operator, {
    action: "request-deadline",
    taskId: flow.manualTaskId,
    requestedDeadline: DEADLINE_2,
    reason: "Waiting for approved source footage",
  });
  assert.equal(requested.status, 200, requested.text);
  flow.deadlineRequestId = requested.body.deadlineRequest.id;
  const resolved = await teamWrite(sessions.head, {
    action: "resolve-deadline",
    requestId: flow.deadlineRequestId,
    approve: true,
    resolutionNote: "Approved in Content OS",
  });
  assert.deepEqual([resolved.status, resolved.body.deadlineRequest.status], [200, "APPROVED"]);
  const details = await teamRead(sessions.operator, `resource=task&taskId=${flow.manualTaskId}`);
  assert.equal(new Date(details.body.details.task.deadline).toISOString(), DEADLINE_2);
  assert.equal(details.body.details.deadlineRequests.find((entry) => entry.id === flow.deadlineRequestId).status, "APPROVED");
  assert.ok(sentTo(9006).length >= notificationCount + 2, "creation and approval both reached the Telegram dispatcher");
  assert.equal(Number(sql(`select count(*) from public.task_notification_deliveries d join public.task_events e on e.id = d.task_event_id where d.status = 'SENT' and d.recipient_user_id = '${ids.operator}' and e.task_id = '${flow.manualTaskId}' and d.event_type = 'DEADLINE_CHANGE_APPROVED'`)), 1);

  const eventCount = Number(sql(`select count(*) from public.task_events where task_id = '${flow.manualTaskId}' and event_type = 'DEADLINE_CHANGE_APPROVED'`));
  assert.equal((await telegramResolve("deadline", flow.deadlineRequestId)).status, 200);
  assert.equal(Number(sql(`select count(*) from public.task_events where task_id = '${flow.manualTaskId}' and event_type = 'DEADLINE_CHANGE_APPROVED'`)), eventCount, "Telegram retry cannot add a second approval event");
});

test("FLOW 2 — Content OS request approved in Telegram; fresh UI read resolves and second UI approval conflicts safely", async () => {
  const requested = await teamWrite(sessions.operator, {
    action: "request-reassign",
    taskId: flow.manualTaskId,
    requestedAssigneeId: ids.seo,
    reason: "SEO owns the remaining work",
  });
  assert.equal(requested.status, 200, requested.text);
  const requestId = requested.body.reassignRequest.id;
  assert.equal((await telegramResolve("reassign", requestId)).status, 200);

  const queue = await teamRead(sessions.head, "resource=requests");
  assert.equal(queue.body.requests.reassignRequests.find((entry) => entry.id === requestId).status, "APPROVED");
  const details = await teamRead(sessions.operator, `resource=task&taskId=${flow.manualTaskId}`);
  assert.equal(details.body.details.task.assigneeId, ids.seo);
  assert.equal(details.body.details.reassignRequests.find((entry) => entry.id === requestId).status, "APPROVED");
  const duplicate = await teamWrite(sessions.head, { action: "resolve-reassign", requestId, approve: true });
  assert.deepEqual([duplicate.status, duplicate.body.code], [409, "CONFLICT"]);
  assert.equal(Number(sql(`select count(*) from public.task_events where task_id = '${flow.manualTaskId}' and event_type = 'REASSIGN_APPROVED'`)), 1);
  assert.equal(Number(sql(`select count(*) from public.task_notification_deliveries d join public.task_events e on e.id = d.task_event_id where d.status = 'SENT' and e.task_id = '${flow.manualTaskId}' and d.event_type = 'REASSIGN_APPROVED'`)), 2);
});

test("FLOW 3 — creator changes deadline and assignee directly without a Head request", async () => {
  const created = await teamWrite(sessions.author, {
    action: "create",
    title: `10B creator control ${randomUUID()}`,
    priority: "normal",
    assigneeId: ids.operator,
    deadline: DEADLINE_1,
  });
  assert.equal(created.status, 200, created.text);
  flow.creatorTaskId = created.body.task.id;
  assert.equal((await teamWrite(sessions.author, { action: "direct-deadline", taskId: flow.creatorTaskId, deadline: DEADLINE_2 })).status, 200);
  assert.equal((await teamWrite(sessions.author, { action: "direct-reassign", taskId: flow.creatorTaskId, assigneeId: ids.seo })).status, 200);
  const detail = (await teamRead(sessions.author, `resource=task&taskId=${flow.creatorTaskId}`)).body.details;
  assert.deepEqual([new Date(detail.task.deadline).toISOString(), detail.task.assigneeId], [DEADLINE_2, ids.seo]);
  assert.deepEqual([detail.deadlineRequests.length, detail.reassignRequests.length], [0, 0]);
});

test("FLOW 4 — unrelated team member can read but cannot mutate", async () => {
  const visible = await teamRead(sessions.digital, "resource=tasks&scope=all");
  assert.ok(visible.body.tasks.some((task) => task.id === flow.creatorTaskId));
  const edit = await teamWrite(sessions.digital, {
    action: "edit",
    taskId: flow.creatorTaskId,
    title: "Unauthorized edit",
    description: null,
    priority: "low",
  });
  assert.deepEqual([edit.status, edit.body.code], [403, "FORBIDDEN"]);
  const lifecycle = await teamWrite(sessions.digital, { action: "lifecycle", taskId: flow.creatorTaskId, taskAction: "BLOCK", reason: "No authority" });
  assert.deepEqual([lifecycle.status, lifecycle.body.code], [403, "FORBIDDEN"]);
});

test("FLOW 5 — Head soft-archives, ordinary users cannot see archive, restore preserves id/status/history", async () => {
  const before = (await teamRead(sessions.head, `resource=task&taskId=${flow.creatorTaskId}`)).body.details;
  const beforeEventIds = before.events.map((entry) => entry.id);
  const status = before.task.status;
  assert.equal((await teamWrite(sessions.head, { action: "archive", taskId: flow.creatorTaskId, reason: "Rehearsal archive" })).status, 200);
  for (const cookie of [sessions.author, sessions.digital, sessions.seo]) {
    const normal = await teamRead(cookie, "resource=tasks&scope=all");
    assert.ok(!normal.body.tasks.some((task) => task.id === flow.creatorTaskId));
  }
  assert.equal((await teamRead(sessions.author, "resource=tasks&scope=archived")).status, 403);
  const archived = await teamRead(sessions.head, "resource=tasks&scope=archived");
  assert.ok(archived.body.tasks.some((task) => task.id === flow.creatorTaskId));
  const archivedRead = await teamRead(sessions.head, `resource=task&taskId=${flow.creatorTaskId}`);
  assert.equal(archivedRead.status, 200, `${archivedRead.text}\n${taskBot.output()}`);
  const archivedDetail = archivedRead.body.details;
  assert.deepEqual([archivedDetail.task.id, archivedDetail.task.status], [flow.creatorTaskId, status]);
  for (const id of beforeEventIds) assert.ok(archivedDetail.events.some((entry) => entry.id === id));

  const restored = await teamWrite(sessions.head, { action: "restore", taskId: flow.creatorTaskId });
  assert.deepEqual([restored.status, restored.body.task.id, restored.body.task.status], [200, flow.creatorTaskId, status]);
  const after = (await teamRead(sessions.head, `resource=task&taskId=${flow.creatorTaskId}`)).body.details;
  assert.equal(after.archive, null);
  for (const id of beforeEventIds) assert.ok(after.events.some((entry) => entry.id === id));
  assert.deepEqual(after.events.slice(-2).map((entry) => entry.eventType), ["TASK_ARCHIVED", "TASK_RESTORED"]);
});

test("FLOW 6 — existing Telegram-authenticated Blog → Head Review revision/resubmit/approval remains intact", async () => {
  const requestKey = `10b-blog-${randomUUID()}`;
  const started = await blogWrite(sessions.author, {
    action: "start",
    requestKey,
    knowledgeNodeId: ids.node,
    blogTitle: `10B Blog ${requestKey}`,
    assigneeId: ids.author,
    deadline: DEADLINE_1,
  });
  assert.equal(started.status, 200, started.text);
  const blogTaskId = started.body.blogTaskId;
  const completed = await blogWrite(sessions.author, { action: "complete", blogTaskId, reviewerId: ids.reviewer, reviewDeadline: DEADLINE_2 });
  assert.equal(completed.status, 200, completed.text);
  const reviewTaskId = completed.body.headReviewTaskId;
  assert.equal((await blogWrite(sessions.digital, { action: "request-revision", reviewTaskId, note: "Tighten the opening" })).status, 200);
  const resubmitted = await blogWrite(sessions.author, { action: "complete", blogTaskId, reviewerId: ids.reviewer, reviewDeadline: DEADLINE_2 });
  assert.deepEqual([resubmitted.status, resubmitted.body.headReviewTaskId, resubmitted.body.headReviewCreated], [200, reviewTaskId, false]);
  const approved = await blogWrite(sessions.digital, { action: "approve", reviewTaskId });
  assert.deepEqual([approved.status, approved.body.decision], [200, "Approved"]);
  assert.equal(Number(sql(`select count(*) from public.content_task_runtime where source_task_id = '${blogTaskId}'`)), 1);
});

test("FLOW 7 — deactivation invalidates an active Content OS session on the next request", async () => {
  assert.equal((await teamRead(sessions.smm, "resource=tasks&scope=all")).status, 200);
  sql(`update public.users set is_active = false, deactivated_at = now(), deactivated_by = '${ids.head}' where id = '${ids.other}'`);
  const denied = await teamRead(sessions.smm, "resource=tasks&scope=all");
  assert.deepEqual([denied.status, denied.body.code], [401, "UNAUTHENTICATED"]);
});
