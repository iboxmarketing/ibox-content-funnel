/**
 * Sprint 7.1: the Blog is reviewed ONLY by the separate Head Review task.
 * Drives the real shared completion entry point (lib/task-completion.ts)
 * and the runtime store reducer exactly as workflow-run-view.tsx does.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const LIBS = [
  "content-entity", "task-type", "task-type-fixtures", "workflow-template", "workflow-template-fixtures", "task-link",
  "task-instance", "content-entity-fixtures", "content-entity-store", "workflow-runtime", "content-workflow",
  "material-production", "distribution", "task-runtime-handlers", "task-completion", "task-runtime-store",
];
const dir = mkdtempSync(join(tmpdir(), "ibox-head-review-"));
for (const name of LIBS) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: template } = require(join(dir, "workflow-template-fixtures.js"));
const { ref } = require(join(dir, "content-entity.js"));
const { initialContentEntityState } = require(join(dir, "content-entity-store.js"));
const { confirmPreviewPlan } = require(join(dir, "content-workflow.js"));
const { buildTaskInstanceSeed } = require(join(dir, "workflow-runtime.js"));
const { createTaskInstance, TASK_INSTANCE_STATUSES } = require(join(dir, "task-instance.js"));
const completion = require(join(dir, "task-completion.js"));
const store = require(join(dir, "task-runtime-store.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-13T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const taskTypesById = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const nameOf = (i) => taskTypesById.get(i.taskTypeId).name;
const stepFor = (name) => template.steps.find((s) => taskTypesById.get(s.taskTypeId).name === name);

const BLOG_FIELDS = { "blog-link": "https://docs.example.com/blog", "blog-title": "Qaytgan tovar" };

/** A world holding the runtime store state, driven like the UI. */
function newWorld() {
  const content = initialContentEntityState();
  const node = content.knowledgeNodes[0];
  const blogStep = stepFor("Blog");
  const w = { content, node, state: store.initialTaskRuntimeState() };
  const seed = buildTaskInstanceSeed(blogStep, taskTypesById.get(blogStep.taskTypeId), null, ref("KNOWLEDGE_NODE", node.id));
  w.blog = create(w, [{ ...seed, deadline: "2026-10-20" }])[0];
  return w;
}
function dispatch(w, action) { w.state = store.taskRuntimeReducer(w.state, action, fixedNow); }
function create(w, drafts) {
  const before = w.state.instances.length;
  dispatch(w, { type: "ADD_INSTANCES", instances: drafts.map((d) => createTaskInstance(d, fixedNow)) });
  return w.state.instances.slice(before);
}
const get = (w, id) => w.state.instances.find((i) => i.id === id);
const byName = (w, name) => w.state.instances.filter((i) => nameOf(i) === name);
const ctx = (w, id) => {
  const instance = get(w, id);
  return { instance, taskType: taskTypesById.get(instance.taskTypeId), template, allInstances: w.state.instances, taskTypesById, content: w.content };
};
function fill(w, id, fieldValues) {
  for (const [fieldId, value] of Object.entries(fieldValues)) dispatch(w, { type: "SET_FIELD_VALUE", instanceId: id, fieldId, value });
  if (!get(w, id).deadline) dispatch(w, { type: "SET_DEADLINE", instanceId: id, deadline: "2026-10-20" });
}
/** Press Complete / Resubmit and apply the decision like workflow-run-view.tsx. */
function press(w, id, fieldValues = {}) {
  fill(w, id, fieldValues);
  const decision = completion.requestTaskCompletion(ctx(w, id), fixedNow);
  switch (decision.kind) {
    case "SOURCE_REVISION_REQUESTED": dispatch(w, { type: "REQUEST_SOURCE_REVISION", reviewerId: id, sourceId: decision.sourceTaskId, decisionFieldId: decision.decisionFieldId, note: decision.note }); break;
    case "RESUBMITTED_TO_REVIEWER": dispatch(w, { type: "RESUBMIT_TO_REVIEWER", sourceId: id, reviewerId: decision.reviewerTaskId, decisionFieldId: decision.decisionFieldId }); break;
    case "COMPLETED": {
      const { result } = decision;
      if (result.completeNow) dispatch(w, { type: "COMPLETE", instanceId: id });
      if (result.plan) {
        const outcome = confirmPreviewPlan(result.plan, result.plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "2026-10-25", selections: [] })), fixedNow);
        decision.created = create(w, outcome.taskDrafts);
        dispatch(w, { type: "COMPLETE", instanceId: id });
      }
      break;
    }
    default: break;
  }
  return decision;
}
function blogDone() {
  const w = newWorld();
  const decision = press(w, w.blog.id, BLOG_FIELDS);
  return { w, decision, headReview: byName(w, "Head Review")[0] };
}

test("Blog is NOT review-required: Complete completes it (no REVIEW status) and fans out the four parallel branches", () => {
  const { w, decision } = blogDone();
  assert.equal(decision.kind, "COMPLETED");
  assert.equal(get(w, w.blog.id).status, "DONE");
  assert.deepEqual(get(w, w.blog.id).reviewEvents, [], "no Blog self-review happened");
  const branches = decision.created.map((i) => [nameOf(i), template.steps.find((s) => s.id === i.workflowStepId).blocking]);
  assert.deepEqual(branches.sort(), [["Angle", true], ["Head Review", true], ["Performance Consultation", true], ["SEO", false]]);
  for (const task of decision.created) assert.equal(task.sourceTaskId, w.blog.id, "each branch is linked to the Blog");
});

test("Head Review REQUEST REVISION: the SAME Blog goes REVISION, Head Review waits, no task is created", () => {
  const { w, headReview } = blogDone();
  const count = w.state.instances.length;
  const decision = press(w, headReview.id, { "review-decision": "Revision requested", "review-note": "Kirishni qisqartiring." });
  assert.equal(decision.kind, "SOURCE_REVISION_REQUESTED");
  assert.equal(decision.sourceTaskId, w.blog.id);
  assert.equal(w.state.instances.length, count, "no new Blog / review task");
  const blog = get(w, w.blog.id);
  assert.equal(blog.status, "REVISION");
  assert.equal(blog.outcome, null);
  assert.deepEqual(blog.reviewEvents.map((e) => [e.kind, e.note]), [["REVISION_REQUESTED", "Kirishni qisqartiring."]]);
  assert.equal(get(w, headReview.id).status, "BLOCKED");
});

test("while the Blog is in REVISION the Head Review cannot complete and Repurpose cannot unlock", () => {
  const { w, headReview } = blogDone();
  press(w, headReview.id, { "review-decision": "Revision requested", "review-note": "x" });
  dispatch(w, { type: "SET_STATUS", instanceId: headReview.id, status: "ASSIGNED" }); // even if someone unparks it manually
  dispatch(w, { type: "SET_FIELD_VALUE", instanceId: headReview.id, fieldId: "review-decision", value: "Approved" });
  const blocked = completion.requestTaskCompletion(ctx(w, headReview.id), fixedNow);
  assert.equal(blocked.kind, "BLOCKED");
  assert.match(blocked.errors.map((e) => e.message).join(" "), /tuzatilmoqda \(REVISION\)/);
  assert.notEqual(get(w, headReview.id).status, "DONE");
});

test("Blog correction → Resubmit returns to the SAME Head Review (decision cleared); Head Review approve then completes", () => {
  const { w, headReview } = blogDone();
  press(w, headReview.id, { "review-decision": "Revision requested", "review-note": "x" });
  assert.equal(completion.getCompletionState(ctx(w, w.blog.id)).action, "RESUBMIT");
  const count = w.state.instances.length;
  const resubmit = press(w, w.blog.id, { "blog-title": "Qaytgan tovar — tuzatilgan" });
  assert.equal(resubmit.kind, "RESUBMITTED_TO_REVIEWER");
  assert.equal(resubmit.reviewerTaskId, headReview.id);
  assert.equal(resubmit.result.plan, null, "the Blog's branches already exist -- nothing re-generated");
  assert.equal(w.state.instances.length, count);
  assert.equal(get(w, w.blog.id).status, "DONE");
  assert.deepEqual(get(w, w.blog.id).reviewEvents.map((e) => e.kind), ["REVISION_REQUESTED", "SUBMITTED"]);
  const reviewer = get(w, headReview.id);
  assert.equal(reviewer.status, "ASSIGNED");
  assert.equal(reviewer.fieldValues["review-decision"], null, "Head must decide again");

  const approve = press(w, headReview.id, { "review-decision": "Approved" });
  assert.equal(approve.kind, "COMPLETED");
  assert.equal(get(w, headReview.id).status, "DONE");
  assert.equal(byName(w, "Head Review").length, 1, "still the same single Head Review task");
  assert.equal(byName(w, "Blog").length, 1);
});

test("Head Review approval is required for Repurpose; Angle + Performance Consultation still gate Destination Decision", () => {
  const { w, headReview } = blogDone();
  const [angle] = byName(w, "Angle");
  const [pc] = byName(w, "Performance Consultation");
  press(w, angle.id, { angles: "A1\nA2\nA3\nA4\nA5" });
  assert.equal(byName(w, "Destination Decision").length, 0, "PC not done yet");
  const pcDone = press(w, pc.id, { recommendation: "Checklist" });
  assert.deepEqual(pcDone.created.map(nameOf), ["Destination Decision"]);
  const [dd] = byName(w, "Destination Decision");
  const destination = w.content.destinations[0];
  const ddDone = press(w, dd.id, { "content-perspective": "p", "digital-recommendation": "d", "why-selected": "w", "create-new": false, "chosen-destination-id": destination.id });
  assert.equal(ddDone.result.plan, null, "Head Review not approved yet -> no Repurpose");
  assert.equal(byName(w, "Repurpose Map").length, 0);

  // Revision round-trip, then approval unlocks Repurpose (DD already done).
  press(w, headReview.id, { "review-decision": "Revision requested", "review-note": "x" });
  press(w, w.blog.id);
  const approve = press(w, headReview.id, { "review-decision": "Approved", "review-note": "OK" });
  assert.deepEqual(approve.created.map(nameOf), ["Repurpose Map"]);
});

test("branches finished while the Blog was in revision are not lost: resubmit offers only the missing step", () => {
  const { w, headReview } = blogDone();
  press(w, headReview.id, { "review-decision": "Revision requested", "review-note": "x" });
  assert.equal(press(w, byName(w, "Angle")[0].id, { angles: "A1\nA2\nA3\nA4\nA5" }).kind, "COMPLETED");
  assert.equal(press(w, byName(w, "Performance Consultation")[0].id, { recommendation: "r" }).kind, "COMPLETED");
  assert.equal(byName(w, "Destination Decision").length, 0, "the Blog was not settled, so DD could not unlock");
  const resubmit = press(w, w.blog.id);
  assert.equal(resubmit.kind, "RESUBMITTED_TO_REVIEWER");
  assert.deepEqual(resubmit.result.plan.candidates.map((c) => c.taskType.name), ["Destination Decision"], "no duplicate Head Review / SEO / Angle / PC");
});

test("Request revision needs a Review Note; the decision options replace 'Rejected'", () => {
  const { w, headReview } = blogDone();
  fill(w, headReview.id, { "review-decision": "Revision requested" });
  const decision = completion.requestTaskCompletion(ctx(w, headReview.id), fixedNow);
  assert.equal(decision.kind, "BLOCKED");
  assert.ok(decision.errors.some((e) => e.fieldId === "review-note"));
});

test("no new task statuses; the generic UI still names no Task Type", () => {
  assert.deepEqual([...TASK_INSTANCE_STATUSES], ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]);
  for (const file of ["components/task-detail.tsx", "components/workflow-run-view.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes('"Head Review"') && !source.includes('"Blog"'), file);
  }
});
