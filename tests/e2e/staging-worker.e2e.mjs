/**
 * LOCAL ONLY (run `npm run build:staging` first). The BUILT STAGING Worker under
 * local workerd, given the PRODUCTION Supabase URL as its secret: the pinned
 * staging guard (CONTENT_OS_DEPLOYMENT_ENV / CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF
 * from wrangler.jsonc env.staging) must fail closed before any outbound call.
 * Nothing here contacts Supabase, Cloudflare, or Telegram.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startWorker } from "./lib/worker.mjs";

let worker;
before(async () => {
  const built = JSON.parse(readFileSync(new URL("../../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.equal(built.name, "ibox-content-os-staging", "run `npm run build:staging` first");
  worker = await startWorker({ vars: {
    CONTENT_OS_SUPABASE_URL: "https://cbjcclefgxrdyjwkjcpq.supabase.co",
    CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "local-e2e-not-a-key",
    CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_staging_bot",
    CONTENT_OS_RATE_LIMIT_PEPPER: "local-e2e-pepper-not-a-secret-0123456789abcdef",
  } });
});
after(() => worker?.stop());

test("staging Worker pointed at the production Supabase URL fails closed on login start and session validation", async () => {
  const start = await fetch(`${worker.url}/api/auth/telegram/start`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: worker.url },
    body: JSON.stringify({ verifierHash: "a".repeat(64) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.deepEqual([start.status, (await start.json()).code], [503, "AUTH_BACKEND_UNAVAILABLE"]);
  const me = await fetch(`${worker.url}/api/auth/me`, { headers: { cookie: `content_os_session_dev=${"a".repeat(43)}` }, signal: AbortSignal.timeout(30_000) });
  assert.deepEqual([me.status, (await me.json()).code], [503, "AUTH_BACKEND_UNAVAILABLE"]);
  const output = worker.output();
  assert.match(output, /CONTENT_OS_DEPLOYMENT_ENV|deployment_target|backend_unavailable/i);
  assert.ok(!output.includes("cbjcclefgxrdyjwkjcpq.supabase.co/rest"), "no request to the production project was attempted");
});
