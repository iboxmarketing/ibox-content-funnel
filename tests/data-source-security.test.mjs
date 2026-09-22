import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SCAN_DIRS = ["lib", "app", "components", "hooks"].filter((d) => {
  try {
    return statSync(join(REPO_ROOT, d)).isDirectory();
  } catch {
    return false;
  }
});

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const allSourceFiles = SCAN_DIRS.flatMap((d) => listSourceFiles(join(REPO_ROOT, d)));

test("no NEXT_PUBLIC_ env var name looks like a Supabase secret, service-role key, or private key", () => {
  const offenders = [];
  const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE_KEY)[A-Z0-9_]*/g;
  for (const file of [...allSourceFiles, join(REPO_ROOT, ".env.example")]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const matches = text.match(pattern);
    if (matches) offenders.push({ file: relative(REPO_ROOT, file), matches });
  }
  assert.deepEqual(offenders, []);
});

test("the Supabase repository stub contains no guessed table/column query (.from(...) call)", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/data-source-supabase-repository.ts"), "utf8");
  assert.doesNotMatch(text, /\.from\(/, "a .from(...) call would imply a guessed Supabase table name");
});

test("SupabaseRepository's constructor defaults its contract to pendingSchemaContract(), never to a literal READY status", () => {
  const repoText = readFileSync(join(REPO_ROOT, "lib/data-source-supabase-repository.ts"), "utf8");
  assert.match(repoText, /contract: SupabaseSchemaContract = pendingSchemaContract\(entityName\)/);
  // Comments may discuss a future READY contract; no *default parameter* may assign one literally.
  assert.doesNotMatch(repoText, /=\s*\{[^}]*status:\s*"READY"/s);
});

test("the task client has exactly one concrete implementation (no second writable task source)", () => {
  const clientText = readFileSync(join(REPO_ROOT, "lib/task-client.ts"), "utf8");
  const implementCount = (clientText.match(/implements TaskClient/g) ?? []).length;
  assert.equal(implementCount, 1);

  const otherOffenders = allSourceFiles
    .filter((f) => !f.endsWith("lib/task-client.ts") && !f.endsWith("lib/task-client-types.ts"))
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return /implements\s+TaskClient\b/.test(text);
    });
  assert.deepEqual(otherOffenders.map((f) => relative(REPO_ROOT, f)), []);
});

test("the task client stub never hardcodes an HTTP call to a guessed endpoint", () => {
  const text = readFileSync(join(REPO_ROOT, "lib/task-client.ts"), "utf8");
  assert.doesNotMatch(text, /fetch\(\s*["'`]https?:/);
});

test("app/api/production/tasks stays blocked: exactly one PATCH handler, 503, TASK_BACKEND_SETUP_REQUIRED", () => {
  const text = readFileSync(join(REPO_ROOT, "app/api/production/tasks/route.ts"), "utf8");
  assert.match(text, /export async function PATCH/);
  assert.match(text, /status:\s*503/);
  assert.match(text, /TASK_BACKEND_SETUP_REQUIRED/);
  assert.doesNotMatch(text, /export (async )?function (POST|PUT|DELETE)/, "no additional write verb should exist on this route while it is blocked");
});
