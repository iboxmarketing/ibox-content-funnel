import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-content-entity-store-"));
for (const name of ["content-entity", "content-entity-fixtures", "content-entity-store"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  initialContentEntityState,
  emptyContentEntityState,
  contentEntityReducer,
  problemCategoriesForDomain,
  problemPartsForCategory,
  knowledgeNodesForPart,
  blogsForNode,
  materialsForBlog,
  anglesForKnowledgeNode,
  destinationsForProblemCategory,
  destinationsForAngle,
  anglesForDestination,
  materialsForDestination,
  repurposeMapForBlog,
  atomicIdeasForRepurposeMap,
  entityByRef,
  labelForRef,
  validateContentTree,
} = require(join(dir, "content-entity-store.js"));
const {
  createDomain,
  createProblemCategory,
  createProblemPart,
  createKnowledgeNode,
  createBlog,
  createMaterial,
  createAngle,
  createDestination,
  createAngleDestinationLink,
  createRepurposeMap,
  createAtomicIdea,
  ref,
} = require(join(dir, "content-entity.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-09T01:00:${String(tick++).padStart(2, "0")}.000Z`;

test("initialContentEntityState seeds the Qoldiq noto'g'ri fixture: one domain, one category, 6 parts, some nodes", () => {
  const state = initialContentEntityState();
  assert.equal(state.domains.length, 1);
  assert.equal(state.problemCategories.length, 1);
  assert.equal(state.problemParts.length, 6);
  assert.ok(state.knowledgeNodes.length >= 2);
  assert.equal(state.blogs.length, 0);
  assert.equal(state.materials.length, 0);
  assert.equal(state.angles.length, 0);
  assert.equal(state.destinations.length, 1, "the 'Qoldiq audit checklist' demo fixture destination");
  assert.equal(state.destinations[0].problemCategoryId, state.problemCategories[0].id);
});

test("the fixture tree has valid parent relationships end to end", () => {
  const state = initialContentEntityState();
  assert.deepEqual(validateContentTree(state), []);
});

test("tree lookups: ProblemPart belongs to ProblemCategory, KnowledgeNode belongs to ProblemPart", () => {
  const state = initialContentEntityState();
  const category = state.problemCategories[0];
  const parts = problemPartsForCategory(state, category.id);
  assert.equal(parts.length, 6);
  for (const part of parts) assert.equal(part.problemCategoryId, category.id);

  const firstPart = parts[0];
  const nodes = knowledgeNodesForPart(state, firstPart.id);
  for (const node of nodes) assert.equal(node.problemPartId, firstPart.id);
});

test("problemCategoriesForDomain filters by domainId", () => {
  const state = initialContentEntityState();
  const domain = state.domains[0];
  assert.equal(problemCategoriesForDomain(state, domain.id).length, 1);
  assert.equal(problemCategoriesForDomain(state, "nope").length, 0);
});

test("ADD_PROBLEM_PARTS / ADD_KNOWLEDGE_NODES / ADD_BLOGS append without mutating prior state", () => {
  const state = initialContentEntityState();
  const category = state.problemCategories[0];
  const newPart = createProblemPart(category.id, "Yangi qism", "ti-split-1", fixedNow);
  const next = contentEntityReducer(state, { type: "ADD_PROBLEM_PARTS", parts: [newPart] }, fixedNow);
  assert.equal(next.problemParts.length, 7);
  assert.equal(state.problemParts.length, 6, "original state must be untouched");

  const node = createKnowledgeNode(newPart.id, "Yangi node", "ti-kd-1", fixedNow);
  const withNode = contentEntityReducer(next, { type: "ADD_KNOWLEDGE_NODES", nodes: [node] }, fixedNow);
  assert.equal(withNode.knowledgeNodes.length, next.knowledgeNodes.length + 1);

  const blog = createBlog(node.id, "Yangi blog", "ti-research-1", fixedNow);
  const withBlog = contentEntityReducer(withNode, { type: "ADD_BLOGS", blogs: [blog] }, fixedNow);
  assert.equal(withBlog.blogs.length, 1);
  assert.equal(blogsForNode(withBlog, node.id).length, 1);
});

test("SET_KNOWLEDGE_NODE_STATUS updates one node by id and is a no-op for an unknown id", () => {
  const state = initialContentEntityState();
  const node = state.knowledgeNodes[0];
  const next = contentEntityReducer(state, { type: "SET_KNOWLEDGE_NODE_STATUS", id: node.id, status: "PLANNED" }, fixedNow);
  assert.equal(next.knowledgeNodes.find((n) => n.id === node.id).status, "PLANNED");
  const noop = contentEntityReducer(state, { type: "SET_KNOWLEDGE_NODE_STATUS", id: "does-not-exist", status: "PLANNED" }, fixedNow);
  assert.equal(noop, state);
});

test("SET_BLOG_STATE and SET_BLOG_PRIMARY_LINK target one blog by id", () => {
  const node = createKnowledgeNode("part-1", "Node", null, fixedNow);
  const blog = createBlog(node.id, "Blog", null, fixedNow);
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_BLOGS", blogs: [blog] }, fixedNow);
  state = contentEntityReducer(state, { type: "SET_BLOG_STATE", id: blog.id, state: "DRAFT" }, fixedNow);
  assert.equal(state.blogs[0].state, "DRAFT");
  state = contentEntityReducer(state, { type: "SET_BLOG_PRIMARY_LINK", id: blog.id, primaryLink: "https://example.com/post" }, fixedNow);
  assert.equal(state.blogs[0].primaryLink, "https://example.com/post");
});

test("ADD_MATERIAL and materialsForBlog", () => {
  const material = createMaterial({ blogId: "blog-1", title: "Reel", format: "REEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  const state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_MATERIAL", material }, fixedNow);
  assert.equal(materialsForBlog(state, "blog-1").length, 1);
  assert.equal(materialsForBlog(state, "blog-2").length, 0);
});

test("ADD_MATERIALS / SET_MATERIAL_STATUS / SET_MATERIAL_DESTINATION", () => {
  const m1 = createMaterial({ blogId: "blog-1", title: "Reel", format: "REEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  const m2 = createMaterial({ blogId: "blog-1", title: "Carousel", format: "CAROUSEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_MATERIALS", materials: [m1, m2] }, fixedNow);
  assert.equal(state.materials.length, 2);
  state = contentEntityReducer(state, { type: "SET_MATERIAL_STATUS", id: m1.id, status: "IN_PRODUCTION" }, fixedNow);
  assert.equal(state.materials.find((m) => m.id === m1.id).status, "IN_PRODUCTION");
  state = contentEntityReducer(state, { type: "SET_MATERIAL_DESTINATION", id: m1.id, destinationId: "dest-1" }, fixedNow);
  assert.equal(state.materials.find((m) => m.id === m1.id).destinationId, "dest-1");
  assert.equal(materialsForDestination(state, "dest-1").length, 1);
});

// --- Angle / Destination relations ---

test("DESTINATION: destinationsForProblemCategory is scoped -- no leakage across ProblemCategories", () => {
  const destA = createDestination({ problemCategoryId: "pcat-A", name: "Checklist A", type: "CHECKLIST_OR_PDF" }, fixedNow);
  const destB = createDestination({ problemCategoryId: "pcat-B", name: "Checklist B", type: "CHECKLIST_OR_PDF" }, fixedNow);
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_DESTINATION", destination: destA }, fixedNow);
  state = contentEntityReducer(state, { type: "ADD_DESTINATION", destination: destB }, fixedNow);
  assert.deepEqual(destinationsForProblemCategory(state, "pcat-A").map((d) => d.id), [destA.id]);
  assert.deepEqual(destinationsForProblemCategory(state, "pcat-B").map((d) => d.id), [destB.id]);
  assert.equal(destinationsForProblemCategory(state, "pcat-C").length, 0);
});

test("a new Destination (ADD_DESTINATION) starts PLANNED and SET_DESTINATION_STATUS updates it by id", () => {
  const destination = createDestination({ problemCategoryId: "pcat-1", name: "New checklist", type: "CHECKLIST_OR_PDF" }, fixedNow);
  assert.equal(destination.status, "PLANNED");
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_DESTINATION", destination }, fixedNow);
  state = contentEntityReducer(state, { type: "SET_DESTINATION_STATUS", id: destination.id, status: "READY" }, fixedNow);
  assert.equal(state.destinations[0].status, "READY");
});

test("one Destination can link to multiple Angles, and anglesForDestination/destinationsForAngle are many-to-many", () => {
  const destination = createDestination({ problemCategoryId: "pcat-1", name: "Checklist", type: "CHECKLIST_OR_PDF" }, fixedNow);
  const angle1 = createAngle("node-1", { title: "Angle 1" }, null, fixedNow);
  const angle2 = createAngle("node-1", { title: "Angle 2" }, null, fixedNow);
  const link1 = createAngleDestinationLink(angle1.id, destination.id, fixedNow);
  const link2 = createAngleDestinationLink(angle2.id, destination.id, fixedNow);
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_ANGLES", angles: [angle1, angle2] }, fixedNow);
  state = contentEntityReducer(state, { type: "ADD_DESTINATION", destination }, fixedNow);
  state = contentEntityReducer(state, { type: "ADD_ANGLE_DESTINATION_LINKS", links: [link1, link2] }, fixedNow);
  assert.deepEqual(anglesForDestination(state, destination.id).map((a) => a.id).sort(), [angle1.id, angle2.id].sort());
  assert.deepEqual(destinationsForAngle(state, angle1.id).map((d) => d.id), [destination.id]);
});

test("anglesForKnowledgeNode is scoped to one KnowledgeNode (no global Angle library leakage)", () => {
  const angleA = createAngle("node-A", { title: "Angle A" }, null, fixedNow);
  const angleB = createAngle("node-B", { title: "Angle B" }, null, fixedNow);
  const state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_ANGLES", angles: [angleA, angleB] }, fixedNow);
  assert.deepEqual(anglesForKnowledgeNode(state, "node-A").map((a) => a.id), [angleA.id]);
  assert.deepEqual(anglesForKnowledgeNode(state, "node-B").map((a) => a.id), [angleB.id]);
});

// --- RepurposeMap / AtomicIdea ---

test("ADD_REPURPOSE_MAP / ADD_ATOMIC_IDEAS and their lookups", () => {
  const map = createRepurposeMap("blog-1", "ti-rmap-1", fixedNow);
  const idea1 = createAtomicIdea({ repurposeMapId: map.id, text: "Idea 1", coverageType: "PROBLEM", decision: "CREATE_CONTENT", selectedFormats: ["REEL"] }, fixedNow);
  const idea2 = createAtomicIdea({ repurposeMapId: map.id, text: "Idea 2", coverageType: "CAUSE", decision: "LATER", selectedFormats: [] }, fixedNow);
  let state = contentEntityReducer(emptyContentEntityState(), { type: "ADD_REPURPOSE_MAP", repurposeMap: map }, fixedNow);
  state = contentEntityReducer(state, { type: "ADD_ATOMIC_IDEAS", ideas: [idea1, idea2] }, fixedNow);
  assert.equal(repurposeMapForBlog(state, "blog-1").id, map.id);
  assert.equal(atomicIdeasForRepurposeMap(state, map.id).length, 2);
});

test("entityByRef / labelForRef resolve across all 9 entity types", () => {
  const domain = createDomain("Ombor", fixedNow);
  const category = createProblemCategory(domain.id, "Qoldiq noto'g'ri", fixedNow);
  const part = createProblemPart(category.id, "Hisobda kam", null, fixedNow);
  const node = createKnowledgeNode(part.id, "Node A", null, fixedNow);
  const blog = createBlog(node.id, "Blog A", null, fixedNow);
  const material = createMaterial({ blogId: blog.id, title: "Reel A", format: "REEL", primaryAtomicIdeaId: "idea-1" }, fixedNow);
  const angle = createAngle(node.id, { title: "Angle A" }, null, fixedNow);
  const destination = createDestination({ problemCategoryId: category.id, name: "Checklist A", type: "CHECKLIST_OR_PDF" }, fixedNow);
  const repurposeMap = createRepurposeMap(blog.id, null, fixedNow);
  const state = {
    domains: [domain], problemCategories: [category], problemParts: [part], knowledgeNodes: [node], blogs: [blog], materials: [material],
    angles: [angle], destinations: [destination], angleDestinationLinks: [], repurposeMaps: [repurposeMap], atomicIdeas: [],
  };

  assert.equal(entityByRef(state, ref("DOMAIN", domain.id)), domain);
  assert.equal(entityByRef(state, ref("BLOG", "missing")), undefined);
  assert.equal(labelForRef(state, ref("DOMAIN", domain.id)), "Ombor");
  assert.equal(labelForRef(state, ref("PROBLEM_CATEGORY", category.id)), "Qoldiq noto'g'ri");
  assert.equal(labelForRef(state, ref("PROBLEM_PART", part.id)), "Hisobda kam");
  assert.equal(labelForRef(state, ref("KNOWLEDGE_NODE", node.id)), "Node A");
  assert.equal(labelForRef(state, ref("BLOG", blog.id)), "Blog A");
  assert.equal(labelForRef(state, ref("MATERIAL", material.id)), "Reel A");
  assert.equal(labelForRef(state, ref("ANGLE", angle.id)), "Angle A");
  assert.equal(labelForRef(state, ref("DESTINATION", destination.id)), "Checklist A");
  assert.equal(labelForRef(state, ref("REPURPOSE_MAP", repurposeMap.id)), repurposeMap.id);
  assert.equal(labelForRef(state, ref("KNOWLEDGE_NODE", "missing")), null);
});

test("validateContentTree flags an orphaned entity at every level", () => {
  const node = createKnowledgeNode("missing-part", "Orphan node", null, fixedNow);
  const state = { ...emptyContentEntityState(), knowledgeNodes: [node] };
  const errors = validateContentTree(state);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "ORPHAN_KNOWLEDGE_NODE");
});

test("validateContentTree flags an orphaned Angle, Destination, RepurposeMap, and AtomicIdea", () => {
  const angle = createAngle("missing-node", { title: "Orphan angle" }, null, fixedNow);
  const destination = createDestination({ problemCategoryId: "missing-cat", name: "Orphan dest", type: "CHECKLIST_OR_PDF" }, fixedNow);
  const map = createRepurposeMap("missing-blog", null, fixedNow);
  const idea = createAtomicIdea({ repurposeMapId: "missing-map", text: "Orphan idea", coverageType: "OTHER", decision: "LATER", selectedFormats: [] }, fixedNow);
  const state = { ...emptyContentEntityState(), angles: [angle], destinations: [destination], repurposeMaps: [map], atomicIdeas: [idea] };
  const codes = validateContentTree(state).map((e) => e.code).sort();
  assert.deepEqual(codes, ["ORPHAN_ANGLE", "ORPHAN_ATOMIC_IDEA", "ORPHAN_DESTINATION", "ORPHAN_REPURPOSE_MAP"]);
});
