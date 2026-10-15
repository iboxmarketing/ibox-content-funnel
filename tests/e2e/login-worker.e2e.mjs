/**
 * LOCAL E2E ONLY (run `npm run build` first). The BUILT Worker under local
 * workerd, with no Task Bot / database reachable: proves the login boundary
 * fails closed and that the edge rate limiter trips before any backend call.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startWorker } from "./lib/worker.mjs";

let worker;
before(async () => {
  worker = await startWorker({ vars: {
    CONTENT_OS_SUPABASE_URL: "https://127.0.0.1:9",
    CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "local-e2e-not-a-key",
    CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_local_bot",
  } });
});
after(() => worker?.stop());

const post = (path, body, headers = {}) => fetch(`${worker.url}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: worker.url, ...headers },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});

test("login start: the edge limiter trips (429, neutral, Retry-After) before the backend is ever reached", async () => {
  const statuses = [];
  let limited;
  for (let i = 0; i < 8; i += 1) {
    const res = await post("/api/auth/telegram/start", { verifierHash: "a".repeat(64) });
    statuses.push(res.status);
    if (res.status === 429) { limited = { body: await res.json(), retryAfter: res.headers.get("retry-after") }; break; }
    await res.arrayBuffer();
  }
  assert.ok(statuses.slice(0, -1).every((s) => s === 503), `backend unreachable -> 503 fail closed: ${statuses}`);
  assert.ok(limited, `rate limited within 8 attempts: ${statuses}`);
  assert.deepEqual([limited.body.code, limited.retryAfter], ["LOGIN_RATE_LIMITED", "60"]);
  assert.doesNotMatch(JSON.stringify(limited.body), /ip|key|bucket|limit:/i, "no anti-abuse internals");
});

test("forged Sites identity headers authenticate nothing; no session -> 401 on every protected route", async () => {
  const forged = { "oai-authenticated-user-id": "siwc-head", "oai-authenticated-user-email": "head@sites.test" };
  const me = await fetch(`${worker.url}/api/auth/me`, { headers: forged });
  assert.equal(me.status, 401);
  const team = await post("/api/team/tasks", { action: "archive", taskId: randomUUID() }, forged);
  assert.equal(team.status, 401);
  const review = await post("/api/content-os/blog-review", { action: "reconcile", blogTaskId: randomUUID() }, forged);
  assert.equal(review.status, 401);
});

test("login complete from a foreign plain-http origin is refused and sets no cookie", async () => {
  // Node's fetch cannot spoof Host, so this lands on the same-origin guard (403); the cookie-mode
  // guard itself (INSECURE_ORIGIN before redemption) is unit-tested in tests/auth.test.mjs.
  const res = await fetch(`${worker.url}/api/auth/telegram/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "ibox.example", origin: "http://ibox.example" },
    body: JSON.stringify({ challengeId: randomUUID(), verifier: "v".repeat(43) }),
  });
  const body = await res.json();
  assert.ok([400, 403].includes(res.status), `status ${res.status} ${JSON.stringify(body)}`);
  assert.ok(["INSECURE_ORIGIN", "INVALID_HOST", "CROSS_ORIGIN_REQUEST"].includes(body.code), body.code);
  assert.equal(res.headers.get("set-cookie"), null);
});
