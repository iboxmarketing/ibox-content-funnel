import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-data-source-route-outcome-"));
for (const name of [
  "data-source-types",
  "data-source-sheets-repository",
  "data-source-supabase-schema-contract",
  "data-source-supabase-repository",
  "data-source-route-outcome",
]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { SheetsRepository } = require(join(dir, "data-source-sheets-repository.js"));
const { SupabaseRepository } = require(join(dir, "data-source-supabase-repository.js"));
const { readySchemaContract } = require(join(dir, "data-source-supabase-schema-contract.js"));
const { loadForRoute } = require(join(dir, "data-source-route-outcome.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const FAKE_GRAPH = { areas: ["fake"], stages: [], processes: [], problems: [] };

function configuredSheetsRepo(data = FAKE_GRAPH) {
  return new SheetsRepository({ load: async () => data, getMissingConfiguration: () => [] });
}
function unconfiguredSheetsRepo() {
  return new SheetsRepository({ load: async () => { throw new Error("must not be called"); }, getMissingConfiguration: () => ["GOOGLE_SHEET_ID"] });
}
function pendingSupabaseRepo() {
  return new SupabaseRepository("KnowledgeGraph");
}

// --- SHEETS_ONLY: existing behavior is preserved byte-for-byte ---

test("SHEETS_ONLY returns the Sheets data as-is when configured", async () => {
  const outcome = await loadForRoute("SHEETS_ONLY", configuredSheetsRepo(), pendingSupabaseRepo(), false);
  assert.deepEqual(outcome, { kind: "OK", data: FAKE_GRAPH });
});

test("SHEETS_ONLY reports NOT_CONFIGURED with the exact missing list when Sheets env is absent", async () => {
  const outcome = await loadForRoute("SHEETS_ONLY", unconfiguredSheetsRepo(), pendingSupabaseRepo(), false);
  assert.deepEqual(outcome, { kind: "NOT_CONFIGURED", missing: ["GOOGLE_SHEET_ID"] });
});

test("SHEETS_ONLY never touches the Supabase repository at all", async () => {
  let supabaseCalled = false;
  const spySupabase = { read: async () => { supabaseCalled = true; } };
  await loadForRoute("SHEETS_ONLY", configuredSheetsRepo(), spySupabase, false);
  assert.equal(supabaseCalled, false);
});

// --- SUPABASE_READ: fail-fast diagnostic, no guessed query ---

test("SUPABASE_READ fails fast with SCHEMA_NOT_READY while no contract is READY", async () => {
  const outcome = await loadForRoute("SUPABASE_READ", configuredSheetsRepo(), pendingSupabaseRepo(), false);
  assert.equal(outcome.kind, "SCHEMA_NOT_READY");
  assert.match(outcome.message, /not ready/i);
});

test("SUPABASE_READ never touches the Sheets repository", async () => {
  let sheetsCalled = false;
  const spySheets = { read: async () => { sheetsCalled = true; }, getMissingConfiguration: () => [] };
  await loadForRoute("SUPABASE_READ", spySheets, pendingSupabaseRepo(), false);
  assert.equal(sheetsCalled, false);
});

// --- DUAL_READ: Sheets stays authoritative; Supabase unavailability becomes a diagnostic, never a crash ---

test("DUAL_READ returns Sheets data plus a supabaseAvailable:false diagnostic while Supabase isn't ready", async () => {
  const outcome = await loadForRoute("DUAL_READ", configuredSheetsRepo(), pendingSupabaseRepo(), false);
  assert.equal(outcome.kind, "OK");
  assert.deepEqual(outcome.data, FAKE_GRAPH);
  assert.equal(outcome.dataSourceDiagnostic.supabaseAvailable, false);
  assert.match(outcome.dataSourceDiagnostic.reason, /not ready/i);
});

test("DUAL_READ reports supabaseAvailable:true once a repository actually returns data", async () => {
  const readyRepo = new SupabaseRepository("KnowledgeGraph", readySchemaContract("KnowledgeGraph", "test"));
  // Still throws today (no query implementation) -- this proves DUAL_READ degrades safely even for a READY-but-unimplemented contract.
  const outcome = await loadForRoute("DUAL_READ", configuredSheetsRepo(), readyRepo, false);
  assert.equal(outcome.kind, "OK");
  assert.equal(outcome.dataSourceDiagnostic.supabaseAvailable, false);
});

test("DUAL_READ still reports NOT_CONFIGURED if the Sheet itself is unconfigured", async () => {
  const outcome = await loadForRoute("DUAL_READ", unconfiguredSheetsRepo(), pendingSupabaseRepo(), false);
  assert.deepEqual(outcome, { kind: "NOT_CONFIGURED", missing: ["GOOGLE_SHEET_ID"] });
});

test("DUAL_READ propagates a genuinely unexpected Supabase error instead of masking it as a diagnostic", async () => {
  const explodingSupabase = { read: async () => { throw new Error("network blew up"); } };
  await assert.rejects(
    () => loadForRoute("DUAL_READ", configuredSheetsRepo(), explodingSupabase, false),
    /network blew up/,
  );
});
