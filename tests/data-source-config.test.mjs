import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-data-source-config-"));
for (const name of ["data-source-types", "data-source-config"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { resolveDataSourceMode, isReadOnlyMode } = require(join(dir, "data-source-config.js"));
const { DataSourceConfigurationError } = require(join(dir, "data-source-types.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("unset DATA_SOURCE defaults to SHEETS_ONLY", () => {
  assert.equal(resolveDataSourceMode({}), "SHEETS_ONLY");
  assert.equal(resolveDataSourceMode({ DATA_SOURCE: "" }), "SHEETS_ONLY");
  assert.equal(resolveDataSourceMode({ DATA_SOURCE: "   " }), "SHEETS_ONLY");
});

test("each documented mode round-trips case- and separator-insensitively, except SUPABASE_WRITE", () => {
  assert.equal(resolveDataSourceMode({ DATA_SOURCE: "sheets_only" }), "SHEETS_ONLY");
  assert.equal(resolveDataSourceMode({ DATA_SOURCE: "Dual-Read" }), "DUAL_READ");
  assert.equal(resolveDataSourceMode({ DATA_SOURCE: "supabase read" }), "SUPABASE_READ");
});

test("SUPABASE_WRITE is recognized but always rejected today, not silently downgraded", () => {
  assert.throws(() => resolveDataSourceMode({ DATA_SOURCE: "SUPABASE_WRITE" }), DataSourceConfigurationError);
  assert.throws(() => resolveDataSourceMode({ DATA_SOURCE: "supabase-write" }), DataSourceConfigurationError);
  try {
    resolveDataSourceMode({ DATA_SOURCE: "SUPABASE_WRITE" });
    assert.fail("expected throw");
  } catch (error) {
    assert.match(error.message, /not enabled yet/i);
  }
});

test("an unrecognized value fails fast with a clear diagnostic instead of guessing a mode", () => {
  assert.throws(() => resolveDataSourceMode({ DATA_SOURCE: "airtable" }), DataSourceConfigurationError);
  try {
    resolveDataSourceMode({ DATA_SOURCE: "airtable" });
    assert.fail("expected throw");
  } catch (error) {
    assert.match(error.message, /not recognized/i);
    assert.match(error.message, /SHEETS_ONLY/);
  }
});

test("isReadOnlyMode is true for every mode this codebase can currently resolve to", () => {
  assert.equal(isReadOnlyMode("SHEETS_ONLY"), true);
  assert.equal(isReadOnlyMode("DUAL_READ"), true);
  assert.equal(isReadOnlyMode("SUPABASE_READ"), true);
  assert.equal(isReadOnlyMode("SUPABASE_WRITE"), false);
});
