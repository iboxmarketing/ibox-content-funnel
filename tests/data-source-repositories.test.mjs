import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-data-source-repos-"));
for (const name of [
  "data-source-types",
  "data-source-sheets-repository",
  "data-source-supabase-schema-contract",
  "data-source-supabase-repository",
]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { SheetsNotConfiguredError, SchemaContractNotReadyError } = require(join(dir, "data-source-types.js"));
const { SheetsRepository } = require(join(dir, "data-source-sheets-repository.js"));
const { SupabaseRepository } = require(join(dir, "data-source-supabase-repository.js"));
const { pendingSchemaContract, readySchemaContract, isSchemaContractReady } = require(join(dir, "data-source-supabase-schema-contract.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

// --- SheetsRepository: existing Sheets behavior is preserved through the wrapper ---

test("SheetsRepository.read() delegates to the injected loader unchanged when configured", async () => {
  let calledWithForce;
  const fakeGraph = { areas: [], stages: [], processes: [], problems: [] };
  const repo = new SheetsRepository({
    load: async (force) => {
      calledWithForce = force;
      return fakeGraph;
    },
    getMissingConfiguration: () => [],
  });

  const result = await repo.read(true);
  assert.equal(calledWithForce, true);
  assert.equal(result.source, "SHEETS");
  assert.equal(result.data, fakeGraph);
});

test("SheetsRepository.read() defaults force to false, matching the existing loadX(force = false) signatures", async () => {
  let calledWithForce = "not-called";
  const repo = new SheetsRepository({
    load: async (force) => {
      calledWithForce = force;
      return {};
    },
    getMissingConfiguration: () => [],
  });
  await repo.read();
  assert.equal(calledWithForce, false);
});

test("SheetsRepository.read() fails fast with SheetsNotConfiguredError instead of calling the loader", async () => {
  let loaderCalled = false;
  const repo = new SheetsRepository({
    load: async () => {
      loaderCalled = true;
      return {};
    },
    getMissingConfiguration: () => ["GOOGLE_SHEET_ID", "GOOGLE_PRIVATE_KEY"],
  });

  await assert.rejects(() => repo.read(), SheetsNotConfiguredError);
  assert.equal(loaderCalled, false, "the doomed Sheets fetch must never be attempted when config is missing");
});

test("SheetsRepository.getMissingConfiguration() mirrors getMissingGoogleConfiguration()'s return shape", () => {
  const repo = new SheetsRepository({ load: async () => ({}), getMissingConfiguration: () => ["GOOGLE_SHEET_ID"] });
  assert.deepEqual(repo.getMissingConfiguration(), ["GOOGLE_SHEET_ID"]);
});

// --- SupabaseRepository: fail-fast until a schema contract is READY ---

test("SupabaseRepository.read() fails fast with SchemaContractNotReadyError by default (pending contract)", async () => {
  const repo = new SupabaseRepository("KnowledgeGraph");
  assert.equal(isSchemaContractReady(repo.getSchemaContract()), false);
  await assert.rejects(() => repo.read(), SchemaContractNotReadyError);
});

test("SupabaseRepository never reaches a query even if constructed with force=true", async () => {
  const repo = new SupabaseRepository("ProductionDataset");
  await assert.rejects(() => repo.read(true), (error) => {
    assert.ok(error instanceof SchemaContractNotReadyError);
    assert.equal(error.entity, "ProductionDataset");
    return true;
  });
});

test("SupabaseRepository still fails fast even with an explicit but non-READY contract", async () => {
  const repo = new SupabaseRepository("CatalogPreview", pendingSchemaContract("CatalogPreview"));
  await assert.rejects(() => repo.read(), SchemaContractNotReadyError);
});

test("a READY contract is the only way past the fail-fast guard, and no production call site marks one READY", async () => {
  const contract = readySchemaContract("KnowledgeGraph", "test-only contract");
  assert.equal(isSchemaContractReady(contract), true);
  const repo = new SupabaseRepository("KnowledgeGraph", contract);
  // Even READY still throws today: no query implementation exists yet.
  await assert.rejects(() => repo.read(), SchemaContractNotReadyError);
});
