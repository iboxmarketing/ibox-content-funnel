import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-reconciliation-"));
for (const name of ["data-source-reconciliation"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { reconcileByStableRef, looksLikeDashPrefixedStableRef } = require(join(dir, "data-source-reconciliation.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

function rec(stableRef, fields = {}, version = null) {
  return { stableRef, fields, version };
}

test("identical records on both sides produce zero mismatches and one matched row", () => {
  const sheet = [rec("CP-001", { title: "A" })];
  const supabase = [rec("CP-001", { title: "A" })];
  const report = reconcileByStableRef(sheet, supabase);
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.matchedCount, 1);
  assert.equal(report.sheetCount, 1);
  assert.equal(report.supabaseCount, 1);
});

test("MISSING_IN_SUPABASE: a stable ref present only in the Sheet", () => {
  const report = reconcileByStableRef([rec("TP-010")], []);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].category, "MISSING_IN_SUPABASE");
  assert.equal(report.mismatches[0].stableRef, "TP-010");
});

test("MISSING_IN_SHEET: a stable ref present only in Supabase", () => {
  const report = reconcileByStableRef([], [rec("TPI-042")]);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].category, "MISSING_IN_SHEET");
  assert.equal(report.mismatches[0].stableRef, "TPI-042");
});

test("FIELD_DIFF: one differing field is reported with both values, unrelated matching fields are not", () => {
  const sheet = [rec("ND-7", { title: "Old title", status: "active" })];
  const supabase = [rec("ND-7", { title: "New title", status: "active" })];
  const report = reconcileByStableRef(sheet, supabase);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].category, "FIELD_DIFF");
  assert.match(report.mismatches[0].detail, /"title"/);
  assert.equal(report.mismatches[0].sheetValue, "Old title");
  assert.equal(report.mismatches[0].supabaseValue, "New title");
  assert.equal(report.matchedCount, 0);
});

test("FIELD_DIFF also fires when a field exists on only one side (missing key treated as null)", () => {
  const sheet = [rec("TT-3", { onlyOnSheet: "x" })];
  const supabase = [rec("TT-3", {})];
  const report = reconcileByStableRef(sheet, supabase);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].category, "FIELD_DIFF");
  assert.equal(report.mismatches[0].sheetValue, "x");
  assert.equal(report.mismatches[0].supabaseValue, null);
});

test("VERSION_DIFF: differing version markers are reported even when fields are identical", () => {
  const sheet = [rec("CL-9", { title: "same" }, "v1")];
  const supabase = [rec("CL-9", { title: "same" }, "v2")];
  const report = reconcileByStableRef(sheet, supabase);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].category, "VERSION_DIFF");
});

test("version is not compared when either side omits it", () => {
  const sheet = [rec("CL-9", { title: "same" }, null)];
  const supabase = [rec("CL-9", { title: "same" }, "v2")];
  const report = reconcileByStableRef(sheet, supabase);
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.matchedCount, 1);
});

test("DUPLICATE_STABLE_REF is reported per side independently of missing/field comparison", () => {
  const sheet = [rec("CP-1", { title: "a" }), rec("CP-1", { title: "b" })];
  const supabase = [rec("CP-1", { title: "a" })];
  const report = reconcileByStableRef(sheet, supabase);
  const duplicate = report.mismatches.find((m) => m.category === "DUPLICATE_STABLE_REF");
  assert.ok(duplicate, "expected a DUPLICATE_STABLE_REF mismatch");
  assert.match(duplicate.detail, /Sheet has 2 rows/);
});

test("a duplicated stable ref is never counted toward matchedCount, even when its first row happens to agree", () => {
  const sheet = [rec("CP-1", { title: "a" }), rec("CP-1", { title: "b" })];
  const supabase = [rec("CP-1", { title: "a" })];
  const report = reconcileByStableRef(sheet, supabase);
  assert.equal(report.matchedCount, 0, "ambiguous (duplicated) refs are not a confident match");
});

test("a full mixed fixture set produces every documented mismatch category and no others", () => {
  const sheet = [
    rec("CP-001", { title: "match" }),
    rec("TP-010"),
    rec("ND-7", { title: "old" }),
    rec("CL-9", { title: "x" }, "v1"),
    rec("CP-DUP", {}),
    rec("CP-DUP", {}),
  ];
  const supabase = [
    rec("CP-001", { title: "match" }),
    rec("TPI-042"),
    rec("ND-7", { title: "new" }),
    rec("CL-9", { title: "x" }, "v2"),
    rec("CP-DUP", {}),
  ];
  const report = reconcileByStableRef(sheet, supabase);
  const categories = new Set(report.mismatches.map((m) => m.category));
  assert.deepEqual(
    [...categories].sort(),
    ["DUPLICATE_STABLE_REF", "FIELD_DIFF", "MISSING_IN_SHEET", "MISSING_IN_SUPABASE", "VERSION_DIFF"].sort(),
  );
  assert.equal(report.matchedCount, 1);
  assert.equal(report.sheetCount, 6);
  assert.equal(report.supabaseCount, 5);
});

test("looksLikeDashPrefixedStableRef recognizes the six dash-prefixed families and rejects everything else", () => {
  for (const ref of ["CP-001", "CL-9", "ND-7", "TP-010", "TPI-042", "TT-3"]) {
    assert.equal(looksLikeDashPrefixedStableRef(ref), true, ref);
  }
  for (const ref of ["WF-TEXT", "random", "", "cp-001"]) {
    assert.equal(looksLikeDashPrefixedStableRef(ref), false, ref);
  }
});
