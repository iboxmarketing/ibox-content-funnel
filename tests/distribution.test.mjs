import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const LIBS = [
  "content-entity", "task-type", "task-type-fixtures", "workflow-template", "workflow-template-fixtures",
  "task-instance", "content-entity-fixtures", "content-entity-store", "workflow-runtime", "content-workflow",
  "material-production", "distribution", "task-runtime-handlers", "task-completion",
];
const dir = mkdtempSync(join(tmpdir(), "ibox-distribution-"));
for (const name of LIBS) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
const entity = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer } = require(join(dir, "content-entity-store.js"));
const ti = require(join(dir, "task-instance.js"));
const { confirmPreviewPlan, outcomeToEntityActions } = require(join(dir, "content-workflow.js"));
const mp = require(join(dir, "material-production.js"));
const dist = require(join(dir, "distribution.js"));
const completion = require(join(dir, "task-completion.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-12T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const types = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const typeByName = (name) => TASK_TYPE_FIXTURES.find((t) => t.name === name);
const nameOf = (instance) => types.get(instance.taskTypeId).name;

/** In-memory world driving the real shared completion path, like the UI does. */
function newWorld({ destinationStatus = "IN_PROGRESS", materialStatus = "READY", format = "REEL", withDestination = true, typesMap = types } = {}) {
  let content = initialContentEntityState();
  const blog = entity.createBlog(content.knowledgeNodes[0].id, "Blog", null, fixedNow);
  content = contentEntityReducer(content, { type: "ADD_BLOGS", blogs: [blog] }, fixedNow);
  const destination = content.destinations[0];
  content = contentEntityReducer(content, { type: "SET_DESTINATION_STATUS", id: destination.id, status: destinationStatus }, fixedNow);
  const material = { ...entity.createMaterial({ blogId: blog.id, title: "Reel A", format, primaryAtomicIdeaId: "i", destinationNeeded: true }, fixedNow), status: materialStatus, ctaType: "RESOURCE", ctaText: "Qoldiq audit checklist", destinationId: withDestination ? destination.id : null };
  content = contentEntityReducer(content, { type: "ADD_MATERIAL", material }, fixedNow);
  return { content, instances: [], material, destination, types: typesMap };
}
const apply = (w, actions) => { w.content = actions.reduce((acc, a) => contentEntityReducer(acc, a, fixedNow), w.content); };
const spawn = (w, drafts) => { const made = drafts.map((d) => ti.createTaskInstance(d, fixedNow)); w.instances.push(...made); return made; };
const get = (w, id) => w.instances.find((i) => i.id === id);
const patch = (w, instance, changes) => { const i = w.instances.findIndex((x) => x.id === instance.id); w.instances[i] = { ...w.instances[i], ...changes }; return w.instances[i]; };
const ctxOf = (w, instance) => ({ instance: get(w, instance.id), taskType: w.types.get(instance.taskTypeId), template: null, allInstances: w.instances, taskTypesById: w.types, content: w.content });
const material = (w) => w.content.materials.find((m) => m.id === w.material.id);

/** Fill fields and press Complete through the shared entry point. Returns the decision. */
function complete(w, instance, fieldValues = {}, { deadline = "2026-10-20", confirmAll = true, selectionFor = () => ({}) } = {}) {
  const filled = patch(w, instance, { fieldValues: { ...instance.fieldValues, ...fieldValues }, deadline });
  const decision = completion.requestTaskCompletion(ctxOf(w, filled), fixedNow);
  if (decision.kind === "SUBMITTED_FOR_REVIEW") { apply(w, decision.entityActions); patch(w, filled, ti.submitTaskForReview(get(w, filled.id), fixedNow)); return decision; }
  if (decision.kind !== "COMPLETED") return decision;
  const { result } = decision;
  apply(w, result.entityActions);
  const created = spawn(w, result.taskDrafts);
  if (result.completeNow) patch(w, filled, { status: "DONE", outcome: "COMPLETED" });
  if (result.plan && confirmAll) {
    const outcome = confirmPreviewPlan(result.plan, result.plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "2026-10-25", selections: [], ...selectionFor(c) })), fixedNow);
    apply(w, outcomeToEntityActions(outcome));
    created.push(...spawn(w, outcome.taskDrafts));
    patch(w, filled, { status: "DONE", outcome: "COMPLETED" });
  }
  decision.created = created;
  return decision;
}
const reconcile = (w, now) => { const drafts = dist.reconcileDueRuntimeTasks({ now, instances: w.instances, taskTypesById: w.types }, TASK_TYPE_FIXTURES); return spawn(w, drafts); };

/** Reel A is READY -> Distribution Plan task completed with the given channels -> publish tasks. */
function planPublish(w, selections) {
  const planTask = spawn(w, [dist.buildDistributionPlanTask(material(w), typeByName("Distribution Plan"))])[0];
  const decision = complete(w, planTask, { channels: Object.keys(selections) }, { selectionFor: (c) => selections[c.channel] ?? {} });
  return { planTask, publishTasks: decision.created };
}
const publishFields = (instance) => ({ ...instance.fieldValues });

// --- Distribution Plan ---

test("Distribution Plan is eligible for a READY Material even though its Destination is not READY; one plan per Material", () => {
  const w = newWorld({ destinationStatus: "PLANNED" });
  assert.deepEqual(dist.getDistributionPlanEligibleMaterials(w.content, w.instances, w.types).map((m) => m.id), [w.material.id]);
  const plan = spawn(w, [dist.buildDistributionPlanTask(material(w), typeByName("Distribution Plan"))])[0];
  assert.deepEqual(plan.contentRef, entity.ref("MATERIAL", w.material.id));
  assert.equal(plan.workflowStepId, null);
  assert.deepEqual(dist.getDistributionPlanEligibleMaterials(w.content, w.instances, w.types), [], "no second plan for the same Material");
});

test("a Material that is not READY yet has no Distribution Plan eligibility", () => {
  const w = newWorld({ materialStatus: "IN_PRODUCTION" });
  assert.deepEqual(dist.getDistributionPlanEligibleMaterials(w.content, w.instances, w.types), []);
});

test("the plan needs at least one channel; the channel list is configuration (minimal, not a library)", () => {
  const w = newWorld();
  const plan = spawn(w, [dist.buildDistributionPlanTask(material(w), typeByName("Distribution Plan"))])[0];
  assert.equal(completion.requestTaskCompletion(ctxOf(w, patch(w, plan, { deadline: "2026-10-20" })), fixedNow).kind, "BLOCKED");
  assert.deepEqual([...entity.CHANNELS], ["Instagram", "Telegram", "LinkedIn", "X", "YouTube"]);
});

test("one Material -> multiple channels -> exactly one Publish/Schedule task per INCLUDED channel, with separate deadlines", () => {
  const w = newWorld();
  const planTask = spawn(w, [dist.buildDistributionPlanTask(material(w), typeByName("Distribution Plan"))])[0];
  const decision = completion.requestTaskCompletion(ctxOf(w, patch(w, planTask, { deadline: "2026-10-20", fieldValues: { channels: ["Instagram", "Telegram", "LinkedIn"] } })), fixedNow);
  const plan = decision.result.plan;
  assert.equal(plan.mode, "CHANNEL_PUBLISH");
  assert.equal(decision.result.completeNow, false, "the plan task completes only when the channel preview is confirmed");
  const [instagram, telegram, linkedin] = plan.candidates;
  const selections = [
    { key: instagram.key, included: true, title: "", assignee: "", deadline: "2026-10-21", selections: [], publishMode: "SCHEDULE", note: "IG copy" },
    { key: telegram.key, included: true, title: "", assignee: "", deadline: "2026-10-22", selections: [], publishMode: "PUBLISH_NOW" },
    { key: linkedin.key, included: false, title: "", assignee: "", deadline: "", selections: [] },
  ];
  const drafts = confirmPreviewPlan(plan, selections, fixedNow).taskDrafts;
  assert.equal(drafts.length, 2, "the excluded channel creates no task");
  assert.deepEqual(drafts.map((d) => d.fieldValues.channel), ["Instagram", "Telegram"]);
  assert.deepEqual(drafts.map((d) => d.deadline), ["2026-10-21", "2026-10-22"]);
  assert.deepEqual(drafts.map((d) => d.fieldValues["publish-mode"]), ["SCHEDULE", "PUBLISH_NOW"]);
  assert.equal(drafts[0].fieldValues["channel-note"], "IG copy");
  for (const d of drafts) {
    assert.deepEqual(d.contentRef, entity.ref("MATERIAL", w.material.id));
    assert.equal(d.workflowStepId, null);
    assert.equal(d.sourceTaskId, planTask.id);
  }
});

// --- Publish gates ---

function publishTask(w, channel, mode, extra = {}) {
  return spawn(w, [{
    taskTypeId: typeByName("Publish / Schedule").id, workflowTemplateId: null, workflowStepId: null, title: `Publish / Schedule — ${channel} — Reel A`, assignee: null, deadline: "2026-10-20",
    fieldValues: { channel, "publish-mode": mode, ...extra }, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", w.material.id),
  }])[0];
}
const NOW_FIELDS = { published: true, "result-review-at": "2026-11-01" };

test("Destination PLANNED or IN_PROGRESS blocks Publish completion; READY allows it", () => {
  for (const status of ["PLANNED", "IN_PROGRESS"]) {
    const w = newWorld({ destinationStatus: status });
    const task = publishTask(w, "Telegram", "PUBLISH_NOW", NOW_FIELDS);
    const decision = completion.requestTaskCompletion(ctxOf(w, task), fixedNow);
    assert.equal(decision.kind, "BLOCKED", status);
    assert.ok(decision.errors.some((e) => e.message.startsWith("Destination not READY")));
  }
  const ready = newWorld({ destinationStatus: "READY" });
  assert.equal(completion.requestTaskCompletion(ctxOf(ready, publishTask(ready, "Telegram", "PUBLISH_NOW", NOW_FIELDS)), fixedNow).kind, "COMPLETED");
});

test("a Material without an exact Destination can publish", () => {
  const w = newWorld({ withDestination: false });
  assert.equal(completion.requestTaskCompletion(ctxOf(w, publishTask(w, "Telegram", "PUBLISH_NOW", NOW_FIELDS)), fixedNow).kind, "COMPLETED");
});

test("an unresolved FINAL review blocks Publish but the Distribution Plan was still creatable", () => {
  const finalTypes = new Map(types);
  const edit = typeByName("Edit");
  finalTypes.set(edit.id, { ...edit, reviewRequired: true, reviewStage: "FINAL" });
  const w = newWorld({ destinationStatus: "READY", typesMap: finalTypes });
  spawn(w, [{ taskTypeId: edit.id, workflowTemplateId: null, workflowStepId: null, title: "Edit", assignee: null, deadline: "2026-10-20", fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", w.material.id), status: "REVIEW" }]);
  w.instances[0] = { ...w.instances[0], status: "REVIEW" };
  assert.equal(dist.getDistributionPlanEligibleMaterials(w.content, w.instances, w.types).length, 1);
  const decision = completion.requestTaskCompletion(ctxOf(w, publishTask(w, "Telegram", "PUBLISH_NOW", NOW_FIELDS)), fixedNow);
  assert.equal(decision.kind, "BLOCKED");
  assert.ok(decision.errors.some((e) => /Final Head approval/.test(e.message)));
});

test("asset requirements are configurable, not hardcoded: nothing is required by default, a channel can require Cover", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const input = { material: material(w), channel: "Instagram", content: w.content, instances: w.instances, taskTypesById: w.types };
  assert.deepEqual(dist.getPublishBlockers(input), []);
  const requiring = { Instagram: ["Cover", "NotAMayBlockTask"] };
  assert.deepEqual(dist.getPublishBlockers({ ...input, assetRequirements: requiring }), ["Instagram uchun Cover tugallanishi kerak"]);
  const cover = spawn(w, [{ taskTypeId: typeByName("Cover").id, workflowTemplateId: null, workflowStepId: null, title: "Cover", assignee: null, deadline: null, fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", w.material.id) }])[0];
  assert.equal(dist.getPublishBlockers({ ...input, instances: w.instances, assetRequirements: requiring }).length, 1);
  patch(w, cover, { status: "DONE" });
  assert.deepEqual(dist.getPublishBlockers({ ...input, instances: w.instances, assetRequirements: requiring }), []);
  assert.deepEqual(dist.getPublishBlockers({ ...input, channel: "Telegram", assetRequirements: requiring }), [], "other channels are unaffected");
});

// --- Schedule / immediate publish rules ---

test("SCHEDULE requires scheduledPublishAt; the scheduling task can be DONE before the actual publish", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const task = publishTask(w, "Instagram", "SCHEDULE");
  assert.ok(completion.requestTaskCompletion(ctxOf(w, task), fixedNow).errors.some((e) => e.fieldId === "scheduled-publish-at"));
  const decision = complete(w, task, { "scheduled-publish-at": "2026-10-30T10:00" });
  assert.equal(decision.kind, "COMPLETED");
  assert.equal(get(w, task.id).status, "DONE");
  assert.notEqual(material(w).status, "PUBLISHED", "scheduled != published");
});

test("PUBLISH_NOW needs the published confirmation and a Result Review Date, but no proof URL and no automatic Publish Check", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const task = publishTask(w, "Telegram", "PUBLISH_NOW");
  const errors = completion.requestTaskCompletion(ctxOf(w, task), fixedNow).errors.map((e) => e.fieldId).sort();
  assert.deepEqual(errors, ["published", "result-review-at"]);
  complete(w, task, NOW_FIELDS);
  assert.equal(get(w, task.id).links.length, 0, "no proof URL required");
  assert.equal(w.instances.filter((i) => nameOf(i) === "Publish Check").length, 0);
  assert.equal(reconcile(w, "2026-10-30T00:00").filter((i) => nameOf(i) === "Publish Check").length, 0);
});

// --- Reconciliation / Publish Check ---

test("no Publish Check before the due time; exactly one after; repeated reconciliation is idempotent", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const task = publishTask(w, "Instagram", "SCHEDULE");
  complete(w, task, { "scheduled-publish-at": "2026-10-30T10:00" });
  assert.deepEqual(reconcile(w, "2026-10-30T09:59"), []);
  const first = reconcile(w, "2026-10-30T10:00");
  assert.equal(first.length, 1);
  assert.equal(nameOf(first[0]), "Publish Check");
  assert.equal(first[0].sourceTaskId, task.id);
  assert.deepEqual(first[0].contentRef, entity.ref("MATERIAL", w.material.id));
  assert.deepEqual(reconcile(w, "2026-10-30T10:00"), []);
  assert.deepEqual(reconcile(w, "2026-12-31T00:00"), []);
  assert.equal(w.instances.filter((i) => nameOf(i) === "Publish Check").length, 1);
});

test("an unfinished scheduling task does not get a Publish Check yet", () => {
  const w = newWorld({ destinationStatus: "READY" });
  publishTask(w, "Instagram", "SCHEDULE", { "scheduled-publish-at": "2026-10-30T10:00" });
  assert.deepEqual(reconcile(w, "2026-11-30T00:00"), []);
});

function scheduledAndDue() {
  const w = newWorld({ destinationStatus: "READY" });
  const task = publishTask(w, "Instagram", "SCHEDULE");
  complete(w, task, { "scheduled-publish-at": "2026-10-30T10:00" });
  const [check] = reconcile(w, "2026-10-31T00:00");
  return { w, task, check };
}

test("Publish Check accepts exactly the three outcomes; success requires a Result Review Date", () => {
  const { w, check } = scheduledAndDue();
  assert.ok(completion.requestTaskCompletion(ctxOf(w, check), fixedNow).errors.length > 0, "no outcome yet");
  assert.ok(completion.requestTaskCompletion(ctxOf(w, patch(w, check, { fieldValues: { ...check.fieldValues, outcome: "MAYBE" } })), fixedNow).errors.length > 0);
  const noDate = completion.requestTaskCompletion(ctxOf(w, patch(w, check, { fieldValues: { ...check.fieldValues, outcome: "PUBLISHED_SUCCESSFULLY" } })), fixedNow);
  assert.ok(noDate.errors.some((e) => e.fieldId === "result-review-at"));
  for (const outcome of ["DID_NOT_PUBLISH", "PUBLISHED_WITH_ISSUE"]) {
    assert.equal(completion.requestTaskCompletion(ctxOf(w, patch(w, check, { fieldValues: { ...check.fieldValues, outcome } })), fixedNow).kind, "COMPLETED");
  }
});

test("a failed or problematic check OFFERS Fix / Republish through Preview; nothing is created without Confirm", () => {
  for (const outcome of ["DID_NOT_PUBLISH", "PUBLISHED_WITH_ISSUE"]) {
    const { w, check } = scheduledAndDue();
    const before = w.instances.length;
    const decision = complete(w, check, { outcome }, { confirmAll: false });
    assert.equal(decision.result.plan.mode, "REPUBLISH_FIX");
    assert.equal(decision.result.completeNow, false);
    assert.equal(w.instances.length, before, "no repair task without Confirm");
    assert.equal(get(w, check.id).status, "ASSIGNED");
    assert.notEqual(material(w).status, "PUBLISHED");

    const plan = decision.result.plan;
    assert.equal(confirmPreviewPlan(plan, [], fixedNow).taskDrafts.length, 0, "an excluded offer creates nothing");
    const confirmed = confirmPreviewPlan(plan, [{ key: plan.candidates[0].key, included: true, title: "", assignee: "", deadline: "2026-11-02", selections: [] }], fixedNow);
    assert.equal(confirmed.taskDrafts.length, 1);
    assert.equal(types.get(confirmed.taskDrafts[0].taskTypeId).name, "Republish / Fix Publish");
  }
});

// --- Learning ---

test("no Learning before the review date; exactly one when due; idempotent; Learning creates no next task", () => {
  const { w, check } = scheduledAndDue();
  complete(w, check, { outcome: "PUBLISHED_SUCCESSFULLY", "result-review-at": "2026-11-07" });
  assert.deepEqual(reconcile(w, "2026-11-06T23:59"), []);
  const [learning] = reconcile(w, "2026-11-07T00:00");
  assert.equal(nameOf(learning), "Learning");
  assert.equal(learning.sourceTaskId, check.id);
  assert.deepEqual(reconcile(w, "2026-11-07T00:00"), []);
  assert.deepEqual(reconcile(w, "2027-01-01T00:00"), []);
  assert.equal(w.instances.filter((i) => nameOf(i) === "Learning").length, 1);

  const before = w.instances.length;
  const decision = complete(w, learning, { result: "120 ta lead", "what-worked": "Checklist CTA", "next-step": "Yana 2 ta reel" });
  assert.equal(decision.kind, "COMPLETED");
  assert.equal(decision.result.plan, null);
  assert.deepEqual(decision.result.taskDrafts, []);
  assert.equal(w.instances.length, before, "Learning completion creates no next task");
});

test("Learning requires only Result / What worked? / Next step", () => {
  const learning = typeByName("Learning");
  assert.deepEqual(learning.requiredFields.map((f) => f.label), ["Result", "What worked?", "Next step"]);
});

test("a PUBLISH_NOW publish also leads to Learning on its Result Review Date", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const task = publishTask(w, "Telegram", "PUBLISH_NOW");
  complete(w, task, NOW_FIELDS);
  assert.deepEqual(reconcile(w, "2026-10-31T00:00"), []);
  assert.equal(reconcile(w, "2026-11-01T00:00").length, 1);
});

test("the Material exposes only its latest Learning summary", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const mk = (updatedAt, result) => spawn(w, [{ taskTypeId: typeByName("Learning").id, workflowTemplateId: null, workflowStepId: null, title: "L", assignee: null, deadline: "2026-11-01", fieldValues: { result, "what-worked": `w-${result}`, "next-step": `n-${result}` }, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", w.material.id) }]).map((t) => patch(w, t, { status: "DONE", updatedAt }))[0];
  assert.equal(dist.latestLearningSummary(w.material.id, w.instances, w.types), null);
  mk("2026-11-01T00:00:00.000Z", "old");
  mk("2026-11-09T00:00:00.000Z", "new");
  assert.deepEqual(dist.latestLearningSummary(w.material.id, w.instances, w.types), { result: "new", whatWorked: "w-new", nextStep: "n-new" });
});

// --- Material status ---

test("the first successful channel moves the Material to PUBLISHED; other channels stay independent and open", () => {
  const w = newWorld({ destinationStatus: "READY" });
  const telegram = publishTask(w, "Telegram", "PUBLISH_NOW");
  const instagram = publishTask(w, "Instagram", "SCHEDULE");
  const linkedin = publishTask(w, "LinkedIn", "SCHEDULE");
  assert.equal(material(w).status, "READY");
  complete(w, telegram, NOW_FIELDS);
  assert.equal(material(w).status, "PUBLISHED");
  assert.equal(get(w, instagram.id).status, "ASSIGNED");
  assert.equal(get(w, linkedin.id).status, "ASSIGNED");
  // A still-open channel can finish afterwards without any problem.
  assert.equal(complete(w, instagram, { "scheduled-publish-at": "2026-10-30T10:00" }).kind, "COMPLETED");
});

test("a scheduled publish only counts once its Publish Check confirms success", () => {
  const { w, check } = scheduledAndDue();
  assert.equal(material(w).status, "READY");
  complete(w, check, { outcome: "PUBLISHED_SUCCESSFULLY", "result-review-at": "2026-11-07" });
  assert.equal(material(w).status, "PUBLISHED");
});

// --- Read models ---

test("Awaiting Publish Check lists done scheduling tasks until their check is finished", () => {
  const { w, task, check } = scheduledAndDue();
  assert.deepEqual(dist.getAwaitingPublishCheck(w.instances, w.types).map((r) => r.publishTask.id), [task.id]);
  complete(w, check, { outcome: "DID_NOT_PUBLISH" }, { confirmAll: false });
  patch(w, check, { status: "DONE" });
  assert.deepEqual(dist.getAwaitingPublishCheck(w.instances, w.types), []);
});

// --- Qoldiq end-to-end ---

test("Qoldiq end-to-end: Reel A -> Distribution Plan -> Instagram SCHEDULE + Telegram PUBLISH_NOW -> blocked by Destination -> READY -> publish -> check -> learning", () => {
  const w = newWorld({ destinationStatus: "IN_PROGRESS" });
  // B/C/D: plan for Instagram (SCHEDULE) + Telegram (PUBLISH_NOW); CTA points at the Qoldiq audit checklist.
  assert.equal(material(w).destinationId, w.destination.id);
  const { publishTasks } = planPublish(w, { Instagram: { publishMode: "SCHEDULE", deadline: "2026-10-28" }, Telegram: { publishMode: "PUBLISH_NOW", deadline: "2026-10-27" } });
  assert.equal(publishTasks.length, 2);
  const instagram = publishTasks.find((t) => t.fieldValues.channel === "Instagram");
  const telegram = publishTasks.find((t) => t.fieldValues.channel === "Telegram");

  // E: tasks exist but completion is blocked with "Destination not READY".
  const blocked = completion.requestTaskCompletion(ctxOf(w, patch(w, telegram, { fieldValues: { ...telegram.fieldValues, ...NOW_FIELDS, "result-review-at": "2026-11-20" } })), fixedNow);
  assert.equal(blocked.kind, "BLOCKED");
  assert.match(blocked.errors.map((e) => e.message).join(" | "), /Destination not READY/);

  // F: the Destination becomes READY.
  apply(w, [{ type: "SET_DESTINATION_STATUS", id: w.destination.id, status: "READY" }]);

  // G: Telegram immediate publish with a Result Review Date.
  assert.equal(complete(w, get(w, telegram.id), {}).kind, "COMPLETED");
  assert.equal(get(w, telegram.id).status, "DONE");
  assert.equal(material(w).status, "PUBLISHED");

  // H: Instagram scheduled for a chosen date/time; the scheduling task is DONE.
  assert.equal(complete(w, instagram, { "scheduled-publish-at": "2026-10-30T10:00" }).kind, "COMPLETED");

  // I: advance local now past scheduledPublishAt -> exactly one Publish Check.
  assert.deepEqual(reconcile(w, "2026-10-29T00:00"), []);
  const checks = reconcile(w, "2026-10-30T11:00");
  assert.equal(checks.length, 1);
  assert.deepEqual(reconcile(w, "2026-10-30T11:00"), []);

  // J: PUBLISHED_SUCCESSFULLY + Result Review Date.
  complete(w, checks[0], { outcome: "PUBLISHED_SUCCESSFULLY", "result-review-at": "2026-11-10" });

  // K: advance to the Result Review Date -> exactly one Learning (Telegram's own review date is later).
  const learnings = reconcile(w, "2026-11-10T00:00");
  assert.equal(learnings.length, 1);
  assert.equal(learnings[0].sourceTaskId, checks[0].id);
  assert.deepEqual(reconcile(w, "2026-11-10T00:00"), []);

  // L/M: complete Learning; the Material exposes the latest summary.
  complete(w, learnings[0], { result: "Reel 40 000 ko'rish", "what-worked": "Checklist CTA", "next-step": "Carousel qilamiz" });
  assert.deepEqual(dist.latestLearningSummary(w.material.id, w.instances, w.types), { result: "Reel 40 000 ko'rish", whatWorked: "Checklist CTA", nextStep: "Carousel qilamiz" });
});

test("review demo: a review-required task goes REVIEW -> REVISION -> REVIEW -> approved on the SAME TaskInstance, and the flow continues", () => {
  const reviewTypes = new Map(types);
  const cover = typeByName("Cover");
  reviewTypes.set(cover.id, { ...cover, reviewRequired: true });
  const w = newWorld({ typesMap: reviewTypes });
  const task = spawn(w, [{ taskTypeId: cover.id, workflowTemplateId: null, workflowStepId: null, title: "Cover", assignee: null, deadline: "2026-10-20", fieldValues: { "cover-asset": "https://example.com/c" }, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", w.material.id) }])[0];
  complete(w, task);
  assert.equal(get(w, task.id).status, "REVIEW");
  const revision = completion.decideTaskReview(ctxOf(w, get(w, task.id)), "REQUEST_REVISION", fixedNow);
  assert.equal(revision.kind, "REVISION_REQUESTED");
  w.instances[0] = ti.requestTaskRevision(get(w, task.id), "Rangni yangilang", fixedNow);
  assert.equal(get(w, task.id).status, "REVISION");
  complete(w, get(w, task.id), { "cover-asset": "https://example.com/c-v2" });
  assert.equal(get(w, task.id).status, "REVIEW");
  const approved = completion.decideTaskReview(ctxOf(w, get(w, task.id)), "APPROVE", fixedNow);
  assert.equal(approved.kind, "COMPLETED");
  patch(w, task, { status: "DONE", outcome: "COMPLETED" });
  assert.equal(w.instances.length, 1, "no revision TaskInstance was ever created");
  assert.equal(get(w, task.id).status, "DONE");
});

test("no new operational task status was introduced by Sprint 6", () => {
  assert.deepEqual([...ti.TASK_INSTANCE_STATUSES], ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]);
});
