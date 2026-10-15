import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-signer-"));
for (const name of ["content-os-task-backend-signer"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const {
  signTaskBackendRequest,
  TaskBackendSignerInputError,
  CONTENT_OS_TASK_BACKEND_PROVIDER,
  CONTENT_OS_TIMESTAMP_HEADER,
  CONTENT_OS_ACTOR_PROVIDER_HEADER,
  CONTENT_OS_ACTOR_SUBJECT_HEADER,
  CONTENT_OS_SIGNATURE_HEADER,
} = require(join(dir, "content-os-task-backend-signer.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const SECRET = "test-content-os-task-backend-secret";
const FIXED_NOW = () => new Date("2026-09-22T12:00:00.000Z");

function baseInput(overrides = {}) {
  return {
    method: "POST",
    path: "/api/tasks",
    bodyText: JSON.stringify({ title: "Draft a carousel" }),
    externalSubject: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

test("the provider is fixed to CONTENT_OS_TELEGRAM_SESSION, not configurable", () => {
  assert.equal(CONTENT_OS_TASK_BACKEND_PROVIDER, "CONTENT_OS_TELEGRAM_SESSION");
  const headers = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  assert.equal(headers[CONTENT_OS_ACTOR_PROVIDER_HEADER], "CONTENT_OS_TELEGRAM_SESSION");
});

test("signing is deterministic: identical input and secret produce the identical signature every time", () => {
  const a = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  assert.equal(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
  assert.equal(a[CONTENT_OS_TIMESTAMP_HEADER], b[CONTENT_OS_TIMESTAMP_HEADER]);
});

test("the timestamp header is unix seconds matching the injected clock", () => {
  const headers = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  assert.equal(headers[CONTENT_OS_TIMESTAMP_HEADER], String(Math.floor(FIXED_NOW().getTime() / 1000)));
});

test("the current Telegram-session public.users id is included verbatim in the emitted headers", () => {
  const externalSubject = "33333333-3333-4333-8333-333333333333";
  const headers = signTaskBackendRequest(baseInput({ externalSubject }), SECRET, FIXED_NOW);
  assert.equal(headers[CONTENT_OS_ACTOR_SUBJECT_HEADER], externalSubject);
});

test("changing the body changes the signature", () => {
  const a = signTaskBackendRequest(baseInput({ bodyText: JSON.stringify({ title: "A" }) }), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput({ bodyText: JSON.stringify({ title: "B" }) }), SECRET, FIXED_NOW);
  assert.notEqual(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});

test("changing the method changes the signature", () => {
  const a = signTaskBackendRequest(baseInput({ method: "POST" }), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput({ method: "DELETE" }), SECRET, FIXED_NOW);
  assert.notEqual(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});

test("changing the path changes the signature", () => {
  const a = signTaskBackendRequest(baseInput({ path: "/api/tasks/aaaa/actions" }), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput({ path: "/api/tasks/bbbb/actions" }), SECRET, FIXED_NOW);
  assert.notEqual(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});

test("changing the external subject changes the signature -- one identity cannot reuse another's signed request", () => {
  const a = signTaskBackendRequest(baseInput({ externalSubject: "22222222-2222-4222-8222-222222222222" }), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput({ externalSubject: "33333333-3333-4333-8333-333333333333" }), SECRET, FIXED_NOW);
  assert.notEqual(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});

test("a different secret produces a different signature for identical input", () => {
  const a = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput(), "a-completely-different-secret", FIXED_NOW);
  assert.notEqual(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});

test("missing externalSubject is rejected before any signature is computed", () => {
  assert.throws(() => signTaskBackendRequest(baseInput({ externalSubject: "" }), SECRET, FIXED_NOW), TaskBackendSignerInputError);
});

test("missing secret is rejected", () => {
  assert.throws(() => signTaskBackendRequest(baseInput(), "", FIXED_NOW), TaskBackendSignerInputError);
});

test("the returned headers never contain the secret value itself, in any field", () => {
  const headers = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  for (const value of Object.values(headers)) {
    assert.doesNotMatch(String(value), new RegExp(SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.deepEqual(Object.keys(headers).sort(), [
    CONTENT_OS_ACTOR_PROVIDER_HEADER,
    CONTENT_OS_ACTOR_SUBJECT_HEADER,
    CONTENT_OS_SIGNATURE_HEADER,
    CONTENT_OS_TIMESTAMP_HEADER,
  ].sort());
});

test("the signature is a 64-character lowercase hex string (HMAC-SHA256)", () => {
  const headers = signTaskBackendRequest(baseInput(), SECRET, FIXED_NOW);
  assert.match(headers[CONTENT_OS_SIGNATURE_HEADER], /^[0-9a-f]{64}$/);
});

test("a bodyless (GET) request signs the empty string as its body hash input, deterministically", () => {
  const a = signTaskBackendRequest(baseInput({ method: "GET", bodyText: "" }), SECRET, FIXED_NOW);
  const b = signTaskBackendRequest(baseInput({ method: "GET", bodyText: "" }), SECRET, FIXED_NOW);
  assert.equal(a[CONTENT_OS_SIGNATURE_HEADER], b[CONTENT_OS_SIGNATURE_HEADER]);
});
