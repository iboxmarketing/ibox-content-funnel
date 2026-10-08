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
const dir = mkdtempSync(join(tmpdir(), "ibox-task-completion-"));
for (const name of LIBS) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: template } = require(join(dir, "workflow-template-fixtures.js"));
const entity = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer } = require(join(dir, "content-entity-store.js"));
const ti = require(join(dir, "task-instance.js"));
const dist = require(join(dir, "distribution.js"));
const completion = require(join(dir, "task-completion.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-12T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const baseTypes = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const typeByName = (name) => TASK_TYPE_FIXTURES.find((t) => t.name === name);

function typesWith(overrides) {
  const map = new Map(baseTypes);
  for (const [name, patch] of Object.entries(overrides)) {
    const t = typeByName(name);
    map.set(t.id, { ...t, ...patch });
  }
  return map;
}

function worldWithReel() {
  let content = initialContentEntityState();
  const blog = entity.createBlog(content.knowledgeNodes[0].id, "Blog", null, fixedNow);
  content = contentEntityReducer(content, { type: "ADD_BLOGS", blogs: [blog] }, fixedNow);
  const material = entity.createMaterial({ blogId: blog.id, title: "Reel A", format: "REEL", primaryAtomicIdeaId: "i" }, fixedNow);
  content = contentEntityReducer(content, { type: "ADD_MATERIAL", material }, fixedNow);
  return { content, material };
}

function make(typeName, world, overrides = {}) {
  return ti.createTaskInstance({
    taskTypeId: typeByName(typeName).id, workflowTemplateId: null, workflowStepId: null, title: typeName, assignee: null, deadline: "2026-10-20",
    fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", world.material.id), ...overrides,
  }, fixedNow);
}

const ctx = (world, instance, types = baseTypes, instances = [instance]) => ({
  instance, taskType: types.get(instance.taskTypeId), template: instance.workflowTemplateId ? template : null,
  allInstances: instances, taskTypesById: types, content: world.content,
});

// --- Shared entry point ---

test("generic and special Task Types both complete through requestTaskCompletion", () => {
  const world = worldWithReel();
  const cover = make("Cover", world, { fieldValues: { "cover-asset": "https://example.com/cover" } });
  assert.equal(completion.requestTaskCompletion(ctx(world, cover), fixedNow).kind, "COMPLETED");
  const planning = make("Planning", world, { fieldValues: { "desired-shoot-date": "2026-10-13" } });
  assert.equal(completion.requestTaskCompletion(ctx(world, planning), fixedNow).kind, "COMPLETED");
});

test("the UI files use the shared entry point and never the raw handler outcome", () => {
  const view = readFileSync(new URL("../components/workflow-run-view.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../components/task-detail.tsx", import.meta.url), "utf8");
  assert.ok(view.includes("requestTaskCompletion") && view.includes("decideTaskReview"));
  assert.ok(!view.includes("runTaskCompletion") && !detail.includes("runTaskCompletion"));
  assert.ok(!detail.includes("runtimeCompletionErrors") && detail.includes("getCompletionState"));
});

test("a special handler cannot bypass standard required-field validation", () => {
  const world = worldWithReel();
  const planningMissingDate = make("Planning", world); // handler has a complete(); required date is missing
  const decision = completion.requestTaskCompletion(ctx(world, planningMissingDate), fixedNow);
  assert.equal(decision.kind, "BLOCKED");
  assert.ok(decision.errors.some((e) => e.fieldId === "desired-shoot-date"));
});

test("a special handler cannot bypass its OWN custom validation either (CTA)", () => {
  const world = worldWithReel();
  const reel = make("Reel Script", world, { fieldValues: { hook: "h", script: "s" } });
  const decision = completion.requestTaskCompletion(ctx(world, reel), fixedNow);
  assert.equal(decision.kind, "BLOCKED");
  assert.ok(decision.errors.some((e) => e.fieldId === "cta-type"));
});

test("a missing deadline blocks completion for every Task Type", () => {
  const world = worldWithReel();
  const cover = make("Cover", world, { deadline: null, fieldValues: { "cover-asset": "https://example.com/c" } });
  assert.equal(completion.requestTaskCompletion(ctx(world, cover), fixedNow).kind, "BLOCKED");
});

test("a handler's Generated Preview is still supported through the shared path (Shoot)", () => {
  const world = worldWithReel();
  const planned = { ...world.material };
  void planned;
  const session = entity.createShootSession({ title: "S", scheduledAt: "2026-10-13", assignee: null, materialIds: [world.material.id] }, fixedNow);
  world.content = contentEntityReducer(world.content, { type: "ADD_SHOOT_SESSION", session }, fixedNow);
  const shoot = make("Shoot", world, { contentRef: entity.ref("SHOOT_SESSION", session.id) });
  const decision = completion.requestTaskCompletion(ctx(world, shoot), fixedNow);
  assert.equal(decision.kind, "COMPLETED");
  assert.equal(decision.result.plan.mode, "SHOOT_PRODUCTION");
  assert.equal(decision.result.completeNow, false);
});

// --- reviewRequired ---

const REVIEW_TYPES = typesWith({ Cover: { reviewRequired: true } });
const coverReady = (world) => make("Cover", world, { fieldValues: { "cover-asset": "https://example.com/cover" } });

test("reviewRequired=false: Complete follows the normal flow", () => {
  const world = worldWithReel();
  assert.equal(completion.getCompletionState(ctx(world, coverReady(world))).action, "COMPLETE");
});

test("reviewRequired=true: Complete submits the task for review instead (status REVIEW, not DONE)", () => {
  const world = worldWithReel();
  const cover = coverReady(world);
  assert.equal(completion.getCompletionState(ctx(world, cover, REVIEW_TYPES)).action, "SUBMIT_FOR_REVIEW");
  const decision = completion.requestTaskCompletion(ctx(world, cover, REVIEW_TYPES), fixedNow);
  assert.equal(decision.kind, "SUBMITTED_FOR_REVIEW");
  const submitted = ti.submitTaskForReview(cover, fixedNow);
  assert.equal(submitted.status, "REVIEW");
  assert.equal(ti.isTaskInstanceSettled(submitted), false, "not treated as finally approved");
  assert.equal(completion.getCompletionState(ctx(world, submitted, REVIEW_TYPES)).action, "AWAITING_REVIEW");
  assert.equal(completion.requestTaskCompletion(ctx(world, submitted, REVIEW_TYPES), fixedNow).kind, "BLOCKED", "cannot self-complete while awaiting review");
});

test("a review-required task still cannot be submitted with invalid fields", () => {
  const world = worldWithReel();
  const cover = make("Cover", world);
  assert.equal(completion.requestTaskCompletion(ctx(world, cover, REVIEW_TYPES), fixedNow).kind, "BLOCKED");
});

test("Approve runs the normal completion outcome", () => {
  const world = worldWithReel();
  const submitted = ti.submitTaskForReview(coverReady(world), fixedNow);
  const decision = completion.decideTaskReview(ctx(world, submitted, REVIEW_TYPES), "APPROVE", fixedNow);
  assert.equal(decision.kind, "COMPLETED");
  assert.equal(decision.result.completeNow, true);
});

test("Request revision moves the SAME TaskInstance to REVISION; resubmit returns it to REVIEW; no duplicate task", () => {
  const world = worldWithReel();
  const original = ti.submitTaskForReview(coverReady(world), fixedNow);
  const all = [original];
  assert.equal(completion.decideTaskReview(ctx(world, original, REVIEW_TYPES, all), "REQUEST_REVISION", fixedNow).kind, "REVISION_REQUESTED");
  const revised = ti.requestTaskRevision(original, "Rangni o'zgartiring", fixedNow);
  assert.equal(revised.id, original.id);
  assert.equal(revised.status, "REVISION");
  assert.equal(completion.getCompletionState(ctx(world, revised, REVIEW_TYPES)).action, "RESUBMIT");

  const edited = { ...revised, fieldValues: { ...revised.fieldValues, "cover-asset": "https://example.com/cover-v2" } };
  assert.equal(completion.requestTaskCompletion(ctx(world, edited, REVIEW_TYPES), fixedNow).kind, "SUBMITTED_FOR_REVIEW");
  const resubmitted = ti.submitTaskForReview(edited, fixedNow);
  assert.equal(resubmitted.status, "REVIEW");
  assert.equal(resubmitted.id, original.id, "still the same TaskInstance -- no revision task");
  assert.deepEqual(resubmitted.reviewEvents.map((e) => e.kind), ["SUBMITTED", "REVISION_REQUESTED", "SUBMITTED"]);

  const approved = completion.decideTaskReview(ctx(world, resubmitted, REVIEW_TYPES), "APPROVE", fixedNow);
  assert.equal(approved.kind, "COMPLETED");
});

test("only a task in REVIEW can be reviewed; no new statuses exist", () => {
  const world = worldWithReel();
  assert.equal(completion.decideTaskReview(ctx(world, coverReady(world), REVIEW_TYPES), "APPROVE", fixedNow).kind, "BLOCKED");
  assert.deepEqual([...ti.TASK_INSTANCE_STATUSES], ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]);
});

test("a workflow step's reviewRequired override is honored", () => {
  const world = worldWithReel();
  const step = template.steps.find((s) => baseTypes.get(s.taskTypeId).name === "SEO");
  const overridden = { ...template, steps: template.steps.map((s) => (s.id === step.id ? { ...s, overrides: { reviewRequired: true } } : s)) };
  const seo = ti.createTaskInstance({ taskTypeId: step.taskTypeId, workflowTemplateId: template.id, workflowStepId: step.id, title: "SEO", assignee: null, deadline: "2026-10-20", fieldValues: { "seo-notes": "n" }, customFields: [], links: [], sourceTaskId: null }, fixedNow);
  const context = { ...ctx(world, seo), template: overridden };
  assert.equal(completion.isReviewRequiredFor(context), true);
  assert.equal(completion.isReviewRequiredFor({ ...context, template }), false);
});

// --- Final asset review gate ---

const FINAL_TYPES = typesWith({ Edit: { reviewRequired: true, reviewStage: "FINAL" } });

test("an unresolved FINAL review blocks Publish but never blocks creating a Distribution Plan", () => {
  const world = worldWithReel();
  const ready = { ...world.material, status: "READY" };
  world.content = contentEntityReducer(world.content, { type: "ADD_MATERIAL", material: { ...ready, id: "m-ready", title: "Reel ready" } }, fixedNow);
  const readyMaterial = world.content.materials.find((m) => m.id === "m-ready");
  const edit = ti.submitTaskForReview(make("Edit", world, { contentRef: entity.ref("MATERIAL", "m-ready"), fieldValues: { "final-cut": "https://example.com/f" } }), fixedNow);

  // Distribution Plan is still allowed (Material READY, review unresolved).
  assert.deepEqual(dist.getDistributionPlanEligibleMaterials(world.content, [edit], FINAL_TYPES).map((m) => m.id), ["m-ready"]);
  // Publish is blocked with a clear reason.
  const blockers = dist.getPublishBlockers({ material: readyMaterial, channel: "Telegram", content: world.content, instances: [edit], taskTypesById: FINAL_TYPES });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /Final Head approval/);
  // Once approved (DONE) it no longer blocks.
  const approved = { ...edit, status: "DONE", outcome: "COMPLETED" };
  assert.deepEqual(dist.getPublishBlockers({ material: readyMaterial, channel: "Telegram", content: world.content, instances: [approved], taskTypesById: FINAL_TYPES }), []);
});

test("a DRAFT-stage review never blocks Publish, and an Edit submitted for review already makes the Material distribution-ready", () => {
  const world = worldWithReel();
  const draftReview = typesWith({ Cover: { reviewRequired: true, reviewStage: "DRAFT" } });
  const cover = ti.submitTaskForReview(coverReady(world), fixedNow);
  assert.deepEqual(dist.getPublishBlockers({ material: world.material, channel: "Telegram", content: world.content, instances: [cover], taskTypesById: draftReview }), []);

  const edit = make("Edit", world, { fieldValues: { "final-cut": "https://example.com/f" } });
  const decision = completion.requestTaskCompletion(ctx(world, edit, FINAL_TYPES), fixedNow);
  assert.equal(decision.kind, "SUBMITTED_FOR_REVIEW");
  assert.deepEqual(decision.entityActions, [{ type: "SET_MATERIAL_STATUS", id: world.material.id, status: "READY" }]);
});
