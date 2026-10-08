import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-material-production-"));
for (const name of ["content-entity", "content-entity-fixtures", "content-entity-store", "task-instance", "workflow-runtime", "material-production"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const entity = require(join(dir, "content-entity.js"));
const { initialContentEntityState, contentEntityReducer, emptyContentEntityState, problemCategoryIdForMaterial, validateContentTree } = require(join(dir, "content-entity-store.js"));
const mp = require(join(dir, "material-production.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-10T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const SHOOT_TYPE = { id: "tt-shoot", name: "Shoot", defaultAssigneeRule: { kind: "FIXED_ROLE", role: "Operator / Montajer" } };

function worldWithMaterials(specs) {
  let state = initialContentEntityState();
  const node = state.knowledgeNodes[0];
  const blog = entity.createBlog(node.id, "Blog", null, fixedNow);
  state = contentEntityReducer(state, { type: "ADD_BLOGS", blogs: [blog] }, fixedNow);
  const materials = specs.map((spec) => ({ ...entity.createMaterial({ blogId: blog.id, title: spec.title, format: spec.format, primaryAtomicIdeaId: "idea-1", destinationNeeded: spec.destinationNeeded ?? false }, fixedNow), ...(spec.patch ?? {}) }));
  state = contentEntityReducer(state, { type: "ADD_MATERIALS", materials }, fixedNow);
  return { state, materials };
}

// --- CTA ---

test("CTA type and CTA text are both required", () => {
  const errors = mp.validateMaterialCta({ destinationNeeded: false }, { ctaType: null, ctaText: "", destinationId: null }, []);
  assert.deepEqual(errors.map((e) => e.fieldId).sort(), ["cta-text", "cta-type"]);
});

test("an exact Destination is not required for an ENGAGEMENT or FOLLOW CTA, even if the Material flagged destinationNeeded", () => {
  for (const ctaType of ["ENGAGEMENT", "FOLLOW"]) {
    assert.deepEqual(mp.validateMaterialCta({ destinationNeeded: true }, { ctaType, ctaText: "Izoh qoldiring", destinationId: null }, []), []);
  }
});

test("an exact Destination is required when destinationNeeded and the CTA actually points somewhere", () => {
  const errors = mp.validateMaterialCta({ destinationNeeded: true }, { ctaType: "RESOURCE", ctaText: "Checklist", destinationId: null }, []);
  assert.deepEqual(errors.map((e) => e.fieldId), ["cta-destination-id"]);
});

test("a Destination is optional when the Material does not need one", () => {
  assert.deepEqual(mp.validateMaterialCta({ destinationNeeded: false }, { ctaType: "RESOURCE", ctaText: "Checklist", destinationId: null }, []), []);
});

test("a PLANNED or IN_PROGRESS Destination from the same ProblemCategory is a valid exact Destination (READY is not required yet)", () => {
  const planned = entity.createDestination({ problemCategoryId: "pcat-1", name: "Planned", type: "CHECKLIST_OR_PDF" }, fixedNow);
  const inProgress = entity.setDestinationStatus(entity.createDestination({ problemCategoryId: "pcat-1", name: "WIP", type: "YOUTUBE" }, fixedNow), "IN_PROGRESS", fixedNow);
  for (const destination of [planned, inProgress]) {
    assert.deepEqual(mp.validateMaterialCta({ destinationNeeded: true }, { ctaType: "RESOURCE", ctaText: "x", destinationId: destination.id }, [planned, inProgress]), []);
  }
});

test("a Destination outside the Material's ProblemCategory library is rejected", () => {
  const errors = mp.validateMaterialCta({ destinationNeeded: true }, { ctaType: "RESOURCE", ctaText: "x", destinationId: "dest-from-elsewhere" }, []);
  assert.ok(errors.some((e) => e.code === "INVALID_FIELD_VALUE"));
});

test("CTA values persist back onto the Material entity (SET_MATERIAL_CTA)", () => {
  const { state, materials } = worldWithMaterials([{ title: "Reel A", format: "REEL" }]);
  const next = contentEntityReducer(state, { type: "SET_MATERIAL_CTA", id: materials[0].id, ctaType: "RESOURCE", ctaText: "Checklistni oling", destinationId: state.destinations[0].id }, fixedNow);
  const material = next.materials[0];
  assert.equal(material.ctaType, "RESOURCE");
  assert.equal(material.ctaText, "Checklistni oling");
  assert.equal(material.destinationId, state.destinations[0].id);
});

test("a Material resolves its ProblemCategory (and so its Destination Library) through Blog -> Node -> Part", () => {
  const { state, materials } = worldWithMaterials([{ title: "Reel A", format: "REEL" }]);
  assert.equal(problemCategoryIdForMaterial(state, materials[0]), state.problemCategories[0].id);
});

// --- Ready for Shoot / Shoot Session ---

test("a Material is Ready for Shoot only once Planning flagged it, and leaves the list when put in a session", () => {
  const { state, materials } = worldWithMaterials([{ title: "Reel A", format: "REEL" }, { title: "Reel B", format: "REEL", patch: { readyForShoot: true } }]);
  assert.deepEqual(mp.getReadyForShootMaterials(state).map((m) => m.title), ["Reel B"]);
  assert.equal(materials[0].readyForShoot, false);
});

test("Shoot Session creation is manual: only the chosen Ready-for-Shoot Materials join, others stay outside", () => {
  const { state, materials } = worldWithMaterials([
    { title: "Reel A", format: "REEL", patch: { readyForShoot: true } },
    { title: "Reel B", format: "REEL", patch: { readyForShoot: true } },
    { title: "Reel C", format: "REEL", patch: { readyForShoot: true } },
  ]);
  const result = mp.buildShootSession({ title: "Tuesday Shoot — 2 Reels", scheduledAt: "2026-10-13", assignee: null, materialIds: [materials[0].id, materials[1].id] }, state, SHOOT_TYPE, fixedNow);
  assert.equal(result.ok, true);
  const next = result.build.entityActions.reduce((acc, action) => contentEntityReducer(acc, action, fixedNow), state);
  assert.deepEqual(next.shootSessions[0].materialIds, [materials[0].id, materials[1].id]);
  assert.deepEqual(mp.getReadyForShootMaterials(next).map((m) => m.title), ["Reel C"]);
});

test("one Shoot Session produces exactly ONE Shoot task draft referencing every Material, never one per Material", () => {
  const { state, materials } = worldWithMaterials([
    { title: "Reel A", format: "REEL", patch: { readyForShoot: true } },
    { title: "Reel B", format: "REEL", patch: { readyForShoot: true } },
  ]);
  const result = mp.buildShootSession({ title: "Shoot", scheduledAt: "2026-10-13", assignee: "Operator 1", materialIds: materials.map((m) => m.id) }, state, SHOOT_TYPE, fixedNow);
  const draft = result.build.shootTaskDraft;
  assert.deepEqual(draft.contentRef, { entityType: "SHOOT_SESSION", entityId: result.build.session.id });
  assert.deepEqual(draft.relatedEntityRefs.map((r) => r.entityId), materials.map((m) => m.id));
  assert.equal(draft.assignee, "Operator 1");
  assert.equal(draft.deadline, "2026-10-13");
  assert.equal(draft.workflowStepId, null);
});

test("Shoot Session creation rejects a Material that is not Ready for Shoot, an empty selection, and a blank title", () => {
  const { state, materials } = worldWithMaterials([{ title: "Reel A", format: "REEL" }]);
  assert.equal(mp.buildShootSession({ title: "S", scheduledAt: null, assignee: null, materialIds: [materials[0].id] }, state, SHOOT_TYPE, fixedNow).ok, false);
  assert.equal(mp.buildShootSession({ title: "S", scheduledAt: null, assignee: null, materialIds: [] }, state, SHOOT_TYPE, fixedNow).ok, false);
  assert.equal(mp.buildShootSession({ title: "  ", scheduledAt: null, assignee: null, materialIds: [materials[0].id] }, state, SHOOT_TYPE, fixedNow).ok, false);
});

test("a Material already in a session cannot be put into a second session", () => {
  const { state, materials } = worldWithMaterials([{ title: "Reel A", format: "REEL", patch: { readyForShoot: true, shootSessionId: "shoot-1" } }]);
  assert.equal(mp.buildShootSession({ title: "S", scheduledAt: null, assignee: null, materialIds: [materials[0].id] }, state, SHOOT_TYPE, fixedNow).ok, false);
});

test("a Shoot Session is not a knowledge-tree node and its material references are validated", () => {
  const session = entity.createShootSession({ title: "S", scheduledAt: null, assignee: null, materialIds: ["missing"] }, fixedNow);
  const state = { ...emptyContentEntityState(), shootSessions: [session] };
  assert.deepEqual(validateContentTree(state).map((e) => e.code), ["ORPHAN_SHOOT_SESSION"]);
});

// --- Ready for Distribution ---

test("Ready for Distribution lists only READY Materials; Destination status is displayed but never blocks", () => {
  const { state, materials } = worldWithMaterials([
    { title: "Carousel A", format: "CAROUSEL", patch: { status: "READY", ctaType: "RESOURCE", ctaText: "x" } },
    { title: "Reel A", format: "REEL", patch: { status: "IN_PRODUCTION" } },
  ]);
  const withDestination = contentEntityReducer(state, { type: "SET_MATERIAL_DESTINATION", id: materials[0].id, destinationId: state.destinations[0].id }, fixedNow);
  const items = mp.getReadyForDistribution(withDestination, [], new Map());
  assert.deepEqual(items.map((i) => i.material.title), ["Carousel A"]);
  assert.equal(items[0].destination.status, "PLANNED", "a PLANNED Destination does not keep the Material out of the queue");
});

test("dependency metadata records that Edit unlocks the Distribution Plan while Cover/Caption only may block Publish later", () => {
  assert.equal(mp.PRODUCTION_TASK_DEPENDENCY_METADATA.Edit.unlocksDistributionPlan, true);
  for (const name of ["Cover", "Caption"]) {
    assert.equal(mp.PRODUCTION_TASK_DEPENDENCY_METADATA[name].unlocksDistributionPlan, false);
    assert.equal(mp.PRODUCTION_TASK_DEPENDENCY_METADATA[name].mayBlockPublishCompletion, true);
  }
});
