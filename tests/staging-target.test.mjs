/**
 * Sprint 11B: Cloudflare staging target safety — the runtime Supabase-target
 * guard, origin-only Task Bot base URL, the staging preflight, and the
 * wrangler staging environment.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { checkSecrets, checkWorkerConfig, parseSecretsFile, STAGING } from "../scripts/staging-preflight.mjs";

const dir = mkdtempSync(join(tmpdir(), "ibox-staging-target-"));
mkdirSync(join(dir, "auth"));
mkdirSync(join(dir, "persistence"));
symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(dir, "node_modules"), "dir");
const compile = (from, to) => writeFileSync(to, ts.transpileModule(readFileSync(new URL(from, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
compile("../lib/deployment-target.ts", join(dir, "deployment-target.js"));
compile("../lib/auth/config.ts", join(dir, "auth/config.js"));
compile("../lib/persistence/config.ts", join(dir, "persistence/config.js"));
compile("../lib/task-backend-service-auth-config.ts", join(dir, "task-backend-service-auth-config.js"));
const require = createRequire(import.meta.url);
const { assertSupabaseTarget, DeploymentTargetError } = require(join(dir, "deployment-target.js"));
const { resolveContentOsAuthConfig } = require(join(dir, "auth/config.js"));
const { resolveContentOsPersistenceConfig } = require(join(dir, "persistence/config.js"));
const { resolveTaskBackendServiceAuthConfig } = require(join(dir, "task-backend-service-auth-config.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const STAGING_URL = "https://yuznbaaoonyqonhiywkt.supabase.co";
const PRODUCTION_URL = "https://cbjcclefgxrdyjwkjcpq.supabase.co";
const stagingVars = { CONTENT_OS_DEPLOYMENT_ENV: "staging", CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF: "yuznbaaoonyqonhiywkt" };

test("deployment target guard: a staging Worker can only reach the staging Supabase project", () => {
  assert.doesNotThrow(() => assertSupabaseTarget(stagingVars, STAGING_URL));
  assert.doesNotThrow(() => assertSupabaseTarget(stagingVars, `${STAGING_URL}/`));
  assert.throws(() => assertSupabaseTarget(stagingVars, PRODUCTION_URL), DeploymentTargetError);
  assert.throws(() => assertSupabaseTarget(stagingVars, "https://yuznbaaoonyqonhiywkt.supabase.co.evil.example"), DeploymentTargetError);
  assert.throws(() => assertSupabaseTarget(stagingVars, "http://yuznbaaoonyqonhiywkt.supabase.co"), DeploymentTargetError);
  assert.throws(() => assertSupabaseTarget({ CONTENT_OS_DEPLOYMENT_ENV: "staging" }, STAGING_URL), /requires CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF/, "missing expected ref fails closed");
  assert.throws(() => assertSupabaseTarget({ CONTENT_OS_DEPLOYMENT_ENV: "qa", CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF: "yuznbaaoonyqonhiywkt" }, STAGING_URL), /not recognized/);
  assert.throws(() => assertSupabaseTarget({ CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF: "not-a-ref" }, STAGING_URL), /not a Supabase project ref/);
  assert.doesNotThrow(() => assertSupabaseTarget({}, PRODUCTION_URL), "without the vars the guard is inert (local/test)");
  try { assertSupabaseTarget(stagingVars, PRODUCTION_URL); } catch (error) { assert.doesNotMatch(error.message, /cbjcclefgxrdyjwkjcpq|supabase\.co/, "the configured URL is never echoed"); }
});

test("auth and persistence config resolvers fail closed on a wrong Supabase target", () => {
  const auth = (url) => resolveContentOsAuthConfig({ ...stagingVars, CONTENT_OS_SUPABASE_URL: url, CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k", CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_staging_bot" });
  assert.equal(auth(STAGING_URL).supabaseUrl, STAGING_URL);
  assert.throws(() => auth(PRODUCTION_URL), (e) => e.code === "CONTENT_OS_AUTH_CONFIG_ERROR");
  const persistence = (url) => resolveContentOsPersistenceConfig({ ...stagingVars, CONTENT_OS_PERSISTENCE_ENABLED: "true", CONTENT_OS_SUPABASE_URL: url, CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.equal(persistence(STAGING_URL).supabaseUrl, STAGING_URL);
  assert.throws(() => persistence(PRODUCTION_URL), (e) => e.code === "CONTENT_OS_PERSISTENCE_CONFIG_ERROR");
});

test("Task Bot base URL is normalized to a bare origin so the signed path always equals the sent path", () => {
  const resolve = (url) => resolveTaskBackendServiceAuthConfig({ TASK_BACKEND_SERVICE_AUTH_ENABLED: "true", TASK_BACKEND_BASE_URL: url, CONTENT_OS_TASK_BACKEND_SECRET: "s".repeat(40) });
  const origin = "https://ibox-task-bot-staging.lively-river-afba.workers.dev";
  assert.equal(resolve(origin).baseUrl, origin);
  assert.equal(resolve(`${origin}/`).baseUrl, origin, "a trailing slash would have produced //api/... and a 401");
  for (const bad of [`${origin}/prefix`, `${origin}/?x=1`, `${origin}#f`, "https://user:pw@ibox-task-bot-staging.example-sub.workers.dev"]) {
    assert.throws(() => resolve(bad), /bare origin/, bad);
  }
  assert.throws(() => resolve("http://ibox-task-bot-staging.example-sub.workers.dev"), /https/);
});

const goodConfig = () => ({
  name: "ibox-content-os-staging", targetEnvironment: "staging", workers_dev: true, preview_urls: false,
  compatibility_flags: ["nodejs_compat"], observability: { enabled: true },
  ratelimits: [{ name: "LOGIN_START_LIMITER", namespace_id: "1101", simple: { limit: 5, period: 60 } }],
  vars: { ...stagingVars },
});
const goodSecrets = () => ({
  CONTENT_OS_PERSISTENCE_ENABLED: "true",
  CONTENT_OS_SUPABASE_URL: STAGING_URL,
  CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-not-real",
  CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_staging_bot",
  CONTENT_OS_RATE_LIMIT_PEPPER: "fixture-pepper-not-real-0123456789abcdef",
  TASK_BACKEND_SERVICE_AUTH_ENABLED: "true",
  TASK_BACKEND_BASE_URL: "https://ibox-task-bot-staging.lively-river-afba.workers.dev",
  CONTENT_OS_TASK_BACKEND_SECRET: "fixture-shared-secret-not-real-0123456789",
});
const failing = (results) => results.filter(([, ok]) => !ok).map(([name]) => name);

test("staging preflight: the generated Worker config must be exactly the staging Worker", () => {
  assert.deepEqual(failing(checkWorkerConfig(goodConfig())), []);
  assert.deepEqual(failing(checkWorkerConfig({ ...goodConfig(), name: "ibox-content-os" })), ["worker name is ibox-content-os-staging"]);
  assert.deepEqual(failing(checkWorkerConfig({ ...goodConfig(), preview_urls: true })), ["preview URLs disabled"]);
  assert.deepEqual(failing(checkWorkerConfig({ ...goodConfig(), routes: [{ pattern: "content.ibox.uz/*" }] })), ["no routes / custom domains"]);
  for (const namespace of ["1001", "STAGING_NAMESPACE_ID_PLACEHOLDER", "0", "4242"]) {
    const config = goodConfig();
    config.ratelimits[0].namespace_id = namespace;
    assert.deepEqual(failing(checkWorkerConfig(config)), ["staging rate-limit namespace is the owner-selected 1101 (never production's 1001)"], namespace);
  }
  assert.ok(failing(checkWorkerConfig({ ...goodConfig(), vars: { ...stagingVars, CONTENT_OS_RATE_LIMIT_PEPPER: "x" } })).includes("no secret-like plain vars"));
});

test("staging preflight: secrets can only target staging Supabase and the staging Task Bot; values never printed", () => {
  assert.deepEqual(failing(checkSecrets(goodSecrets())), []);
  assert.deepEqual(failing(checkSecrets({ ...goodSecrets(), CONTENT_OS_SUPABASE_URL: PRODUCTION_URL })), ["Supabase URL is exactly the staging project", "no production Supabase ref anywhere"]);
  assert.ok(failing(checkSecrets({ ...goodSecrets(), TASK_BACKEND_BASE_URL: "https://ibox-task-bot.vercel.app" })).includes("Task Bot URL is exactly the staging Task Bot origin"));
  assert.ok(failing(checkSecrets({ ...goodSecrets(), TASK_BACKEND_BASE_URL: "https://ibox-task-bot-staging.lively-river-afba.workers.dev/" })).length === 0, "a trailing slash is still an origin");
  assert.ok(failing(checkSecrets({ ...goodSecrets(), TASK_BACKEND_BASE_URL: "https://ibox-task-bot-staging.lively-river-afba.workers.dev/api" })).includes("Task Bot URL is exactly the staging Task Bot origin"));
  assert.ok(failing(checkSecrets({ ...goodSecrets(), CONTENT_OS_RATE_LIMIT_PEPPER: "short" })).includes("rate-limit pepper is at least 32 characters"));
  const missing = goodSecrets();
  delete missing.CONTENT_OS_RATE_LIMIT_PEPPER;
  assert.ok(failing(checkSecrets(missing)).includes("all required staging bindings present"));
  for (const key of ["CONTENT_OS_IDENTITY_TRUST", "TASK_BACKEND_SESSION_COOKIE", "NEXT_PUBLIC_SUPABASE_URL", "CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF"]) {
    assert.ok(failing(checkSecrets({ ...goodSecrets(), [key]: "x" })).includes("no forbidden / legacy bindings"), key);
  }
  assert.deepEqual(parseSecretsFile('# c\nA="1"\nB=two\n'), { A: "1", B: "two" });
  assert.deepEqual(parseSecretsFile('{"A":"1"}'), { A: "1" });
  assert.equal(STAGING.supabaseRef, "yuznbaaoonyqonhiywkt");
  assert.ok(failing(checkSecrets({ ...goodSecrets(), TASK_BACKEND_BASE_URL: "https://ibox-task-bot-staging.other-account.workers.dev" })).includes("Task Bot URL is exactly the staging Task Bot origin"), "another account's staging host is refused");
});

test("wrangler.jsonc: production and staging both keep preview URLs off; staging never reuses production's limiter namespace", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  assert.equal(config.preview_urls, false);
  assert.equal(config.env.staging.preview_urls, false);
  assert.equal(config.env.staging.workers_dev, true);
  assert.equal(config.ratelimits[0].namespace_id, "1001", "production namespace unchanged");
  assert.equal(config.env.staging.ratelimits[0].namespace_id, "1101", "owner-selected staging namespace");
  assert.deepEqual(config.env.staging.vars, stagingVars);
  assert.ok(!JSON.stringify(config).match(/cbjcclefgxrdyjwkjcpq/), "the production project ref never appears in Worker config");
});
