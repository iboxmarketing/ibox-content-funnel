import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

test("no production task-bot URL is hardcoded anywhere in lib/", () => {
  const offenders = [];
  for (const name of ["task-client.ts", "task-client-http.ts", "task-client-http-config.ts", "task-client-types.ts"]) {
    const text = readFileSync(join(REPO_ROOT, "lib", name), "utf8");
    if (/marketing-team-task-bot\.vercel\.app/.test(text) || /https:\/\/[a-z0-9-]+\.(vercel\.app|com)["'`]/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});

test("getTaskClient() still only ever returns BlockedTaskClient -- HttpTaskClient is never the default", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/task-client.ts"), "utf8");
  assert.doesNotMatch(text, /HttpTaskClient/, "task-client.ts (the default factory) must not import or reference HttpTaskClient");
  assert.match(text, /export function getTaskClient\(\): TaskClient \{\s*return new BlockedTaskClient\(\);\s*\}/);
});

test("HttpTaskClient is constructed only from an explicit config object, never from a bare env read inside the class", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/task-client-http.ts"), "utf8");
  assert.doesNotMatch(text, /process\.env/);
  assert.doesNotMatch(text, /cloudflare:workers/);
});

test("nothing outside the tests directory calls resolveTaskBackendHttpConfig or constructs HttpTaskClient", () => {
  const productionFiles = ["lib/data-source.ts", "app/api/production/tasks/route.ts"];
  for (const file of productionFiles) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.doesNotMatch(text, /HttpTaskClient|resolveTaskBackendHttpConfig/, file);
  }
});
