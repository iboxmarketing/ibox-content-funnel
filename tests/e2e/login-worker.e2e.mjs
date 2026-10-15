/**
 * LOCAL E2E ONLY (run `npm run build` first). The BUILT Worker under local
 * workerd, with no Task Bot / database reachable: proves the login boundary
 * fails closed and that the edge rate limiter trips before any backend call.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import { makeLocalTls, startWorker } from "./lib/worker.mjs";

const PEPPER = "local-e2e-pepper-not-a-secret-0123456789abcdef";
let worker, limitedWorker, tls, stub;
const rpcBodies = [];
before(async () => {
  worker = await startWorker({ vars: {
    CONTENT_OS_SUPABASE_URL: "https://127.0.0.1:9",
    CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "local-e2e-not-a-key",
    CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_local_bot",
  } });
  // A local TLS stand-in for the Task Bot RPC that refuses with SQLSTATE PT429 (PostgREST: HTTP 429).
  tls = makeLocalTls();
  stub = https.createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert) }, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      rpcBodies.push({ path: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ code: "PT429", message: "login challenge rate limit exceeded", details: null, hint: null }));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  limitedWorker = await startWorker({ caFile: tls.ca, vars: {
    CONTENT_OS_SUPABASE_URL: `https://127.0.0.1:${stub.address().port}`,
    CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "local-e2e-not-a-key",
    CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_local_bot",
    CONTENT_OS_RATE_LIMIT_PEPPER: PEPPER,
  } });
});
after(async () => {
  worker?.stop();
  limitedWorker?.stop();
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  tls?.cleanup();
});

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

test("Task Bot PT429 -> HTTP 429 with a bounded Retry-After; the rate key is the server HMAC, untouched by browser headers", async () => {
  const send = (headers = {}) => fetch(`${limitedWorker.url}/api/auth/telegram/start`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: limitedWorker.url, ...headers },
    body: JSON.stringify({ verifierHash: "a".repeat(64) }),
    signal: AbortSignal.timeout(30_000),
  });
  const res = await send();
  const body = await res.json();
  assert.deepEqual([res.status, body.code, res.headers.get("retry-after")], [429, "LOGIN_RATE_LIMITED", "300"]);
  await (await send({ "x-forwarded-for": "198.51.100.9", "x-real-ip": "198.51.100.10", "x-rate-key": "b".repeat(64) })).arrayBuffer();
  const keys = rpcBodies.filter((r) => r.path === "/rest/v1/rpc/content_os_auth_create_challenge").map((r) => r.body.p_rate_key_hash);
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^[0-9a-f]{64}$/);
  assert.equal(keys[1], keys[0], "browser-sent IP / rate-key headers do not move the bucket");
  assert.notEqual(keys[0], "b".repeat(64));
  const candidates = ["127.0.0.1", "::1", "loopback-development-client"].map((ip) => createHmac("sha256", PEPPER).update(`content-os-login-rate-key:v1:${ip}`).digest("hex"));
  assert.ok(candidates.includes(keys[0]), "HMAC with the configured Worker pepper");
  assert.ok(!JSON.stringify(rpcBodies).includes(PEPPER) && !limitedWorker.output().includes(PEPPER), "the pepper is never sent or logged");
});
