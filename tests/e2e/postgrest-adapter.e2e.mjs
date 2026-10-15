/**
 * LOCAL E2E ONLY (run tests/e2e/setup.sh first). The Content OS PostgREST
 * adapter against a REAL PostgREST 12 over HTTP, on the disposable database
 * built from the final Task Bot migrations + Content OS drafts 00..06.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { compilePersistence } from "./lib/compile.mjs";
import { ids, rows, sql } from "./lib/db.mjs";
import { mintKey, startGateway } from "./lib/gateway.mjs";

const UPSTREAM = process.env.PGRST_UPSTREAM ?? "http://172.17.0.2:3000";
const { load, cleanup } = compilePersistence();
const { PostgrestClient, PostgrestError, SupabaseContentOsStore, SupabaseOperationalTaskGateway } = load("supabase-adapter");
const { SupabaseExternalActorResolver } = load("actor-resolver");
const { PersistenceConflictError } = load("ports");
const SERVICE = mintKey("service_role");
const ANON = mintKey("anon");
let gw, db, store, tasks;

before(async () => {
  gw = await startGateway({ upstream: UPSTREAM, apiKeys: [SERVICE, ANON] });
  db = new PostgrestClient({ baseUrl: gw.url, serviceRoleKey: SERVICE, fetch });
  store = new SupabaseContentOsStore(db);
  tasks = new SupabaseOperationalTaskGateway(db);
});
after(async () => { await gw?.close(); cleanup(); });

const DEADLINE = "2026-10-20T13:00:00.000Z";
const status = (id) => sql(`select status from public.tasks where id = '${id}'`);
const create = (key, hash = "h1", assignee = ids.author) => tasks.createTaskIdempotent({ purpose: "CREATE_TASK", idempotencyKey: key, requestHash: createHash("sha256").update(hash).digest("hex"), creatorId: ids.head, assigneeId: assignee, title: "E2E blog ＃posting", description: "", priority: "normal", deadline: DEADLINE });

test("headers: apikey + Bearer service key, JSON content type, Prefer as documented; anon and wrong keys are refused", async () => {
  await store.getKnowledgeNode(ids.node);
  const last = gw.log.at(-1);
  assert.equal(last.path, "/rest/v1/content_knowledge_nodes");
  assert.equal(last.contentType, "application/json");
  const anon = new PostgrestClient({ baseUrl: gw.url, serviceRoleKey: ANON, fetch });
  await assert.rejects(() => anon.select("content_blogs", "id", {}), (e) => e instanceof PostgrestError && e.status === 401 && e.pgCode === "42501");
  const wrong = new PostgrestClient({ baseUrl: gw.url, serviceRoleKey: mintKey("service_role", "some-other-secret-that-is-at-least-32-chars"), fetch });
  await assert.rejects(() => wrong.select("content_blogs", "id", {}), (e) => e.status === 401, "gateway refuses an unknown apikey");
  assert.ok(!JSON.stringify(gw.log).includes(SERVICE), "the request log never holds the key");
});

test("SELECT: found row, empty result -> null, UUID filters, current pinned version", async () => {
  assert.deepEqual(await store.getKnowledgeNode(ids.node), { id: ids.node, problemPartId: "00000000-0000-4000-8000-0000000c0003", name: "Qaytgan tovar" });
  assert.equal(await store.getKnowledgeNode(randomUUID()), null);
  const blog = await store.currentTaskTypeVersion("BLOG");
  assert.deepEqual([blog.code, blog.version, blog.reviewRequired], ["BLOG", 1, false]);
  assert.equal(await store.currentTaskTypeVersion("NOPE_CODE"), null);
});

test("RPC content_os_create_task_idempotent: JSON arg names, created flag, retry, key reuse -> 409/23505, timestamp round-trip", async () => {
  const key = `e2e:${randomUUID()}`;
  const first = await create(key);
  assert.equal(first.created, true);
  assert.match(first.taskId, /^[0-9a-f-]{36}$/);
  const again = await create(key);
  assert.deepEqual(again, { taskId: first.taskId, created: false });
  await assert.rejects(() => create(key, "h2"), (e) => e instanceof PostgrestError && e.status === 409 && e.pgCode === "23505" && /IDEMPOTENCY_KEY_REUSED/.test(e.message));
  const [row] = rows(`select status, title, deadline = '${DEADLINE}'::timestamptz as deadline_ok, (select count(*) from public.task_checklists where task_id = t.id) as checklists from public.tasks t where id = '${first.taskId}'`);
  assert.deepEqual(row, { status: "IN_PROGRESS", title: "E2E blog ＃posting", deadline_ok: true, checklists: 0 });
  const rpc = gw.log.filter((e) => e.path === "/rest/v1/rpc/content_os_create_task_idempotent").at(-1);
  assert.deepEqual(Object.keys(JSON.parse(rpc.body)).sort(), ["p_assignee_id", "p_creator_id", "p_deadline", "p_description", "p_idempotency_key", "p_priority", "p_purpose", "p_request_hash", "p_title"]);
});

test("INSERT ignore-duplicates (Prefer resolution=ignore-duplicates) + read-back; conflicting duplicate surfaces", async () => {
  const blogId = randomUUID();
  const blog = { id: blogId, knowledgeNodeId: ids.node, title: "E2E Blog", sourceTaskId: null };
  assert.deepEqual(await store.ensureBlog(blog), blog);
  assert.deepEqual(await store.ensureBlog({ ...blog, title: "changed on retry" }), blog, "an existing row is left untouched");
  assert.equal(gw.log.filter((e) => e.path === "/rest/v1/content_blogs" && e.method === "POST").at(-1).prefer, "resolution=ignore-duplicates,return=minimal");
  const otherNode = sql(`insert into public.content_knowledge_nodes (problem_part_id, name) values ('00000000-0000-4000-8000-0000000c0003', 'node-${blogId}') returning id`).split("\n")[0];
  await assert.rejects(() => store.ensureBlog({ ...blog, knowledgeNodeId: otherNode }), PersistenceConflictError);
});

test("runtime + JSONB field_values + links: idempotent, second PRIMARY refused by the real index, PATCH of field_values only", async () => {
  const { taskId } = await create(`e2e:${randomUUID()}`);
  const blogId = randomUUID();
  await store.ensureBlog({ id: blogId, knowledgeNodeId: ids.node, title: "B", sourceTaskId: null });
  const version = await store.currentTaskTypeVersion("BLOG");
  const runtime = { taskId, taskTypeVersionId: version.id, workflowRunId: null, workflowTemplateVersionId: null, workflowStepId: null, sourceTaskId: null, outcome: null, skipReason: null, fieldValues: {} };
  assert.deepEqual(await store.ensureRuntime(runtime), runtime);
  assert.deepEqual(await store.ensureRuntime(runtime), runtime);

  const links = [{ taskId, entityType: "BLOG", entityId: blogId, relation: "PRIMARY" }, { taskId, entityType: "KNOWLEDGE_NODE", entityId: ids.node, relation: "RELATED" }];
  await store.ensureLinks(links);
  await store.ensureLinks(links);
  assert.equal(rows(`select * from public.content_task_links where task_id = '${taskId}'`).length, 2);
  // PostgREST's ignore-duplicates targets the PRIMARY KEY, so the partial one-PRIMARY index still raises 23505 -> 409.
  const secondBlog = randomUUID();
  await store.ensureBlog({ id: secondBlog, knowledgeNodeId: ids.node, title: "B2", sourceTaskId: null });
  await assert.rejects(() => store.ensureLinks([{ taskId, entityType: "BLOG", entityId: secondBlog, relation: "PRIMARY" }]), (e) => e instanceof PostgrestError && e.status === 409 && e.pgCode === "23505");
  // Same entity, different relation: PK duplicate is ignored, the read-back catches it.
  await assert.rejects(() => store.ensureLinks([{ taskId, entityType: "KNOWLEDGE_NODE", entityId: ids.node, relation: "PRIMARY" }]), PersistenceConflictError);

  await store.mergeFieldValues(taskId, { "review-decision": "Revision requested", "review-note": "Kirish — qisqaroq \"x\"", n: null });
  await store.mergeFieldValues(taskId, { "review-decision": null });
  assert.deepEqual((await store.getRuntime(taskId)).fieldValues, { "review-decision": null, "review-note": "Kirish — qisqaroq \"x\"", n: null });
  const patch = gw.log.filter((e) => e.method === "PATCH").at(-1);
  assert.deepEqual(Object.keys(JSON.parse(patch.body)), ["field_values"], "provenance columns are never sent");
  assert.equal(patch.query, `?task_id=eq.${taskId}`);
  await assert.rejects(() => db.patch("content_task_runtime", { source_task_id: randomUUID() }, { task_id: `eq.${taskId}` }), (e) => e instanceof PostgrestError && e.pgCode === "55000", "write-once provenance trigger");
});

test("transition RPC: composite row result; 42501 / 22023 refusals come back with their SQLSTATE", async () => {
  const { taskId } = await create(`e2e:${randomUUID()}`);
  await assert.rejects(() => tasks.transition(taskId, ids.former, "REVIEW"), (e) => e instanceof PostgrestError && e.pgCode === "42501" && e.status === 403, "inactive actor");
  await assert.rejects(() => tasks.transition(taskId, ids.author, "BLOCKED"), (e) => e instanceof PostgrestError && e.pgCode === "22023" && e.status === 400, "blocked reason required");
  const moved = await tasks.transition(taskId, ids.author, "REVIEW");
  assert.deepEqual(moved, { id: taskId, status: "REVIEW", assigneeId: ids.author, creatorId: ids.head });
  assert.deepEqual(await tasks.getTask(taskId), moved);
  assert.deepEqual(await tasks.transition(taskId, ids.author, "REVIEW"), moved, "same-status transition is a no-op");
  assert.equal(await tasks.getTask(randomUUID()), null);
  assert.deepEqual(await tasks.getActor(ids.former), { id: ids.former, role: "SMM_MANAGER", isActive: false });
});

test("a Task Bot 40001 refusal returns promptly and leaves no stuck transaction", async () => {
  const { taskId } = await create(`e2e:${randomUUID()}`);
  const timed = new PostgrestClient({ baseUrl: gw.url, serviceRoleKey: SERVICE, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3_000) }) });
  // Legacy task IN_PROGRESS -> DONE: the Task Bot raises 40001 ('task status changed concurrently').
  await assert.rejects(() => new SupabaseOperationalTaskGateway(timed).transition(taskId, ids.author, "DONE"), (e) => e?.name === "PostgrestError" && /task status changed concurrently/.test(e.message));
  const stuck = () => Number(sql("select count(*) from pg_stat_activity where usename = 'authenticator' and state <> 'idle' and query not like 'LISTEN%'"));
  assert.equal(stuck(), 0);
  assert.equal(status(taskId), "IN_PROGRESS");
});

test("external identity resolution over HTTP: provider + tenant + ACTIVE link + active user; URL-encoded subjects", async () => {
  const resolver = new SupabaseExternalActorResolver(db, "site-e2e");
  assert.equal(await resolver.resolve("siwc-author"), ids.author);
  assert.equal(await resolver.resolve("siwc-head"), ids.head);
  assert.equal(await resolver.resolve("siwc/odd,subject (x)&y=z"), ids.other, "reserved characters survive URL encoding");
  for (const subject of ["siwc-unknown", "siwc-revoked", "siwc-other-tenant", "siwc-former", "SIWC-AUTHOR", " siwc-author", "siwc-author*", "*"]) {
    await assert.rejects(() => resolver.resolve(subject), (e) => e.code === "EXTERNAL_IDENTITY_NOT_LINKED", subject);
  }
  assert.equal(await new SupabaseExternalActorResolver(db, "site-other").resolve("siwc-other-tenant"), ids.other, "the same subject resolves only in its own tenant");
  await assert.rejects(() => new SupabaseExternalActorResolver(db, "site-e2e").resolve(""), (e) => e.code === "EXTERNAL_IDENTITY_NOT_LINKED");
  // Wrong provider cannot even be stored (CHECK provider = 'OPENAI_SIWC'); the resolver also filters by it.
  assert.throws(() => sql(`insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by) values ('OTHER_IDP', 'site-e2e', 'x', '${ids.other}', '${ids.head}')`), /check constraint/);
  assert.match(gw.log.filter((e) => e.path === "/rest/v1/external_identity_links").at(-1).query, /provider=eq\.OPENAI_SIWC/);
});
