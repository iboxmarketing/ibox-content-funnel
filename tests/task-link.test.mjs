import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-link-"));
for (const name of ["task-link"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { createTaskLink, isValidLinkUrl, validateTaskLink, addLink, updateLink, removeLink } = require(join(dir, "task-link.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T02:00:${String(tick++).padStart(2, "0")}.000Z`;

test("isValidLinkUrl accepts http/https, rejects everything else", () => {
  assert.equal(isValidLinkUrl("https://example.com/doc"), true);
  assert.equal(isValidLinkUrl("http://example.com"), true);
  assert.equal(isValidLinkUrl("ftp://example.com"), false);
  assert.equal(isValidLinkUrl("javascript:alert(1)"), false);
  assert.equal(isValidLinkUrl("not a url"), false);
  assert.equal(isValidLinkUrl(""), false);
});

test("validateTaskLink flags missing label and invalid URL independently", () => {
  assert.deepEqual(validateTaskLink({ label: "Script", url: "https://example.com" }), []);
  assert.deepEqual(validateTaskLink({ label: "", url: "https://example.com" }).map((e) => e.code), ["MISSING_LABEL"]);
  assert.deepEqual(validateTaskLink({ label: "Script", url: "bad" }).map((e) => e.code), ["INVALID_URL"]);
  assert.deepEqual(validateTaskLink({ label: "", url: "bad" }).map((e) => e.code).sort(), ["INVALID_URL", "MISSING_LABEL"]);
});

test("createTaskLink assigns a stable id", () => {
  const link = createTaskLink({ label: "Figma", url: "https://figma.com/x" }, fixedNow);
  assert.ok(link.id);
  assert.equal(link.label, "Figma");
});

test("addLink / updateLink / removeLink support multiple links and custom labels", () => {
  let links = [];
  links = addLink(links, { label: "Script", url: "https://example.com/1" }, fixedNow);
  links = addLink(links, { label: "My Custom Label", url: "https://example.com/2" }, fixedNow);
  assert.equal(links.length, 2);
  assert.equal(links[1].label, "My Custom Label");

  const targetId = links[0].id;
  links = updateLink(links, targetId, { url: "https://example.com/1-edited" });
  assert.equal(links.find((l) => l.id === targetId).url, "https://example.com/1-edited");

  links = removeLink(links, targetId);
  assert.equal(links.length, 1);
  assert.equal(links[0].label, "My Custom Label");
});
