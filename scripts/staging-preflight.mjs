#!/usr/bin/env node
/**
 * Content OS STAGING deploy preflight (Sprint 11B). Read-only; never prints a
 * secret value — only check names and PASS/FAIL. Exit code 1 on any failure.
 *
 *   CLOUDFLARE_ENV=staging npm run build
 *   node scripts/staging-preflight.mjs --secrets-file "$STAGING_CF_SECRETS_FILE"
 *
 * Verifies the GENERATED Worker config (dist/server/wrangler.json, i.e. what
 * `wrangler deploy` will actually upload) is the staging Worker, and that the
 * staging secrets file can only target the staging Supabase project and a
 * staging Task Bot origin.
 */
import { readFileSync, statSync } from "node:fs";

export const STAGING = {
  workerName: "ibox-content-os-staging",
  supabaseRef: "yuznbaaoonyqonhiywkt",
  forbiddenRefs: ["cbjcclefgxrdyjwkjcpq"], // production Supabase
  productionNamespaceId: "1001",
  stagingNamespaceId: "1101", // owner-selected (Sprint 11B-B2)
  taskBotOrigin: "https://ibox-task-bot-staging.lively-river-afba.workers.dev",
  contentOsOrigin: "https://ibox-content-os-staging.lively-river-afba.workers.dev",
};

const REQUIRED_SECRETS = [
  "CONTENT_OS_PERSISTENCE_ENABLED",
  "CONTENT_OS_SUPABASE_URL",
  "CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY",
  "CONTENT_OS_TELEGRAM_BOT_USERNAME",
  "CONTENT_OS_RATE_LIMIT_PEPPER",
  "TASK_BACKEND_SERVICE_AUTH_ENABLED",
  "TASK_BACKEND_BASE_URL",
  "CONTENT_OS_TASK_BACKEND_SECRET",
];
const FORBIDDEN_SECRETS = [
  "CONTENT_OS_IDENTITY_TRUST",
  "CONTENT_OS_IDENTITY_TENANT_KEY",
  "TASK_BACKEND_SESSION_COOKIE",
  // Pinned in wrangler.jsonc env.staging; a secret of the same name must not override them.
  "CONTENT_OS_DEPLOYMENT_ENV",
  "CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF",
];

/** wrangler --secrets-file accepts JSON or dotenv. */
export function parseSecretsFile(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) throw new Error("malformed secrets line");
    let value = line.slice(index + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, index).trim()] = value;
  }
  return out;
}

export function checkWorkerConfig(config) {
  const limiter = (config.ratelimits ?? []).find((r) => r.name === "LOGIN_START_LIMITER");
  return [
    ["worker name is ibox-content-os-staging", config.name === STAGING.workerName],
    ["built for the staging environment", config.targetEnvironment === "staging"],
    ["workers.dev enabled", config.workers_dev === true],
    ["preview URLs disabled", config.preview_urls === false],
    ["no routes / custom domains", !config.route && !(config.routes ?? []).length],
    ["nodejs_compat enabled", (config.compatibility_flags ?? []).includes("nodejs_compat")],
    ["observability enabled", config.observability?.enabled === true],
    ["login rate limiter bound (5 / 60 s)", limiter?.simple?.limit === 5 && limiter?.simple?.period === 60],
    ["staging rate-limit namespace is the owner-selected 1101 (never production's 1001)", String(limiter?.namespace_id ?? "") === STAGING.stagingNamespaceId && STAGING.stagingNamespaceId !== STAGING.productionNamespaceId],
    ["deployment env var pinned to staging", config.vars?.CONTENT_OS_DEPLOYMENT_ENV === "staging"],
    ["expected Supabase project pinned to staging", config.vars?.CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF === STAGING.supabaseRef],
    ["no secret-like plain vars", !Object.keys(config.vars ?? {}).some((k) => /SECRET|KEY$|PEPPER|TOKEN|PASSWORD|SERVICE_ROLE/.test(k) && k !== "CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF")],
  ];
}

const isOrigin = (url) => (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && !url.username && !url.password;

export function checkSecrets(secrets) {
  const values = Object.values(secrets).map(String);
  let supabase = null;
  let taskBot = null;
  try { supabase = new URL(secrets.CONTENT_OS_SUPABASE_URL); } catch { /* reported below */ }
  try { taskBot = new URL(secrets.TASK_BACKEND_BASE_URL); } catch { /* reported below */ }
  return [
    ["all required staging bindings present", REQUIRED_SECRETS.every((k) => typeof secrets[k] === "string" && secrets[k].trim() !== "")],
    ["no forbidden / legacy bindings", !FORBIDDEN_SECRETS.some((k) => k in secrets) && !Object.keys(secrets).some((k) => k.startsWith("NEXT_PUBLIC_"))],
    ["persistence and service auth explicitly enabled", secrets.CONTENT_OS_PERSISTENCE_ENABLED === "true" && secrets.TASK_BACKEND_SERVICE_AUTH_ENABLED === "true"],
    ["Supabase URL is exactly the staging project", supabase !== null && supabase.origin === `https://${STAGING.supabaseRef}.supabase.co` && isOrigin(supabase)],
    ["no production Supabase ref anywhere", !values.some((v) => STAGING.forbiddenRefs.some((ref) => v.includes(ref)))],
    ["Task Bot URL is exactly the staging Task Bot origin", taskBot !== null && isOrigin(taskBot) && taskBot.origin === STAGING.taskBotOrigin],
    ["rate-limit pepper is at least 32 characters", (secrets.CONTENT_OS_RATE_LIMIT_PEPPER ?? "").trim().length >= 32],
    ["service-auth shared secret is at least 32 characters", (secrets.CONTENT_OS_TASK_BACKEND_SECRET ?? "").trim().length >= 32],
    ["Telegram bot username is well formed", /^@?[A-Za-z0-9_]{5,32}$/.test(secrets.CONTENT_OS_TELEGRAM_BOT_USERNAME ?? "")],
  ];
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const configPath = arg("--config") ?? "dist/server/wrangler.json";
  const secretsPath = arg("--secrets-file");
  const results = checkWorkerConfig(JSON.parse(readFileSync(configPath, "utf8")));
  if (secretsPath) {
    const mode = (statSync(secretsPath).mode & 0o777).toString(8);
    results.push(["secrets file is mode 600", mode === "600"]);
    results.push(...checkSecrets(parseSecretsFile(readFileSync(secretsPath, "utf8"))));
  } else {
    results.push(["secrets file supplied (--secrets-file)", false]);
  }
  for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `STAGING PREFLIGHT FAILED (${failed})` : "STAGING PREFLIGHT PASSED");
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
