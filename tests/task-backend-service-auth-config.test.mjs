import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-service-auth-config-"));
for (const name of ["task-backend-service-auth-config"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { resolveTaskBackendServiceAuthConfig, TaskBackendServiceAuthConfigError } = require(join(dir, "task-backend-service-auth-config.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("unset env resolves to null -- disabled by default", () => {
  assert.equal(resolveTaskBackendServiceAuthConfig({}), null);
});

test("explicit \"false\" resolves to null", () => {
  assert.equal(resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "false" }), null);
});

test("\"true\" with no base URL or secret fails fast instead of running unsigned", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "true" }),
    TaskBackendServiceAuthConfigError,
  );
});

test("\"true\" with only the base URL set still fails (secret required too)", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "true", TASK_BACKEND_BASE_URL: "https://tasks.example.com" }),
    TaskBackendServiceAuthConfigError,
  );
});

test("\"true\" with only the secret set still fails (base URL required too)", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "true", CONTENT_OS_TASK_BACKEND_SECRET: "shh" }),
    TaskBackendServiceAuthConfigError,
  );
});

test("a fully configured https target resolves", () => {
  const config = resolveTaskBackendServiceAuthConfig({
    TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
    TASK_BACKEND_BASE_URL: "https://tasks.example.com",
    CONTENT_OS_TASK_BACKEND_SECRET: "a-real-secret",
  });
  assert.deepEqual(config, { baseUrl: "https://tasks.example.com", secret: "a-real-secret" });
});

test("a fully configured localhost target resolves (for local mock-server testing)", () => {
  const config = resolveTaskBackendServiceAuthConfig({
    TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
    TASK_BACKEND_BASE_URL: "http://127.0.0.1:4000",
    CONTENT_OS_TASK_BACKEND_SECRET: "a-real-secret",
  });
  assert.equal(config.baseUrl, "http://127.0.0.1:4000");
});

test("a non-https, non-local base URL is rejected even when otherwise fully configured", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({
      TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
      TASK_BACKEND_BASE_URL: "http://example.com",
      CONTENT_OS_TASK_BACKEND_SECRET: "a-real-secret",
    }),
    TaskBackendServiceAuthConfigError,
  );
});

test("a malformed URL fails fast with a clear diagnostic", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({
      TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
      TASK_BACKEND_BASE_URL: "not a url",
      CONTENT_OS_TASK_BACKEND_SECRET: "a-real-secret",
    }),
    TaskBackendServiceAuthConfigError,
  );
});

test("an unrecognized enabled value fails fast instead of being treated as false", () => {
  assert.throws(
    () => resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "yes" }),
    TaskBackendServiceAuthConfigError,
  );
});
