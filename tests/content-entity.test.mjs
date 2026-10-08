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
  const material = createMaterial({ blogId: "blog-1", title: "Reel: atomic idea", format: "REEL", primaryAtomicIdea: "Qaytgan tovar muammosi" }, fixedNow);
  assert.equal(material.blogId, "blog-1");
  assert.equal(material.format, "REEL");
  assert.equal(material.status, "PLANNED");
  assert.equal(material.primaryAtomicIdea, "Qaytgan tovar muammosi");
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
