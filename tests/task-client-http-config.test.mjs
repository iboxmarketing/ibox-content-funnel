import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-task-client-http-config-"));
for (const name of ["task-client-http-config"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { resolveTaskBackendHttpConfig, TaskBackendHttpConfigError } = require(join(dir, "task-client-http-config.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("unset env resolves to null -- auth missing fails closed by construction, not by exception", () => {
  assert.equal(resolveTaskBackendHttpConfig({}), null);
});

test("a fully configured localhost target resolves (for local mock-server testing)", () => {
  const config = resolveTaskBackendHttpConfig({
    TASK_BACKEND_BASE_URL: "http://127.0.0.1:4000",
    TASK_BACKEND_SESSION_COOKIE: "fake-session-value",
  });
  assert.deepEqual(config, { baseUrl: "http://127.0.0.1:4000", sessionCookie: "fake-session-value" });
});

test("a non-https, non-local base URL is rejected -- no plaintext production target", () => {
  assert.throws(
    () => resolveTaskBackendHttpConfig({ TASK_BACKEND_BASE_URL: "http://example.com", TASK_BACKEND_SESSION_COOKIE: "x" }),
    TaskBackendHttpConfigError,
  );
});

test("https base URL is accepted", () => {
  const config = resolveTaskBackendHttpConfig({
    TASK_BACKEND_BASE_URL: "https://marketing-team-task-bot.example",
    TASK_BACKEND_SESSION_COOKIE: "x",
  });
  assert.equal(config.baseUrl, "https://marketing-team-task-bot.example");
});

test("setting only one of the two required env vars fails fast instead of silently constructing a half-config", () => {
  assert.throws(() => resolveTaskBackendHttpConfig({ TASK_BACKEND_BASE_URL: "https://x.example" }), TaskBackendHttpConfigError);
  assert.throws(() => resolveTaskBackendHttpConfig({ TASK_BACKEND_SESSION_COOKIE: "x" }), TaskBackendHttpConfigError);
});

test("a malformed URL fails fast with a clear diagnostic", () => {
  assert.throws(
    () => resolveTaskBackendHttpConfig({ TASK_BACKEND_BASE_URL: "not a url", TASK_BACKEND_SESSION_COOKIE: "x" }),
    TaskBackendHttpConfigError,
  );
});
