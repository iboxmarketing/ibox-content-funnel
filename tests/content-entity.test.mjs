import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-content-entity-"));
for (const name of ["content-entity"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  ref,
  createDomain,
  createProblemCategory,
  createProblemPart,
  createKnowledgeNode,
  setKnowledgeNodeStatus,
  createBlog,
  setBlogState,
  createMaterial,
  setMaterialStatus,
  setMaterialDestination,
  createAngle,
  createDestination,
  setDestinationStatus,
  isDestinationReadyForPublish,
  createAngleDestinationLink,
  createRepurposeMap,
  createAtomicIdea,
  setMaterialCta,
  setMaterialProduction,
  createShootSession,
  setShootSessionStatus,
  MATERIAL_STATUSES,
  CTA_TYPES,
} = require(join(dir, "content-entity.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-09T00:00:${String(tick++).padStart(2, "0")}.000Z`;

test("createDomain / createProblemCategory / createProblemPart chain parent ids correctly", () => {
  const domain = createDomain("Ombor", fixedNow);
  const category = createProblemCategory(domain.id, "Qoldiq noto'g'ri", fixedNow);
  const part = createProblemPart(category.id, "Hisobda kam", null, fixedNow);
  assert.equal(category.domainId, domain.id);
  assert.equal(part.problemCategoryId, category.id);
  assert.equal(part.sourceTaskId, null);
});

test("createKnowledgeNode starts UNPLANNED and tracks its generating task", () => {
  const node = createKnowledgeNode("part-1", "Qaytgan tovar", "ti-kd-1", fixedNow);
  assert.equal(node.status, "UNPLANNED");
  assert.equal(node.sourceTaskId, "ti-kd-1");
});

test("setKnowledgeNodeStatus is a no-op when already at the target status", () => {
  const node = createKnowledgeNode("part-1", "Node", null, fixedNow);
  const same = setKnowledgeNodeStatus(node, "UNPLANNED", fixedNow);
  assert.equal(same, node);
  const planned = setKnowledgeNodeStatus(node, "PLANNED", fixedNow);
  assert.equal(planned.status, "PLANNED");
  assert.notEqual(planned, node);
});

test("createBlog starts PLANNED with no primary link, tied to its KnowledgeNode", () => {
  const blog = createBlog("node-1", "Qaytgan tovar — blog", "ti-research-1", fixedNow);
  assert.equal(blog.knowledgeNodeId, "node-1");
  assert.equal(blog.state, "PLANNED");
  assert.equal(blog.primaryLink, null);
  assert.equal(blog.sourceTaskId, "ti-research-1");
});

test("setBlogState transitions state and is a no-op when unchanged", () => {
  const blog = createBlog("node-1", "Title", null, fixedNow);
  assert.equal(setBlogState(blog, "PLANNED", fixedNow), blog);
  const draft = setBlogState(blog, "DRAFT", fixedNow);
  assert.equal(draft.state, "DRAFT");
});

test("createMaterial establishes the minimal Repurpose entity boundary without a production chain", () => {
  const material = createMaterial({ blogId: "blog-1", title: "Reel: atomic idea", format: "REEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  assert.equal(material.blogId, "blog-1");
  assert.equal(material.format, "REEL");
  assert.equal(material.status, "PLANNED");
  assert.equal(material.primaryAtomicIdeaId, "idea-1");
  assert.equal(material.angleId, null);
  assert.equal(material.destinationNeeded, false);
  assert.equal(material.destinationId, null);
});

test("createMaterial honors angle/destination relations when provided", () => {
  const material = createMaterial({ blogId: "blog-1", title: "Carousel", format: "CAROUSEL", primaryAtomicIdeaId: "idea-1", angleId: "angle-1", destinationNeeded: true }, fixedNow);
  assert.equal(material.angleId, "angle-1");
  assert.equal(material.destinationNeeded, true);
  assert.equal(material.destinationId, null, "exact destination is never forced at Material creation time");
});

test("setMaterialStatus / setMaterialDestination update one material", () => {
  const material = createMaterial({ blogId: "blog-1", title: "Carousel", format: "CAROUSEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  assert.equal(setMaterialStatus(material, "PLANNED", fixedNow), material);
  const inProduction = setMaterialStatus(material, "IN_PRODUCTION", fixedNow);
  assert.equal(inProduction.status, "IN_PRODUCTION");
  const withDestination = setMaterialDestination(material, "dest-1", fixedNow);
  assert.equal(withDestination.destinationId, "dest-1");
});

// --- Angle (local to one KnowledgeNode, never a global library) ---

test("createAngle belongs to exactly one KnowledgeNode and defaults its classification fields", () => {
  const angle = createAngle("node-1", { title: "Ortiqcha xarid" }, "ti-angle-1", fixedNow);
  assert.equal(angle.knowledgeNodeId, "node-1");
  assert.equal(angle.title, "Ortiqcha xarid");
  assert.equal(angle.usage, "BOTH");
  assert.equal(angle.priority, "LATER");
  assert.equal(angle.painScore, 0);
  assert.equal(angle.sourceTaskId, "ti-angle-1");
});

test("createAngle honors explicit classification values", () => {
  const angle = createAngle("node-1", { title: "Muzlagan pul", category: "Moliya", usage: "PERFORMANCE", priority: "NOW", painScore: 4, clarityScore: 5, evidenceScore: 3, iboxRelevanceScore: 5, organicPotential: 2, performancePotential: 4 }, null, fixedNow);
  assert.equal(angle.category, "Moliya");
  assert.equal(angle.usage, "PERFORMANCE");
  assert.equal(angle.priority, "NOW");
  assert.equal(angle.painScore, 4);
});

// --- Destination (belongs to a ProblemCategory, never the knowledge tree) ---

test("createDestination belongs to a ProblemCategory and starts PLANNED", () => {
  const destination = createDestination({ problemCategoryId: "pcat-1", name: "Qoldiq audit checklist", type: "CHECKLIST_OR_PDF" }, fixedNow);
  assert.equal(destination.problemCategoryId, "pcat-1");
  assert.equal(destination.status, "PLANNED");
  assert.equal(destination.primaryUrl, null);
});

test("setDestinationStatus transitions and is a no-op when unchanged; isDestinationReadyForPublish reads READY", () => {
  const destination = createDestination({ problemCategoryId: "pcat-1", name: "Checklist", type: "CHECKLIST_OR_PDF" }, fixedNow);
  assert.equal(setDestinationStatus(destination, "PLANNED", fixedNow), destination);
  const ready = setDestinationStatus(destination, "READY", fixedNow);
  assert.equal(isDestinationReadyForPublish(ready), true);
  assert.equal(isDestinationReadyForPublish(destination), false);
});

test("createAngleDestinationLink is a plain many-to-many join row", () => {
  const link = createAngleDestinationLink("angle-1", "dest-1", fixedNow);
  assert.equal(link.angleId, "angle-1");
  assert.equal(link.destinationId, "dest-1");
  assert.ok(link.id);
});

// --- RepurposeMap + AtomicIdea ---

test("createRepurposeMap is associated with exactly one Blog", () => {
  const map = createRepurposeMap("blog-1", "ti-repurpose-1", fixedNow);
  assert.equal(map.blogId, "blog-1");
  assert.equal(map.sourceTaskId, "ti-repurpose-1");
});

test("createAtomicIdea supports multiple selected formats, an optional angle, and independent destinationNeeded", () => {
  const idea = createAtomicIdea({ repurposeMapId: "rmap-1", text: "Muammo nima?", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL", "CAROUSEL", "TEXT_POST"], angleId: "angle-1", destinationNeeded: true }, fixedNow);
  assert.deepEqual(idea.selectedFormats, ["REEL", "CAROUSEL", "TEXT_POST"]);
  assert.equal(idea.angleId, "angle-1");
  assert.equal(idea.destinationNeeded, true);
});

test("createAtomicIdea defaults angleId to null and destinationNeeded to false", () => {
  const idea = createAtomicIdea({ repurposeMapId: "rmap-1", text: "Qanday tekshirish mumkin?", coverageType: "SOLUTION", decision: "LATER", selectedFormats: [] }, fixedNow);
  assert.equal(idea.angleId, null);
  assert.equal(idea.destinationNeeded, false);
  assert.deepEqual(idea.selectedFormats, []);
});

test("ref() builds a typed ContentEntityRef", () => {
  assert.deepEqual(ref("KNOWLEDGE_NODE", "node-1"), { entityType: "KNOWLEDGE_NODE", entityId: "node-1" });
});

test("entity ids are never shaped like task ids (no accidental id-space collision)", () => {
  const domain = createDomain("Ombor", fixedNow);
  const node = createKnowledgeNode("part-1", "Node", null, fixedNow);
  assert.ok(domain.id.startsWith("dom-"));
  assert.ok(node.id.startsWith("node-"));
  assert.ok(!domain.id.startsWith("ti-"));
  assert.ok(!node.id.startsWith("ti-"));
});

test("Material starts with no CTA and outside any Shoot Session", () => {
  const material = createMaterial({ blogId: "b", title: "Reel", format: "REEL", primaryAtomicIdeaId: "i" }, fixedNow);
  assert.equal(material.ctaType, null);
  assert.equal(material.ctaText, null);
  assert.equal(material.shootSessionId, null);
});

test("setMaterialCta stores the CTA on the Material; setMaterialProduction touches only the Shoot Session link", () => {
  const material = createMaterial({ blogId: "b", title: "Reel", format: "REEL", primaryAtomicIdeaId: "i" }, fixedNow);
  const withCta = setMaterialCta(material, { ctaType: "RESOURCE", ctaText: "Oling", destinationId: "dest-1" }, fixedNow);
  assert.deepEqual([withCta.ctaType, withCta.ctaText, withCta.destinationId], ["RESOURCE", "Oling", "dest-1"]);
  assert.equal(withCta.shootSessionId, null);
  assert.equal("readyForShoot" in withCta, false, "Ready-for-Shoot is derived, never stored on the Material");
  const inSession = setMaterialProduction(withCta, { shootSessionId: "s-1" }, fixedNow);
  assert.equal(inSession.shootSessionId, "s-1");
  assert.equal(inSession.ctaText, "Oling");
});

test("CTA types and the minimal Material status vocabulary", () => {
  assert.deepEqual([...CTA_TYPES], ["ENGAGEMENT", "FOLLOW", "READ_BLOG", "WATCH_YOUTUBE", "NEXT_CONTENT", "RESOURCE", "COMMERCIAL", "CUSTOM"]);
  assert.deepEqual([...MATERIAL_STATUSES], ["PLANNED", "IN_PRODUCTION", "READY", "PUBLISHED"]);
});

test("createShootSession holds many Materials, starts PLANNED, and is a no-op to re-set the same status", () => {
  const session = createShootSession({ title: "Tuesday Shoot", scheduledAt: "2026-10-13", assignee: null, materialIds: ["m1", "m2"] }, fixedNow);
  assert.equal(session.status, "PLANNED");
  assert.deepEqual(session.materialIds, ["m1", "m2"]);
  assert.ok(session.id.startsWith("shoot-"));
  assert.equal(setShootSessionStatus(session, "PLANNED", fixedNow), session);
  assert.equal(setShootSessionStatus(session, "COMPLETED", fixedNow).status, "COMPLETED");
});
