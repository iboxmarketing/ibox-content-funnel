/**
 * Sprint 9B vertical slice: Knowledge Node -> Blog -> Head Review ->
 * revision of the SAME Blog -> corrected Blog, with persisted provenance. Uses the in-memory adapters (same invariants as the schema)
 * and a recording fake fetch for the PostgREST adapter. No network, no
 * credentials, no database.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-blog-review-lineage-"));
mkdirSync(join(dir, "persistence"));
const compile = (from, to) => writeFileSync(to, ts.transpileModule(readFileSync(new URL(from, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
for (const name of ["content-entity"]) compile(`../lib/${name}.ts`, join(dir, `${name}.js`));
for (const name of ["task-type-codes", "ports", "idempotency", "transition-contract", "memory-adapter", "supabase-adapter", "blog-review-flow", "index"]) {
  compile(`../lib/persistence/${name}.ts`, join(dir, "persistence", `${name}.js`));
}
const require = createRequire(import.meta.url);
const codes = require(join(dir, "persistence", "task-type-codes.js"));
const contract = require(join(dir, "persistence", "transition-contract.js"));
const { InMemoryContentOsStore, InMemoryOperationalTaskGateway } = require(join(dir, "persistence", "memory-adapter.js"));
const { BlogReviewFlow } = require(join(dir, "persistence", "blog-review-flow.js"));
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
  return { store, tasks, node, versions, flow: new BlogReviewFlow(store, tasks) };
}

async function blogThroughHeadReview(w, requestKey = "req-blog-1") {
  const blog = await w.flow.startBlog({ requestKey, knowledgeNodeId: w.node.id, blogTitle: "Qaytgan tovar nega qoldiqni buzadi", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  const review = await w.flow.completeBlog({ blogTaskId: blog.blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE });
  return { ...blog, reviewTaskId: review.headReviewTaskId, review };
}

/** A Content OS task attached directly (e.g. a Research or SEO task). */
async function attach(w, version, { source = null, primary = null, status = "IN_PROGRESS", assignee = AUTHOR } = {}) {
  const { taskId } = await w.tasks.createTaskIdempotent({ purpose: "CREATE_TASK", idempotencyKey: `raw-${Math.random()}`, requestHash: "0".repeat(64), creatorId: HEAD, assigneeId: assignee, title: "x", description: "", priority: "normal", deadline: DEADLINE });
  await w.store.ensureRuntime({ taskId, taskTypeVersionId: version.id, workflowRunId: null, workflowTemplateVersionId: null, workflowStepId: null, sourceTaskId: source, outcome: null, skipReason: null, fieldValues: {} });
  if (primary) await w.store.ensureLinks([{ taskId, ...primary, relation: "PRIMARY" }]);
  w.tasks.tasks.get(taskId).status = status;
  return taskId;
}

// --- vertical slice ---------------------------------------------------------------

test("the TypeScript contract uses the same stable codes as the SQL predicates (migration 06)", () => {
  assert.equal(codes.BLOG_TASK_TYPE_CODE, "BLOG");
  assert.equal(codes.HEAD_REVIEW_TASK_TYPE_CODE, "HEAD_REVIEW");
  const sql = readFileSync(new URL("../supabase/content-os-drafts/migrations/20261014130000_content_os_06_transition_contract.sql", import.meta.url), "utf8");
  assert.match(sql, /review_type\.code = 'HEAD_REVIEW'/);
  assert.match(sql, /target_type\.code = 'BLOG'/);
  assert.match(sql, /review_task\.status = 'IN_PROGRESS'/);
});

test("1. startBlog: Blog entity + one operational task + pinned runtime + PRIMARY BLOG / RELATED KNOWLEDGE_NODE links", async () => {
  const w = world();
  const { blogTaskId, blogId, created } = await w.flow.startBlog({ requestKey: "req-1", knowledgeNodeId: w.node.id, blogTitle: "Blog A", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  assert.equal(created, true);
  assert.equal((await w.store.getBlog(blogId)).knowledgeNodeId, w.node.id);
  assert.equal((await w.store.getRuntime(blogTaskId)).taskTypeVersionId, w.versions.blog.id);
  const links = await w.store.linksForTask(blogTaskId);
  assert.deepEqual(links.map((l) => [l.entityType, l.relation]).sort(), [["BLOG", "PRIMARY"], ["KNOWLEDGE_NODE", "RELATED"]]);
  assert.equal(links.find((l) => l.relation === "PRIMARY").entityId, blogId);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "IN_PROGRESS", "Task Bot autostart");
});

test("startBlog is retry-safe: same request key -> same task, same Blog entity, nothing duplicated", async () => {
  const w = world();
  const input = { requestKey: "req-retry", knowledgeNodeId: w.node.id, blogTitle: "Blog A", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE };
  const first = await w.flow.startBlog(input);
  const second = await w.flow.startBlog(input);
  assert.deepEqual([second.blogTaskId, second.blogId, second.created], [first.blogTaskId, first.blogId, false]);
  assert.equal(w.tasks.tasks.size, 1);
  assert.equal(w.store.blogs.size, 1);
  assert.equal(w.store.links.length, 2);
  await assert.rejects(() => w.flow.startBlog({ ...input, assigneeId: OTHER }), /IDEMPOTENCY_KEY_REUSED/, "same key + different request conflicts");
});

test("2. completeBlog: Blog DONE directly; Head Review references exactly its source Blog task and the same Blog entity", async () => {
  const w = world();
  const { blogTaskId, blogId, reviewTaskId, review } = await blogThroughHeadReview(w);
  assert.equal(review.headReviewCreated, true);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "DONE");
  const runtime = await w.store.getRuntime(reviewTaskId);
  assert.equal(runtime.sourceTaskId, blogTaskId);
  assert.equal(runtime.taskTypeVersionId, w.versions.headReview.id);
  const primary = (await w.store.linksForTask(reviewTaskId)).find((l) => l.relation === "PRIMARY");
  assert.deepEqual([primary.entityType, primary.entityId], ["BLOG", blogId]);
  const blogFacts = await contract.loadContentOsTaskFacts(blogTaskId, w.store, w.tasks);
  const reviewFacts = await contract.loadContentOsTaskFacts(reviewTaskId, w.store, w.tasks);
  assert.equal(contract.isSourceBlogForHeadReview(blogFacts, reviewFacts), true);
  assert.equal(contract.isSourceBlogForHeadReview(reviewFacts, blogFacts), false, "directional");
});

test("3. unrelated Content OS DONE tasks cannot be sent to REVISION (Research, SEO, a Blog without its own Head Review)", async () => {
  const w = world();
  const { blogTaskId, blogId, reviewTaskId } = await blogThroughHeadReview(w);
  const research = await attach(w, w.versions.research, { status: "DONE", primary: { entityType: "KNOWLEDGE_NODE", entityId: w.node.id } });
  const seo = await attach(w, w.versions.seo, { source: blogTaskId, status: "DONE", primary: { entityType: "BLOG", entityId: blogId } });
  const lonelyBlog = await w.flow.startBlog({ requestKey: "req-lonely", knowledgeNodeId: w.node.id, blogTitle: "Blog B", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  await w.tasks.transition(lonelyBlog.blogTaskId, AUTHOR, "DONE");
  for (const target of [research, seo, lonelyBlog.blogTaskId]) {
    await assert.rejects(() => w.tasks.transition(target, HEAD, "REVISION", "x"), /no Head Review/, target);
    assert.equal((await w.tasks.getTask(target)).status, "DONE");
  }
  // The SEO task (same source, same Blog entity) is not a reviewer either.
  const seoFacts = await contract.loadContentOsTaskFacts(seo, w.store, w.tasks);
  const blogFacts = await contract.loadContentOsTaskFacts(blogTaskId, w.store, w.tasks);
  assert.equal(contract.isSourceBlogForHeadReview(blogFacts, seoFacts), false);
  assert.equal((await w.tasks.getTask(reviewTaskId)).status, "IN_PROGRESS");
});

test("4. the wrong reviewer cannot request the revision (unrelated member, the Blog author, an inactive assignee)", async () => {
  const w = world();
  const { reviewTaskId, blogTaskId } = await blogThroughHeadReview(w);
  for (const actorId of [OTHER, AUTHOR]) {
    await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId, note: "x" }), /may not send this Blog back/);
    await assert.rejects(() => w.tasks.transition(blogTaskId, actorId, "REVISION", "x"), /no Head Review/);
  }
  w.tasks.actors.set(REVIEWER, { id: REVIEWER, role: "DIGITAL_MARKETER", isActive: false });
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "x" }), /may not send this Blog back/);
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "DONE");
});

test("5-7. correct Head Review sends the SAME Blog to REVISION; resubmission reuses the Head Review and creates nothing", async () => {
  const w = world();
  const { blogTaskId, blogId, reviewTaskId } = await blogThroughHeadReview(w);
  const tasksBefore = w.tasks.tasks.size;

  const { blogTaskId: revised } = await w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "Kirishni qisqartiring" });
  assert.equal(revised, blogTaskId, "the SAME Blog task");
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "REVISION");
  assert.equal((await w.tasks.getTask(reviewTaskId)).status, "IN_PROGRESS", "Head Review waits (derived from the Blog's status)");
  assert.deepEqual((await w.store.getRuntime(reviewTaskId)).fieldValues, { "review-decision": "Revision requested", "review-note": "Kirishni qisqartiring" });
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: REVIEWER, note: "again" }), /may not send this Blog back/, "no second revision while in REVISION");
  await assert.rejects(() => w.flow.approve({ reviewTaskId, actorId: REVIEWER }), /only while its source Blog is DONE/);

  const resubmitted = await w.flow.completeBlog({ blogTaskId, actorId: AUTHOR, reviewerId: OTHER, reviewDeadline: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(resubmitted, { headReviewTaskId: reviewTaskId, headReviewCreated: false }, "same Head Review reused");
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "DONE");
  assert.equal(w.tasks.tasks.size, tasksBefore, "no new Blog or Head Review task");
  assert.equal(w.store.blogs.size, 1);
  assert.deepEqual(w.tasks.transitions.filter((t) => t.taskId === blogTaskId).map((t) => `${t.from}->${t.to}`), ["IN_PROGRESS->DONE", "DONE->REVISION", "REVISION->DONE"]);
  assert.equal((await w.store.linksForTask(reviewTaskId)).find((l) => l.relation === "PRIMARY").entityId, blogId);

  await w.flow.approve({ reviewTaskId, actorId: REVIEWER, note: "OK" });
  assert.equal((await w.tasks.getTask(reviewTaskId)).status, "DONE");
  await assert.rejects(() => w.flow.requestRevision({ reviewTaskId, actorId: HEAD, note: "late" }), /may not send this Blog back/, "a completed review cannot reopen the Blog");
});

test("the active Head may decide on any Head Review; the Head Review cannot be re-pointed", async () => {
  const w = world();
  const { reviewTaskId, blogTaskId } = await blogThroughHeadReview(w);
  await w.flow.requestRevision({ reviewTaskId, actorId: HEAD, note: "Head decision" });
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "REVISION");
  const kept = await w.store.ensureRuntime({ ...(await w.store.getRuntime(reviewTaskId)), sourceTaskId: "99999999-0000-4000-8000-000000000000" });
  assert.equal(kept.sourceTaskId, blogTaskId, "provenance is write-once");
});

test("8. pinned config survives newer Task Type versions", async () => {
  const w = world();
  const { blogTaskId } = await w.flow.startBlog({ requestKey: "req-pin", knowledgeNodeId: w.node.id, blogTitle: "Pinned", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  const v2 = w.store.addTaskTypeVersion("BLOG", 2, true);
  assert.equal((await w.store.currentTaskTypeVersion("BLOG")).id, v2.id);
  assert.equal((await w.store.getRuntime(blogTaskId)).taskTypeVersionId, w.versions.blog.id);
  assert.equal((await contract.loadContentOsTaskFacts(blogTaskId, w.store, w.tasks)).requiresReview, false);
  await w.flow.completeBlog({ blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE });
  assert.equal((await w.tasks.getTask(blogTaskId)).status, "DONE", "completes directly under its pinned v1 rule");

  const newBlog = await w.flow.startBlog({ requestKey: "req-pin-2", knowledgeNodeId: w.node.id, blogTitle: "On v2", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  assert.equal((await w.store.getRuntime(newBlog.blogTaskId)).taskTypeVersionId, v2.id);
  await assert.rejects(() => w.flow.completeBlog({ blogTaskId: newBlog.blogTaskId, actorId: AUTHOR, reviewerId: REVIEWER, reviewDeadline: DEADLINE }), /review-required/);
  await assert.rejects(() => w.tasks.transition(newBlog.blogTaskId, AUTHOR, "DONE"), /changed concurrently/, "the gateway enforces REVIEW too");
  assert.throws(() => w.store.addTaskTypeVersion("BLOG", 2, false), /immutable/);
});

test("9. malformed review config on the pinned workflow step fails safe (direct DONE refused)", async () => {
  const w = world();
  const step = w.store.addWorkflowStep("wf-version-1", { reviewRequired: "no" });
  const taskId = await attach(w, w.versions.blog, { primary: null });
  w.store.runtimes.set(taskId, { ...(await w.store.getRuntime(taskId)), workflowRunId: "run-1", workflowTemplateVersionId: "wf-version-1", workflowStepId: step.id });
  assert.equal((await contract.loadContentOsTaskFacts(taskId, w.store, w.tasks)).requiresReview, true);
  await assert.rejects(() => w.tasks.transition(taskId, AUTHOR, "DONE"), /changed concurrently/);
  assert.equal((await w.tasks.transition(taskId, AUTHOR, "REVIEW")).status, "REVIEW", "the REVIEW path stays open");
});

test("links stay insert-only with one PRIMARY per task; entities must exist", async () => {
  const w = world();
  const { blogTaskId } = await w.flow.startBlog({ requestKey: "req-links", knowledgeNodeId: w.node.id, blogTitle: "Links", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  await assert.rejects(() => w.store.ensureLinks([{ taskId: blogTaskId, entityType: "KNOWLEDGE_NODE", entityId: w.node.id, relation: "PRIMARY" }]), /relation cannot change|PRIMARY/);
  await assert.rejects(() => w.store.ensureLinks([{ taskId: blogTaskId, entityType: "BLOG", entityId: "33333333-0000-4000-8000-000000000000", relation: "RELATED" }]), /does not exist/);
});

// --- idempotency helpers ----------------------------------------------------------------

test("a Content OS title containing #posting never reaches the Task Bot raw", async () => {
  const w = world();
  const { blogTaskId } = await w.flow.startBlog({ requestKey: "req-posting", knowledgeNodeId: w.node.id, blogTitle: "Why #posting matters", creatorId: HEAD, assigneeId: AUTHOR, deadline: DEADLINE });
  assert.equal(w.tasks.tasks.get(blogTaskId).title.includes("#posting"), false);
});
