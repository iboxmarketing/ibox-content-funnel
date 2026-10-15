/** Transpiles lib/persistence (+ content-entity) into a temp dir, like the unit tests. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

export function compilePersistence() {
  const dir = mkdtempSync(join(tmpdir(), "ibox-e2e-"));
  mkdirSync(join(dir, "persistence"));
  symlinkSync(new URL("../../../node_modules", import.meta.url).pathname, join(dir, "node_modules"), "dir");
  const compile = (from, to) => writeFileSync(to, ts.transpileModule(readFileSync(new URL(from, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
  compile("../../../lib/content-entity.ts", join(dir, "content-entity.js"));
  for (const name of ["task-type-codes", "ports", "idempotency", "transition-contract", "memory-adapter", "supabase-adapter", "actor-resolver", "blog-review-flow", "config", "blog-review-api", "index"]) {
    compile(`../../../lib/persistence/${name}.ts`, join(dir, "persistence", `${name}.js`));
  }
  const require = createRequire(import.meta.url);
  return { load: (name) => require(join(dir, "persistence", `${name}.js`)), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
