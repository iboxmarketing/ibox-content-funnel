import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

test("no NEXT_PUBLIC_ variant of the task-backend secret exists anywhere", () => {
  const offenders = [];
  const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(TASK_BACKEND|CONTENT_OS)[A-Z0-9_]*SECRET[A-Z0-9_]*/g;
  for (const name of [
    "content-os-task-backend-signer.ts",
    "task-backend-service-auth-config.ts",
    "task-client-signed-service.ts",
  ]) {
    const text = readFileSync(join(REPO_ROOT, "lib", name), "utf8");
    const matches = text.match(pattern);
    if (matches) offenders.push({ name, matches });
  }
  const envText = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
  const envMatches = envText.match(pattern);
  if (envMatches) offenders.push({ name: ".env.example", envMatches });
  assert.deepEqual(offenders, []);
});

test("no production task-backend URL is hardcoded anywhere in the new files", () => {
  const offenders = [];
  for (const name of ["content-os-task-backend-signer.ts", "task-backend-service-auth-config.ts", "task-client-signed-service.ts"]) {
    const text = readFileSync(join(REPO_ROOT, "lib", name), "utf8");
    if (/marketing-team-task-bot\.vercel\.app/.test(text) || /https:\/\/[a-z0-9-]+\.(vercel\.app|com)["'`]/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the signer never reads process.env or a bare secret itself -- the secret is always an explicit function parameter", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/content-os-task-backend-signer.ts"), "utf8");
  assert.doesNotMatch(text, /process\.env/);
  assert.match(text, /export function signTaskBackendRequest\(/);
});

test("getTaskClient() still only ever returns BlockedTaskClient -- SignedServiceTaskClient is never the default", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/task-client.ts"), "utf8");
  assert.doesNotMatch(text, /SignedServiceTaskClient|HttpTaskClient/, "task-client.ts (the default factory) must not reference either real client");
  assert.match(text, /export function getTaskClient\(\): TaskClient \{\s*return new BlockedTaskClient\(\);\s*\}/);
});

test("nothing outside the tests directory calls getSignedServiceTaskClient, constructs SignedServiceTaskClient, or signs a request", () => {
  const productionFiles = ["lib/data-source.ts", "lib/task-client.ts", "app/api/production/tasks/route.ts"];
  for (const file of productionFiles) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.doesNotMatch(text, /SignedServiceTaskClient|getSignedServiceTaskClient|signTaskBackendRequest/, file);
  }
});

test("app/api/production/tasks is still untouched by this change: PATCH stays 503 TASK_BACKEND_SETUP_REQUIRED", () => {
  const text = readFileSync(join(REPO_ROOT, "app/api/production/tasks/route.ts"), "utf8");
  assert.match(text, /export async function PATCH/);
  assert.match(text, /status:\s*503/);
  assert.match(text, /TASK_BACKEND_SETUP_REQUIRED/);
  assert.doesNotMatch(text, /export (async )?function (POST|PUT|DELETE)/);
});
