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
const dir = mkdtempSync(join(tmpdir(), "ibox-runtime-handlers-"));
for (const name of LIBS) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { TASK_TYPE_FIXTURES } = require(join(dir, "task-type-fixtures.js"));
const { QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: template } = require(join(dir, "workflow-template-fixtures.js"));
const entity = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer } = require(join(dir, "content-entity-store.js"));
const { createTaskInstance, TASK_INSTANCE_STATUSES } = require(join(dir, "task-instance.js"));
const { buildFormatPreviewPlan, confirmPreviewPlan, confirmAtomicIdeaDrafts, outcomeToEntityActions } = require(join(dir, "content-workflow.js"));
const mp = require(join(dir, "material-production.js"));
const handlers = require(join(dir, "task-runtime-handlers.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-11T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const taskTypesById = new Map(TASK_TYPE_FIXTURES.map((t) => [t.id, t]));
const typeByName = (name) => TASK_TYPE_FIXTURES.find((t) => t.name === name);
const nameOf = (instance) => taskTypesById.get(instance.taskTypeId).name;

/** A tiny in-memory "world" driving the pure handlers exactly as
 * workflow-run-view.tsx does, minus React. */
function newWorld() {
  const content0 = initialContentEntityState();
  const node = content0.knowledgeNodes[0];
  const blog = entity.createBlog(node.id, "Qaytgan tovar qoldiqqa kiritilmasa nima bo'ladi?", null, fixedNow);
  return { content: contentEntityReducer(content0, { type: "ADD_BLOGS", blogs: [blog] }, fixedNow), instances: [], blog, node };
}
const apply = (world, actions) => { world.content = actions.reduce((acc, a) => contentEntityReducer(acc, a, fixedNow), world.content); };
const spawn = (world, drafts) => { const made = drafts.map((d) => createTaskInstance(d, fixedNow)); world.instances.push(...made); return made; };
const patch = (world, instance, changes) => { const i = world.instances.findIndex((x) => x.id === instance.id); world.instances[i] = { ...world.instances[i], ...changes }; return world.instances[i]; };
const ctxFor = (world, instance) => ({
  instance: world.instances.find((i) => i.id === instance.id),
  taskType: taskTypesById.get(instance.taskTypeId),
  template: instance.workflowTemplateId ? template : null,
  allInstances: world.instances,
  taskTypesById,
  content: world.content,
});
const markDone = (world, instance) => patch(world, instance, { status: "DONE", outcome: "COMPLETED" });
/** Fills the task, completes it through the registry, applies the result. */
function completeTask(world, instance, { fieldValues = {}, deadline = "2026-10-20", confirm = true } = {}) {
  const filled = patch(world, instance, { fieldValues: { ...instance.fieldValues, ...fieldValues }, deadline });
  const context = ctxFor(world, filled);
  const errors = handlers.runtimeCompletionErrors(context);
  assert.deepEqual(errors, [], `unexpected handler errors for ${nameOf(filled)}`);
  const result = handlers.runTaskCompletion(context, fixedNow);
  apply(world, result.entityActions);
  const created = spawn(world, result.taskDrafts);
  if (result.completeNow) markDone(world, filled);
  if (result.plan && confirm) {
    const outcome = confirmPreviewPlan(result.plan, result.plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "2026-10-25", selections: [] })), fixedNow);
    apply(world, outcomeToEntityActions(outcome));
    created.push(...spawn(world, outcome.taskDrafts));
    markDone(world, filled);
  }
  return { result, created };
}

/** Repurpose output: Reel A, Reel B, Carousel A, Text A -> 4 Materials + their first authoring tasks. */
function qoldiqWorldAfterRepurpose() {
  const world = newWorld();
  const repurposeInstance = createTaskInstance({ taskTypeId: typeByName("Repurpose Map").id, workflowTemplateId: null, workflowStepId: null, title: "Repurpose", assignee: null, deadline: "2026-10-20", fieldValues: {}, customFields: [], links: [], sourceTaskId: null }, fixedNow);
  const ideas = confirmAtomicIdeaDrafts("rmap-1", [
    { id: "1", text: "Reel A", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL"], angleId: null, destinationNeeded: true },
    { id: "2", text: "Reel B", coverageType: "CAUSE", decision: "CREATE_CONTENT", selectedFormats: ["REEL"], angleId: null, destinationNeeded: false },
    { id: "3", text: "Carousel A", coverageType: "CONSEQUENCE", decision: "CREATE_CONTENT", selectedFormats: ["CAROUSEL"], angleId: null, destinationNeeded: false },
    { id: "4", text: "Text A", coverageType: "SOLUTION", decision: "CREATE_CONTENT", selectedFormats: ["TEXT_POST"], angleId: null, destinationNeeded: false },
  ], fixedNow);
  const plan = buildFormatPreviewPlan(repurposeInstance, world.blog.id, ideas, taskTypesById);
  const outcome = confirmPreviewPlan(plan, plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: "", deadline: "", selections: [] })), fixedNow);
  apply(world, outcomeToEntityActions(outcome));
  const tasks = spawn(world, outcome.taskDrafts);
  const taskFor = (title) => tasks.find((t) => t.title.startsWith(title));
  return { world, taskFor, materialFor: (title) => world.content.materials.find((m) => m.title.startsWith(title)) };
}

const REEL_AUTHORING = (destinationId) => ({ hook: "Hook", script: "Script", "cta-type": "RESOURCE", "cta-text": "Checklistni oling", ...(destinationId ? { "cta-destination-id": destinationId } : {}) });

// --- Architecture: one registry, no scattered conditionals ---

test("special completion behavior is registered centrally; generic Task Types have no handler", () => {
  for (const name of ["Angle", "Destination Decision", "Repurpose Map", "Reel Script", "Carousel", "Text Post", "YouTube", "Planning", "Shoot", "Edit", "Head Review"]) {
    assert.ok(handlers.TASK_RUNTIME_HANDLERS[name], `${name} should be registered`);
  }
  for (const name of ["Blog", "SEO", "Cover", "Caption", "Research"]) {
    assert.equal(handlers.TASK_RUNTIME_HANDLERS[name], undefined, `${name} must use the generic runtime`);
    assert.deepEqual(handlers.resolveRuntimeHandler(name), {});
  }
});

test("TaskDetail and WorkflowRunView contain no business-specific Task Type conditionals", () => {
  for (const file of ["components/task-detail.tsx", "components/workflow-run-view.tsx", "components/generated-task-preview.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const name of Object.keys(handlers.TASK_RUNTIME_HANDLERS)) {
      assert.ok(!source.includes(`"${name}"`), `${file} should not mention the Task Type "${name}"`);
    }
  }
});

test("every handler uiBlock key maps to a registered panel", () => {
  const source = readFileSync(new URL("../components/task-runtime-ui-blocks.tsx", import.meta.url), "utf8");
  for (const handler of Object.values(handlers.TASK_RUNTIME_HANDLERS)) {
    if (handler.uiBlock) assert.ok(source.includes(`${handler.uiBlock}:`), `${handler.uiBlock} missing from TASK_UI_BLOCKS`);
  }
});

test("a generic Task Type completes through the normal workflow runtime (Blog fans out to its parallel branches)", () => {
  const world = newWorld();
  const blogStep = template.steps.find((s) => taskTypesById.get(s.taskTypeId).name === "Blog");
  const blog = createTaskInstance({ taskTypeId: blogStep.taskTypeId, workflowTemplateId: template.id, workflowStepId: blogStep.id, title: "Blog", assignee: null, deadline: "2026-10-20", fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("KNOWLEDGE_NODE", world.node.id) }, fixedNow);
  world.instances.push(blog);
  const result = handlers.runTaskCompletion(ctxFor(world, blog), fixedNow);
  assert.equal(result.completeNow, false, "deferred until the preview is confirmed");
  assert.equal(result.plan.mode, "STEP_FANOUT");
});

// --- Authoring / CTA ---

test("Material starts IN_PRODUCTION together with its first authoring task", () => {
  const { world } = qoldiqWorldAfterRepurpose();
  assert.equal(world.content.materials.length, 4);
  assert.ok(world.content.materials.every((m) => m.status === "IN_PRODUCTION"));
  assert.ok(world.content.materials.every((m) => m.ctaType === null && m.destinationId === null));
});

test("CTA is required before an authoring task can Complete", () => {
  const { world, taskFor } = qoldiqWorldAfterRepurpose();
  const reel = patch(world, taskFor("Reel A"), { fieldValues: { hook: "h", script: "s" }, deadline: "2026-10-20" });
  const errors = handlers.runtimeCompletionErrors(ctxFor(world, reel));
  assert.ok(errors.some((e) => e.fieldId === "cta-type") && errors.some((e) => e.fieldId === "cta-text"));
  assert.equal(handlers.canCompleteWithHandler(ctxFor(world, reel)), false);
});

test("an exact Destination is required when the Material needs one, optional otherwise", () => {
  const { world, taskFor } = qoldiqWorldAfterRepurpose();
  const reelA = patch(world, taskFor("Reel A"), { fieldValues: REEL_AUTHORING(null) }); // destinationNeeded = true
  assert.ok(handlers.runtimeCompletionErrors(ctxFor(world, reelA)).some((e) => e.fieldId === "cta-destination-id"));
  const reelB = patch(world, taskFor("Reel B"), { fieldValues: REEL_AUTHORING(null) }); // destinationNeeded = false
  assert.deepEqual(handlers.runtimeCompletionErrors(ctxFor(world, reelB)), []);
});

test("completing authoring persists CTA + exact (PLANNED) Destination onto the Material", () => {
  const { world, taskFor, materialFor } = qoldiqWorldAfterRepurpose();
  const destination = world.content.destinations[0];
  assert.equal(destination.status, "PLANNED");
  completeTask(world, taskFor("Reel A"), { fieldValues: REEL_AUTHORING(destination.id) });
  const material = world.content.materials.find((m) => m.id === materialFor("Reel A").id);
  assert.equal(material.ctaType, "RESOURCE");
  assert.equal(material.ctaText, "Checklistni oling");
  assert.equal(material.destinationId, destination.id);
});

test("REEL authoring completion creates a Planning task ONLY -- no Shoot/Edit/Cover/Caption, Material stays IN_PRODUCTION", () => {
  const { world, taskFor, materialFor } = qoldiqWorldAfterRepurpose();
  const { created } = completeTask(world, taskFor("Reel B"), { fieldValues: REEL_AUTHORING(null) });
  assert.deepEqual(created.map(nameOf), ["Planning"]);
  assert.deepEqual(created[0].contentRef, entity.ref("MATERIAL", materialFor("Reel B").id));
  assert.equal(world.content.materials.find((m) => m.id === materialFor("Reel B").id).status, "IN_PRODUCTION");
  assert.ok(!world.instances.some((i) => ["Shoot", "Edit", "Cover", "Caption"].includes(nameOf(i))), "no future chain is pre-created");
});

test("YOUTUBE authoring also creates Planning only", () => {
  const world = newWorld();
  const material = entity.createMaterial({ blogId: world.blog.id, title: "YT", format: "YOUTUBE", primaryAtomicIdeaId: "i" }, fixedNow);
  apply(world, [{ type: "ADD_MATERIAL", material }]);
  const [task] = spawn(world, [{ taskTypeId: typeByName("YouTube").id, workflowTemplateId: null, workflowStepId: null, title: "YT", assignee: null, deadline: null, fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: entity.ref("MATERIAL", material.id) }]);
  const { created } = completeTask(world, task, { fieldValues: { outline: "o", script: "s", "cta-type": "WATCH_YOUTUBE", "cta-text": "Ko'ring" } });
  assert.deepEqual(created.map(nameOf), ["Planning"]);
});

test("CAROUSEL and TEXT_POST authoring completion marks the Material READY with no further task", () => {
  const { world, taskFor, materialFor } = qoldiqWorldAfterRepurpose();
  const carousel = completeTask(world, taskFor("Carousel A"), { fieldValues: { "slide-structure": "s", copy: "c", "cta-type": "FOLLOW", "cta-text": "Obuna bo'ling" } });
  const text = completeTask(world, taskFor("Text A"), { fieldValues: { post: "p", "cta-type": "ENGAGEMENT", "cta-text": "Fikringiz?" } });
  assert.deepEqual([...carousel.created, ...text.created], []);
  for (const title of ["Carousel A", "Text A"]) {
    assert.equal(world.content.materials.find((m) => m.id === materialFor(title).id).status, "READY");
  }
});

// --- Planning -> Ready for Shoot ---

test("Planning completion makes the Material shoot-eligible but never creates a Shoot automatically", () => {
  const { world, taskFor, materialFor } = qoldiqWorldAfterRepurpose();
  const { created } = completeTask(world, taskFor("Reel B"), { fieldValues: REEL_AUTHORING(null) });
  assert.deepEqual(mp.getReadyForShootMaterials(world.content, world.instances, taskTypesById), [], "not shoot-eligible before Planning completes");
  const planned = completeTask(world, created[0], { fieldValues: { "desired-shoot-date": "2026-10-13" } });
  assert.deepEqual(planned.created, []);
  assert.deepEqual(mp.getReadyForShootMaterials(world.content, world.instances, taskTypesById).map((m) => m.id), [materialFor("Reel B").id]);
  assert.equal(world.content.shootSessions.length, 0);
  assert.ok(!world.instances.some((i) => nameOf(i) === "Shoot"));
});

// --- The full Qoldiq demo ---

test("Qoldiq demo: Reel A + Reel B -> Shoot Session -> Shoot -> N x (Edit + Cover + Caption) -> Reel A ready after Edit alone", () => {
  const { world, taskFor, materialFor } = qoldiqWorldAfterRepurpose();
  const destination = world.content.destinations[0];

  // Reel A & B: authoring (+CTA, Destination for A) then Planning.
  for (const [title, destinationId] of [["Reel A", destination.id], ["Reel B", null]]) {
    const { created } = completeTask(world, taskFor(title), { fieldValues: REEL_AUTHORING(destinationId) });
    completeTask(world, created[0], { fieldValues: { "desired-shoot-date": "2026-10-13", location: "Ombor" } });
  }
  assert.deepEqual(mp.getReadyForShootMaterials(world.content, world.instances, taskTypesById).map((m) => m.title).sort(), ["Reel A — REEL", "Reel B — REEL"].sort());

  // Employee manually creates the session.
  const reelA = materialFor("Reel A");
  const reelB = materialFor("Reel B");
  const built = mp.buildShootSession({ title: "Tuesday Shoot — Reel A + Reel B", scheduledAt: "2026-10-13", assignee: null, materialIds: [reelA.id, reelB.id] }, world.content, world.instances, taskTypesById, typeByName("Shoot"), fixedNow);
  assert.equal(built.ok, true);
  apply(world, built.build.entityActions);
  const [shoot] = spawn(world, [built.build.shootTaskDraft]);
  assert.equal(world.instances.filter((i) => nameOf(i) === "Shoot").length, 1, "one batch Shoot task");
  assert.equal(shoot.assignee, "Operator / Montajer");

  // Complete Shoot -> preview of Edit/Cover/Caption per Material; Cancel creates nothing.
  const filledShoot = patch(world, shoot, { deadline: "2026-10-13" });
  const shootResult = handlers.runTaskCompletion(ctxFor(world, filledShoot), fixedNow);
  assert.equal(shootResult.completeNow, false);
  assert.equal(shootResult.plan.candidates.length, 6);
  assert.equal(world.instances.filter((i) => nameOf(i) === "Edit").length, 0, "Cancel (never confirming) creates nothing");

  // Confirm -> 2 Edit + 2 Cover + 2 Caption, unique ids, each pointing at the right Material.
  const selections = shootResult.plan.candidates.map((c) => ({ key: c.key, included: true, title: "", assignee: c.taskType.name === "Edit" ? "Operator / Montajer" : "", deadline: "2026-10-20", selections: [] }));
  const outcome = confirmPreviewPlan(shootResult.plan, selections, fixedNow);
  apply(world, outcomeToEntityActions(outcome));
  const production = spawn(world, outcome.taskDrafts);
  markDone(world, filledShoot);
  assert.equal(world.content.shootSessions[0].status, "COMPLETED");
  assert.equal(production.length, 6);
  assert.equal(new Set(production.map((t) => t.id)).size, 6);
  for (const material of [reelA, reelB]) {
    const mine = production.filter((t) => t.contentRef.entityId === material.id);
    assert.deepEqual(mine.map(nameOf).sort(), ["Caption", "Cover", "Edit"]);
    assert.ok(mine.every((t) => t.deadline === "2026-10-20" && t.workflowStepId === null));
  }
  assert.equal(production.filter((t) => nameOf(t) === "Edit").length, 2, "per-Material Edit, never a batch Edit");

  // Before Edit: Reel A is not ready for distribution.
  const readyTitles = () => mp.getReadyForDistribution(world.content, world.instances, taskTypesById).map((i) => i.material.title);
  assert.ok(!readyTitles().includes(reelA.title));

  // Complete only Reel A's Edit: Cover/Caption still open, Reel A is ready; Reel B is not.
  const editA = production.find((t) => nameOf(t) === "Edit" && t.contentRef.entityId === reelA.id);
  completeTask(world, editA, { fieldValues: { "final-cut": "https://example.com/final" } });
  const afterEdit = mp.getReadyForDistribution(world.content, world.instances, taskTypesById);
  assert.deepEqual(afterEdit.map((i) => i.material.id).filter((id) => [reelA.id, reelB.id].includes(id)), [reelA.id]);
  const reelAItem = afterEdit.find((i) => i.material.id === reelA.id);
  const statusOf = (name) => reelAItem.productionTasks.find((t) => t.taskType === name).status;
  assert.equal(statusOf("Edit"), "DONE");
  assert.equal(statusOf("Cover"), "ASSIGNED", "an incomplete Cover does not block Edit");
  assert.equal(statusOf("Caption"), "ASSIGNED", "an incomplete Caption does not block Edit");
  assert.equal(reelAItem.destination.status, "PLANNED", "a PLANNED Destination does not block distribution eligibility");

  // Carousel A and Text A become ready immediately after their own authoring.
  completeTask(world, taskFor("Carousel A"), { fieldValues: { "slide-structure": "s", copy: "c", "cta-type": "FOLLOW", "cta-text": "Obuna" } });
  completeTask(world, taskFor("Text A"), { fieldValues: { post: "p", "cta-type": "ENGAGEMENT", "cta-text": "Fikr?" } });
  assert.deepEqual(readyTitles().sort(), [reelA.title, materialFor("Carousel A").title, materialFor("Text A").title].sort());
});

test("Shoot completion enforces the required tasks: an `included: false` selection cannot drop Edit/Cover/Caption", () => {
  const { world, taskFor } = qoldiqWorldAfterRepurpose();
  const { created } = completeTask(world, taskFor("Reel B"), { fieldValues: REEL_AUTHORING(null) });
  completeTask(world, created[0], { fieldValues: { "desired-shoot-date": "2026-10-13" } });
  const reelB = world.content.materials.find((m) => m.title.startsWith("Reel B"));
  const built = mp.buildShootSession({ title: "S", scheduledAt: "2026-10-13", assignee: null, materialIds: [reelB.id] }, world.content, world.instances, taskTypesById, typeByName("Shoot"), fixedNow);
  apply(world, built.build.entityActions);
  const [shoot] = spawn(world, [built.build.shootTaskDraft]);
  const plan = handlers.runTaskCompletion(ctxFor(world, shoot), fixedNow).plan;
  const outcome = confirmPreviewPlan(plan, plan.candidates.map((c) => ({ key: c.key, included: false, title: "", assignee: "", deadline: "", selections: [] })), fixedNow);
  assert.deepEqual(outcome.taskDrafts.map((d) => taskTypesById.get(d.taskTypeId).name).sort(), ["Caption", "Cover", "Edit"]);
});

test("default assignees: Shoot and Edit go to the Operator role, Cover and Caption stay with the Content Owner", () => {
  const { world, taskFor } = qoldiqWorldAfterRepurpose();
  const { created } = completeTask(world, taskFor("Reel B"), { fieldValues: REEL_AUTHORING(null) });
  completeTask(world, created[0], { fieldValues: { "desired-shoot-date": "2026-10-13" } });
  const reelB = world.content.materials.find((m) => m.title.startsWith("Reel B"));
  const built = mp.buildShootSession({ title: "S", scheduledAt: "2026-10-13", assignee: null, materialIds: [reelB.id] }, world.content, world.instances, taskTypesById, typeByName("Shoot"), fixedNow);
  apply(world, built.build.entityActions);
  const [shoot] = spawn(world, [built.build.shootTaskDraft]);
  assert.equal(shoot.assignee, "Operator / Montajer");
  const plan = handlers.runTaskCompletion(ctxFor(world, shoot), fixedNow).plan;
  const outcome = confirmPreviewPlan(plan, [], fixedNow);
  const assigneeOf = (name) => outcome.taskDrafts.find((d) => taskTypesById.get(d.taskTypeId).name === name).assignee;
  assert.equal(assigneeOf("Edit"), "Operator / Montajer");
  assert.equal(assigneeOf("Cover"), null);
  assert.equal(assigneeOf("Caption"), null);
});

// --- Status vocabulary ---

test("no new operational task status was introduced; Material statuses stay within the minimal four", () => {
  assert.deepEqual([...TASK_INSTANCE_STATUSES], ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]);
  assert.deepEqual([...entity.MATERIAL_STATUSES], ["PLANNED", "IN_PRODUCTION", "READY", "PUBLISHED"]);
});

test("Angle's minimum-5 rule now comes from the registry", () => {
  const world = newWorld();
  const angleStep = template.steps.find((s) => taskTypesById.get(s.taskTypeId).name === "Angle");
  const angle = createTaskInstance({ taskTypeId: angleStep.taskTypeId, workflowTemplateId: template.id, workflowStepId: angleStep.id, title: "Angle", assignee: null, deadline: "2026-10-20", fieldValues: { angles: "a\nb\nc" }, customFields: [], links: [], sourceTaskId: null }, fixedNow);
  world.instances.push(angle);
  assert.equal(handlers.runtimeCompletionErrors(ctxFor(world, angle)).length, 1);
  const enough = patch(world, angle, { fieldValues: { angles: "a\nb\nc\nd\ne\nf" } });
  assert.deepEqual(handlers.runtimeCompletionErrors(ctxFor(world, enough)), []);
});
