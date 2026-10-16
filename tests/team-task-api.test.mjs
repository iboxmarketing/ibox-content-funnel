/**
 * Content OS team-task API + server capability policy (Sprint 10B surface,
 * Sprint 10D workflow rules). The Task Bot client and provenance classifier
 * are fakes; what is asserted is what Content OS presents and forwards.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "ibox-team-task-api-"));
mkdirSync(join(dir, "persistence"));
symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(dir, "node_modules"), "dir");
for (const name of ["team-task-api", "team-task-policy", "workflow-classifier"]) {
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
}
const { TeamTaskMutationSchema, readTeamTasks, mutateTeamTask } = require(join(dir, "team-task-api.js"));
const { computeTaskCapabilities, TaskPolicyError } = require(join(dir, "team-task-policy.js"));
const { SupabaseWorkflowClassifier } = require(join(dir, "workflow-classifier.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = { id: "44444444-4444-4444-8444-444444444444", role: "HEAD_OF_MARKETING" };
const CREATOR = { id: "11111111-1111-4111-8111-111111111111", role: "CONTENT_MARKETER" };
const ASSIGNEE = { id: "22222222-2222-4222-8222-222222222222", role: "OPERATOR_VIDEO_EDITOR" };
const OTHER = { id: "33333333-3333-4333-8333-333333333333", role: "DIGITAL_MARKETER" };
const AUTHOR = { id: "55555555-5555-4555-8555-555555555555", role: "CONTENT_MARKETER" };
const REVIEWER = { id: "66666666-6666-4666-8666-666666666666", role: "DIGITAL_MARKETER" };
const MANUAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BLOG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DEADLINE = "2026-11-01T09:00:00.000Z";

const task = (id, creatorId, assigneeId, status = "IN_PROGRESS") => ({ id, title: "t", description: null, priority: "normal", status, assigneeId, creatorId, deadline: DEADLINE, blockedReason: null, completedAt: null, cancelledAt: null, createdAt: DEADLINE, updatedAt: DEADLINE, contentRef: null });

/** World: a manual task, and a Blog (commissioned by Head, written by AUTHOR) whose Head Review was created
 * the pre-10D way (creator = AUTHOR) and is assigned to REVIEWER. */
function world({ hrCreator = AUTHOR.id, blogStatus = "DONE", hrStatus = "IN_PROGRESS", archived = [] } = {}) {
  const tasks = new Map([
    [MANUAL, task(MANUAL, CREATOR.id, ASSIGNEE.id)],
    [BLOG, task(BLOG, HEAD.id, AUTHOR.id, blogStatus)],
    [HR, task(HR, hrCreator, REVIEWER.id, hrStatus)],
  ]);
  const calls = [];
  const pending = { deadlineRequests: [], reassignRequests: [] };
  const client = new Proxy({}, {
    get(_t, name) {
      return async (...args) => {
        if (name === "getDetails") {
          const t = tasks.get(args[0]);
          return { task: t, archive: archived.includes(args[0]) ? { taskId: args[0], archivedAt: DEADLINE, archivedBy: HEAD.id, reason: null } : null, events: [], deadlineRequests: [], reassignRequests: [] };
        }
        if (name === "listTasks") return [...tasks.values()];
        if (name === "listChangeRequests") return pending;
        calls.push([name, ...args]);
        return name === "archive" ? undefined : { source: name };
      };
    },
  });
  const classifier = { classify: async (ids) => new Map(ids.map((id) => [id, id === BLOG
    ? { kind: "CONTENT_OS", code: "BLOG", sourceTaskId: null, blogAuthorId: tasks.get(BLOG).assigneeId, sourceStatus: null, reviewerId: tasks.get(HR).assigneeId }
    : id === HR
      ? { kind: "CONTENT_OS", code: "HEAD_REVIEW", sourceTaskId: BLOG, blogAuthorId: tasks.get(BLOG).assigneeId, sourceStatus: tasks.get(BLOG).status, reviewerId: null }
      : { kind: "MANUAL" }])) };
  const ctx = (actor, workflowApiEnabled = true) => ({ actor, classifier, workflowApiEnabled });
  return { tasks, calls, client, ctx, pending };
}

const forwarded = async (w, body, actor) => { await mutateTeamTask(body, w.client, w.ctx(actor)); return w.calls.at(-1); };
const refused = async (w, body, actor, status, code) => {
  const before = w.calls.length;
  await assert.rejects(() => mutateTeamTask(body, w.client, w.ctx(actor)), (e) => e instanceof TaskPolicyError && e.status === status && (!code || e.code === code), JSON.stringify(body));
  assert.equal(w.calls.length, before, "nothing forwarded to the Task Bot");
};

// --- MANUAL tasks keep the approved Sprint 10B rules -----------------------------------------------

test("manual tasks: creator/Head direct management, assignee requests, unrelated read-only (unchanged 10B rules)", async () => {
  const w = world();
  for (const actor of [CREATOR, HEAD]) {
    assert.deepEqual(await forwarded(w, { action: "edit", taskId: MANUAL, title: "x", description: null, priority: "low" }, actor), ["editTask", MANUAL, { title: "x", description: null, priority: "low" }]);
    assert.deepEqual(await forwarded(w, { action: "direct-reassign", taskId: MANUAL, assigneeId: OTHER.id }, actor), ["directReassign", MANUAL, OTHER.id]);
    assert.deepEqual(await forwarded(w, { action: "direct-deadline", taskId: MANUAL, deadline: DEADLINE }, actor), ["directDeadline", MANUAL, DEADLINE]);
    assert.deepEqual(await forwarded(w, { action: "lifecycle", taskId: MANUAL, taskAction: "CANCEL", reason: "x" }, actor), ["action", MANUAL, "CANCEL", "x"]);
  }
  assert.deepEqual(await forwarded(w, { action: "request-deadline", taskId: MANUAL, requestedDeadline: DEADLINE, reason: "r" }, ASSIGNEE), ["requestDeadline", MANUAL, DEADLINE, "r"]);
  assert.deepEqual(await forwarded(w, { action: "lifecycle", taskId: MANUAL, taskAction: "SUBMIT_REVIEW" }, ASSIGNEE), ["action", MANUAL, "SUBMIT_REVIEW", undefined]);
  await refused(w, { action: "direct-reassign", taskId: MANUAL, assigneeId: OTHER.id }, ASSIGNEE, 403);
  for (const body of [{ action: "edit", taskId: MANUAL, title: "x", description: null, priority: "low" }, { action: "direct-deadline", taskId: MANUAL, deadline: DEADLINE }, { action: "request-deadline", taskId: MANUAL, requestedDeadline: DEADLINE, reason: "r" }, { action: "lifecycle", taskId: MANUAL, taskAction: "CANCEL", reason: "x" }, { action: "archive", taskId: MANUAL }]) {
    await refused(w, body, OTHER, 403);
  }
  assert.deepEqual(await forwarded(w, { action: "archive", taskId: MANUAL, reason: "done" }, HEAD), ["archive", MANUAL, "done"]);
  await refused(w, { action: "archive", taskId: MANUAL }, CREATOR, 403);
  assert.deepEqual(await forwarded(w, { action: "create", title: "t", priority: "high", assigneeId: OTHER.id, deadline: DEADLINE }, OTHER), ["create", { title: "t", priority: "high", assigneeId: OTHER.id, creatorId: OTHER.id, deadline: DEADLINE }]);
});

// --- HIGH regression: the Blog author can no longer take over / approve their own Head Review -------

test("HIGH: Blog author (creator of a legacy Head Review) cannot reassign, re-date, edit, cancel or generically approve it", async () => {
  const w = world({ hrCreator: AUTHOR.id });
  await refused(w, { action: "direct-reassign", taskId: HR, assigneeId: AUTHOR.id }, AUTHOR, 403);
  await refused(w, { action: "direct-deadline", taskId: HR, deadline: DEADLINE }, AUTHOR, 403);
  await refused(w, { action: "edit", taskId: HR, title: "x", description: null, priority: "low" }, AUTHOR, 403);
  for (const taskAction of ["SUBMIT_REVIEW", "APPROVE", "CANCEL", "ACCEPT"]) {
    await refused(w, { action: "lifecycle", taskId: HR, taskAction, reason: "x" }, AUTHOR, 409, "WORKFLOW_TASK");
  }
  const caps = computeTaskCapabilities(AUTHOR, w.tasks.get(HR), false, (await w.ctx(AUTHOR).classifier.classify([HR])).get(HR), { workflowApiEnabled: true });
  assert.deepEqual([caps.canEdit, caps.canDirectReassign, caps.canDirectDeadline, caps.lifecycleActions, caps.workflowActions], [false, false, false, [], []], "no self-approve controls are presented");
});

test("HIGH: nobody — Head included — can make the Blog's author its reviewer, or the reviewer its author", async () => {
  const w = world();
  await refused(w, { action: "direct-reassign", taskId: HR, assigneeId: AUTHOR.id }, HEAD, 409, "WORKFLOW_INDEPENDENCE");
  await refused(world({ blogStatus: "REVISION" }), { action: "direct-reassign", taskId: BLOG, assigneeId: REVIEWER.id }, HEAD, 409, "WORKFLOW_INDEPENDENCE");
  assert.deepEqual(await forwarded(w, { action: "direct-reassign", taskId: HR, assigneeId: OTHER.id }, HEAD), ["directReassign", HR, OTHER.id], "Head may hand the review to another independent reviewer");
  await refused(w, { action: "request-reassign", taskId: HR, requestedAssigneeId: AUTHOR.id, reason: "r" }, REVIEWER, 409, "WORKFLOW_INDEPENDENCE");
  w.pending.reassignRequests.push({ id: REQUEST, taskId: HR, requestedAssigneeId: AUTHOR.id, status: "PENDING" });
  await refused(w, { action: "resolve-reassign", requestId: REQUEST, approve: true }, HEAD, 409, "WORKFLOW_INDEPENDENCE");
  assert.deepEqual(await forwarded(w, { action: "resolve-reassign", requestId: REQUEST, approve: false }, HEAD), ["resolveReassign", REQUEST, false, undefined], "rejecting is always possible");
});

test("HIGH: a BLOG cannot be completed (or cancelled / approved) through the generic lifecycle path", async () => {
  const w = world({ blogStatus: "IN_PROGRESS" });
  for (const [actor, taskAction] of [[AUTHOR, "SUBMIT_REVIEW"], [HEAD, "APPROVE"], [HEAD, "CANCEL"], [AUTHOR, "BLOCK"]]) {
    await refused(w, { action: "lifecycle", taskId: BLOG, taskAction, reason: "x" }, actor, 409, "WORKFLOW_TASK");
  }
  const caps = computeTaskCapabilities(AUTHOR, w.tasks.get(BLOG), false, (await w.ctx(AUTHOR).classifier.classify([BLOG])).get(BLOG), { workflowApiEnabled: true });
  assert.deepEqual([caps.lifecycleActions, caps.workflowActions], [[], ["COMPLETE_BLOG"]], "the only completion path offered is BlogReviewFlow");
});

test("workflow capabilities come from authoritative state: reviewer decides, Head may send back, Head-as-author may not", async () => {
  const w = world();
  const cls = (await w.ctx(HEAD).classifier.classify([HR])).get(HR);
  const caps = (actor, status = "IN_PROGRESS") => computeTaskCapabilities(actor, { ...w.tasks.get(HR), status }, false, cls, { workflowApiEnabled: true });
  assert.deepEqual(caps(REVIEWER).workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"]);
  assert.deepEqual(caps(REVIEWER, "ASSIGNED").workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"], "pick-up happens inside the workflow action");
  assert.deepEqual(caps(REVIEWER, "BLOCKED").workflowActions, [], "parked while the Blog is in revision");
  assert.deepEqual(caps(HEAD).workflowActions, ["REVIEW_REQUEST_REVISION"], "only the reviewer approves");
  assert.deepEqual(caps(OTHER).workflowActions, []);
  assert.deepEqual(caps(REVIEWER).lifecycleActions, [], "no generic lifecycle on workflow tasks");
  const headAuthor = { kind: "CONTENT_OS", code: "HEAD_REVIEW", sourceTaskId: BLOG, blogAuthorId: HEAD.id, sourceStatus: "DONE", reviewerId: null };
  assert.deepEqual(computeTaskCapabilities(HEAD, w.tasks.get(HR), false, headAuthor, { workflowApiEnabled: true }).workflowActions, [], "Head never decides the review of their own Blog");
  const blogInRevision = { ...cls, sourceStatus: "REVISION" };
  assert.deepEqual(computeTaskCapabilities(REVIEWER, w.tasks.get(HR), false, blogInRevision, { workflowApiEnabled: true }).workflowActions, []);
  assert.deepEqual(computeTaskCapabilities(REVIEWER, w.tasks.get(HR), false, cls, { workflowApiEnabled: false }).workflowActions, [], "no workflow actions when the workflow API is not configured");
});

test("archived tasks: read-only, Head restore only; archive goes to the Task Bot (which owns the active-pair guard)", async () => {
  const w = world({ archived: [MANUAL] });
  await refused(w, { action: "edit", taskId: MANUAL, title: "x", description: null, priority: "low" }, CREATOR, 403);
  await refused(w, { action: "lifecycle", taskId: MANUAL, taskAction: "SUBMIT_REVIEW" }, ASSIGNEE, 403);
  await refused(w, { action: "archive", taskId: MANUAL }, HEAD, 403);
  await refused(w, { action: "restore", taskId: MANUAL }, CREATOR, 403);
  assert.deepEqual(await forwarded(w, { action: "restore", taskId: MANUAL }, HEAD), ["restore", MANUAL]);
  const fresh = world();
  assert.deepEqual(await forwarded(fresh, { action: "archive", taskId: HR }, HEAD), ["archive", HR, undefined], "Content OS does not decide the active-pair rule locally");
});

test("read surface returns server-computed capabilities with every task and detail", async () => {
  const w = world();
  const list = await readTeamTasks(new URLSearchParams("resource=tasks&scope=all"), w.client, w.ctx(AUTHOR));
  const hr = list.tasks.find((t) => t.id === HR);
  assert.equal(hr.capabilities.classification.code, "HEAD_REVIEW");
  assert.equal(hr.capabilities.canDirectReassign, false);
  const detail = await readTeamTasks(new URLSearchParams(`resource=task&taskId=${MANUAL}`), w.client, w.ctx(CREATOR));
  assert.equal(detail.capabilities.canDirectReassign, true);
  await assert.rejects(() => readTeamTasks(new URLSearchParams("resource=admin"), w.client, w.ctx(HEAD)));
  await assert.rejects(() => readTeamTasks(new URLSearchParams("resource=task&taskId=nope"), w.client, w.ctx(HEAD)));
});

test("strict mutation schema: no actor id, no extra fields, no malformed ids", () => {
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "restore", taskId: MANUAL, hardDelete: true }).success, false);
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "direct-reassign", taskId: MANUAL, assigneeId: "not-a-user" }).success, false);
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "edit", taskId: MANUAL, title: "x", description: null, priority: "low", actorId: HEAD.id }).success, false);
  assert.equal(TeamTaskMutationSchema.safeParse({ action: "create", title: "x", priority: "low", assigneeId: OTHER.id, deadline: DEADLINE, creatorId: HEAD.id }).success, false);
});

test("classifier: persisted provenance (runtime row + pinned code + lineage), never titles; MANUAL otherwise", async () => {
  const rows = {
    content_task_runtime: [{ task_id: BLOG, task_type_version_id: "0b0b0b0b-0000-4000-8000-000000000001", source_task_id: null }, { task_id: HR, task_type_version_id: "0b0b0b0b-0000-4000-8000-000000000002", source_task_id: BLOG }],
    content_task_type_versions: [{ id: "0b0b0b0b-0000-4000-8000-000000000001", task_type_id: "0c0c0c0c-0000-4000-8000-000000000001" }, { id: "0b0b0b0b-0000-4000-8000-000000000002", task_type_id: "0c0c0c0c-0000-4000-8000-000000000002" }],
    content_task_types: [{ id: "0c0c0c0c-0000-4000-8000-000000000001", code: "BLOG" }, { id: "0c0c0c0c-0000-4000-8000-000000000002", code: "HEAD_REVIEW" }],
    tasks: [{ id: BLOG, assignee_id: AUTHOR.id, status: "DONE" }, { id: HR, assignee_id: REVIEWER.id, status: "IN_PROGRESS" }],
  };
  const queries = [];
  const db = { select: async (table, columns, filters) => {
    queries.push([table, filters]);
    const [column, op] = Object.entries(filters)[0];
    const ids = op.slice(4, -1).split(",");
    return rows[table].filter((row) => ids.includes(String(row[column])));
  } };
  const result = await new SupabaseWorkflowClassifier(db).classify([MANUAL, BLOG, HR]);
  assert.deepEqual(result.get(MANUAL), { kind: "MANUAL" });
  assert.deepEqual(result.get(BLOG), { kind: "CONTENT_OS", code: "BLOG", sourceTaskId: null, blogAuthorId: AUTHOR.id, sourceStatus: null, reviewerId: REVIEWER.id });
  assert.deepEqual(result.get(HR), { kind: "CONTENT_OS", code: "HEAD_REVIEW", sourceTaskId: BLOG, blogAuthorId: AUTHOR.id, sourceStatus: "DONE", reviewerId: null });
  assert.ok(queries.every(([, filters]) => !Object.keys(filters).includes("title")));
  await assert.rejects(() => new SupabaseWorkflowClassifier({ select: async () => { throw new Error("down"); } }).classify([BLOG]), /down/, "fails closed");
});

// --- Sprint 10E-FIX: final owner decision — assigned-reviewer-only approval -----------------------

test("10E review matrix (server capabilities): approval only by the assigned reviewer; the Blog author never decides, Head included", async () => {
  const w = world();
  const hr = w.tasks.get(HR);
  const cls = (blogAuthorId, sourceStatus = "DONE") => ({ kind: "CONTENT_OS", code: "HEAD_REVIEW", sourceTaskId: BLOG, blogAuthorId, sourceStatus, reviewerId: null });
  const caps = (actor, { assignee = REVIEWER.id, author = AUTHOR.id, status = "IN_PROGRESS" } = {}) =>
    computeTaskCapabilities(actor, { ...hr, assigneeId: assignee, status }, false, cls(author), { workflowApiEnabled: true });

  // Ordinary Blog author: nothing.
  assert.deepEqual(caps(AUTHOR).workflowActions, []);
  assert.deepEqual([caps(AUTHOR).canDirectReassign, caps(AUTHOR).canEdit, caps(AUTHOR).lifecycleActions], [false, false, []], "no creator controls on the Head Review");
  // Assigned reviewer: pick-up (inside approve/revision), revision, approve.
  assert.deepEqual(caps(REVIEWER).workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"]);
  assert.deepEqual(caps(REVIEWER, { status: "ASSIGNED" }).workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"]);
  // Head, not author, not assigned: supervisory revision + reassignment, NO approval.
  assert.deepEqual(caps(HEAD).workflowActions, ["REVIEW_REQUEST_REVISION"]);
  assert.equal(caps(HEAD).canDirectReassign, true);
  assert.deepEqual(caps(HEAD).forbiddenAssigneeIds, [AUTHOR.id], "Head can reassign, never to the author");
  // Head, not author, IS the assigned reviewer: may approve.
  assert.deepEqual(caps(HEAD, { assignee: HEAD.id }).workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"]);
  // Head who wrote the Blog: may assign another reviewer, may not review / approve / request revision.
  const headAuthor = caps(HEAD, { author: HEAD.id });
  assert.deepEqual(headAuthor.workflowActions, []);
  assert.equal(headAuthor.canDirectReassign, true, "administrative reassignment stays");
  assert.deepEqual(headAuthor.forbiddenAssigneeIds, [HEAD.id], "…but never to themselves");
  assert.deepEqual(caps(HEAD, { author: HEAD.id, assignee: HEAD.id }).workflowActions, [], "even a (legacy) self-assigned Head-author decides nothing");
  // Other user: read only.
  assert.deepEqual([caps(OTHER).workflowActions, caps(OTHER).canEdit, caps(OTHER).canDirectReassign, caps(OTHER).lifecycleActions], [[], false, false, []]);
});

test("10E review matrix (API): Head-author cannot hand the review to themselves; Head may hand it to an independent reviewer", async () => {
  const w = world();
  w.tasks.set(BLOG, { ...w.tasks.get(BLOG), assigneeId: HEAD.id, status: "DONE" });
  await refused(w, { action: "direct-reassign", taskId: HR, assigneeId: HEAD.id }, HEAD, 409, "WORKFLOW_INDEPENDENCE");
  assert.deepEqual(await forwarded(w, { action: "direct-reassign", taskId: HR, assigneeId: OTHER.id }, HEAD), ["directReassign", HR, OTHER.id]);
  await refused(w, { action: "lifecycle", taskId: HR, taskAction: "APPROVE" }, HEAD, 409, "WORKFLOW_TASK");
});

test("11B: capability matrix on an ASSIGNED review follows the frozen Task Bot (Head supervises only after pick-up)", () => {
  const w = world();
  const cls = { kind: "CONTENT_OS", code: "HEAD_REVIEW", sourceTaskId: BLOG, blogAuthorId: AUTHOR.id, sourceStatus: "DONE", reviewerId: null };
  const caps = (actor, status) => computeTaskCapabilities(actor, { ...w.tasks.get(HR), assigneeId: REVIEWER.id, status }, false, cls, { workflowApiEnabled: true });
  assert.deepEqual(caps(HEAD, "ASSIGNED").workflowActions, [], "not offered: it would be refused by the Task Bot");
  assert.deepEqual(caps(HEAD, "IN_PROGRESS").workflowActions, ["REVIEW_REQUEST_REVISION"]);
  assert.deepEqual(caps(REVIEWER, "ASSIGNED").workflowActions, ["REVIEW_APPROVE", "REVIEW_REQUEST_REVISION"]);
});
