import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-auth-unit-"));
mkdirSync(join(dir, "auth"));
symlinkSync(new URL("../node_modules", import.meta.url).pathname, join(dir, "node_modules"), "dir");

function compile(from, to, transform = (source) => source) {
  const source = transform(readFileSync(new URL(from, import.meta.url), "utf8"));
  writeFileSync(to, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
}

compile("../lib/auth/config.ts", join(dir, "auth/config.js"));
compile("../lib/auth/crypto.ts", join(dir, "auth/crypto.js"));
compile("../lib/auth/request-security.ts", join(dir, "auth/request-security.js"));
writeFileSync(join(dir, "auth/postgrest-stub.js"), `
class PostgrestClient {
  constructor(config) { this.config = config; }
  rpc(fn, args) { return this.config.fetch(fn, { method: "POST", headers: {}, body: JSON.stringify(args) }); }
}
module.exports = { PostgrestClient };
`);
compile("../lib/auth/repository.ts", join(dir, "auth/repository.js"), (source) => source.replace("@/lib/persistence/supabase-adapter", "./postgrest-stub"));

compile("../lib/auth/session-cookie.ts", join(dir, "auth/session-cookie.js"));
compile("../lib/auth/login-start.ts", join(dir, "auth/login-start.js"));
compile("../lib/auth/rate-key.ts", join(dir, "auth/rate-key.js"));
compile("../lib/auth/login-states.ts", join(dir, "auth/login-states.js"));
const require = createRequire(import.meta.url);
const { resolveContentOsAuthConfig, ContentOsAuthConfigError } = require(join(dir, "auth/config.js"));
const { randomOpaqueToken, sha256Hex } = require(join(dir, "auth/crypto.js"));
const { readSameOriginJson } = require(join(dir, "auth/request-security.js"));
const { ContentOsAuthRepository } = require(join(dir, "auth/repository.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("auth config is explicit, HTTPS-only, and accepts a normalized existing bot username", () => {
  assert.throws(() => resolveContentOsAuthConfig({}), ContentOsAuthConfigError);
  assert.throws(() => resolveContentOsAuthConfig({ CONTENT_OS_SUPABASE_URL: "http://db.test", CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k", CONTENT_OS_TELEGRAM_BOT_USERNAME: "ibox_bot" }), /https/);
  assert.throws(() => resolveContentOsAuthConfig({ CONTENT_OS_SUPABASE_URL: "https://db.test", CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k", CONTENT_OS_TELEGRAM_BOT_USERNAME: "bad-name" }), /username/);
  assert.deepEqual(resolveContentOsAuthConfig({ CONTENT_OS_SUPABASE_URL: "https://db.test/path", CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: "k", CONTENT_OS_TELEGRAM_BOT_USERNAME: "@ibox_task_bot" }), {
    supabaseUrl: "https://db.test",
    serviceRoleKey: "k",
    telegramBotUsername: "ibox_task_bot",
  });
});

test("browser verifier/session material has 256 bits and hashes with SHA-256", async () => {
  const first = randomOpaqueToken();
  const second = randomOpaqueToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.throws(() => randomOpaqueToken(31), /256 bits/);
});

function jsonRequest(body = "{}", headers = {}) {
  return new Request("https://content.example/api/test", {
    method: "POST",
    headers: { host: "content.example", origin: "https://content.example", "content-type": "application/json", ...headers },
    body,
  });
}

test("same-origin JSON boundary rejects cross-site, missing origin, wrong host/type, oversize, and malformed input", async () => {
  assert.deepEqual(await readSameOriginJson(jsonRequest('{"ok":true}')), { ok: true, value: { ok: true } });
  for (const request of [
    jsonRequest("{}", { origin: "https://evil.example" }),
    jsonRequest("{}", { origin: "" }),
    jsonRequest("{}", { host: "evil.example" }),
    jsonRequest("{}", { "content-type": "text/plain" }),
    jsonRequest("{}", { "sec-fetch-site": "cross-site" }),
    jsonRequest("not-json"),
    jsonRequest(JSON.stringify({ large: "x".repeat(200) })),
  ]) {
    const result = await readSameOriginJson(request, 64);
    assert.equal(result.ok, false);
    assert.ok([400, 403, 413, 415].includes(result.response.status));
  }
});

test("auth repository uses the exact canonical Task Bot RPC contract and validates role output", async () => {
  const calls = [];
  const rows = [
    [{ challenge_id: "10000000-0000-4000-8000-000000000001", status: "PENDING", expires_at: "2026-10-15T12:00:00+00:00", display_code: "472851" }],
    [{ status: "APPROVED", expires_at: "2026-10-15T12:00:00+00:00" }],
    [{ status: "REDEEMED", session_id: "20000000-0000-4000-8000-000000000001", authenticated_user_id: "30000000-0000-4000-8000-000000000001", display_name: "Author", role: "CONTENT_MARKETER", expires_at: "2026-11-14T12:00:00+00:00" }],
    [{ status: "VALID", session_id: "20000000-0000-4000-8000-000000000001", authenticated_user_id: "30000000-0000-4000-8000-000000000001", display_name: "Author", role: "SEO_SPECIALIST", expires_at: "2026-11-14T12:00:00+00:00" }],
    true,
  ];
  const repository = new ContentOsAuthRepository({ supabaseUrl: "https://db.test", serviceRoleKey: "secret", telegramBotUsername: "ibox_bot" }, async (fn, init) => {
    calls.push({ fn, body: JSON.parse(init.body) });
    return rows.shift();
  });
  await repository.createChallenge("a".repeat(64), "c".repeat(64));
  await repository.getChallengeStatus("10000000-0000-4000-8000-000000000001");
  const redeemed = await repository.redeemChallenge({ challengeId: "10000000-0000-4000-8000-000000000001", verifierHash: "a".repeat(64), sessionTokenHash: "b".repeat(64) });
  const current = await repository.validateSession("b".repeat(64));
  assert.equal(await repository.revokeSession("b".repeat(64)), true);
  assert.equal(redeemed.user.role, "CONTENT_MARKETER");
  assert.equal(current.role, "SEO_SPECIALIST", "validation reads the current database role");
  assert.deepEqual(calls.map((call) => call.fn), [
    "content_os_auth_create_challenge",
    "content_os_auth_get_challenge_status",
    "content_os_auth_redeem_challenge",
    "content_os_auth_validate_session",
    "content_os_auth_revoke_session",
  ]);
  assert.deepEqual(calls[0].body, { p_verifier_hash: "a".repeat(64), p_rate_key_hash: "c".repeat(64) }, "create takes only proofs and the server-derived rate key");
  assert.equal(JSON.stringify(calls).includes("telegram_user_id"), false);
});

// --- Sprint 10D: matching code, rate limit, terminal states, __Host- cookie -------------------------

const cookie = require(join(dir, "auth/session-cookie.js"));
const { startLogin, formatConfirmationCode } = require(join(dir, "auth/login-start.js"));
const rateKey = require(join(dir, "auth/rate-key.js"));
const { challengeView, shouldKeepPolling, pollDelayMs, CONFIRMATION_INSTRUCTION } = require(join(dir, "auth/login-states.js"));
const CHALLENGE = "9f0c1b7e-1111-4222-8333-444455556666";
const pending = (extra = {}) => ({ challenge_id: CHALLENGE, status: "PENDING", expires_at: "2026-10-15T10:10:00.000Z", display_code: "472851", ...extra });
const allow = { limit: async () => ({ success: true }) };

test("10D login start: matching code returned with the challenge; the code is display-only, never in the redeem link", async () => {
  const result = await startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: allow, challenges: { createChallenge: async () => pending() }, telegramBotUsername: "ibox_bot" });
  assert.deepEqual(result, { kind: "STARTED", challengeId: CHALLENGE, expiresAt: "2026-10-15T10:10:00.000Z", confirmationCode: "472851", telegramDeepLink: `https://t.me/ibox_bot?start=contentos_${CHALLENGE}` });
  assert.ok(!result.telegramDeepLink.includes("472851"));
  assert.equal(formatConfirmationCode("472851"), "472 851");
  assert.equal(CONFIRMATION_INSTRUCTION, "Telegram botdagi kod shu kod bilan bir xil bo‘lsa tasdiqlang.");
});

test("10D login start: no confirmation code from the backend -> no login is started (fail closed)", async () => {
  for (const row of [pending({ display_code: undefined }), pending({ display_code: null })]) {
    const result = await startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: allow, challenges: { createChallenge: async () => row }, telegramBotUsername: "ibox_bot" });
    assert.deepEqual(result, { kind: "CONFIRMATION_UNAVAILABLE" });
  }
});

test("10D login start: edge limit refuses before any DB write; backend RATE_LIMITED is honoured; neutral result", async () => {
  let created = 0;
  const challenges = { createChallenge: async () => { created += 1; return pending(); } };
  const edge = await startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: { limit: async () => ({ success: false }) }, challenges, telegramBotUsername: "ibox_bot" });
  assert.deepEqual(edge, { kind: "RATE_LIMITED", retryAfterSeconds: 60 });
  assert.equal(created, 0, "no challenge row is created when the edge limit trips");
  for (const refusal of [{ pgCode: "PT429", status: 429 }, { pgCode: "PT429" }, { status: 429 }]) {
    const backend = await startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: allow, challenges: { createChallenge: async () => { throw Object.assign(new Error("login challenge rate limit exceeded"), refusal); } }, telegramBotUsername: "ibox_bot" });
    assert.deepEqual(backend, { kind: "RATE_LIMITED", retryAfterSeconds: 300 }, "Task Bot PT429 -> neutral rate limit with a bounded wait matching its 15-minute window");
  }
  await assert.rejects(() => startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: allow, challenges: { createChallenge: async () => { throw Object.assign(new Error("down"), { status: 503 }); } }, telegramBotUsername: "ibox_bot" }), /down/, "other failures are not disguised as rate limiting");
  let seen;
  await startLogin({ verifierHash: "a".repeat(64), rateKeyHash: "c".repeat(64), limiter: { limit: async (input) => { seen = input.key; return { success: true }; } }, challenges: { createChallenge: async (_v, rateKeyHash) => { assert.equal(rateKeyHash, "c".repeat(64)); return pending(); } }, telegramBotUsername: "ibox_bot" });
  assert.equal(seen, `login-start:${"c".repeat(64)}`, "edge and Task Bot limits use the same server-derived key");
});

const PEPPER = "fixture-pepper-for-tests-only-0123456789abcdef";
const PROD = "https://ibox-content-os.example.workers.dev/api/auth/telegram/start";
const DEV = "http://127.0.0.1:8787/api/auth/telegram/start";
const derive = (headers, options = {}) => rateKey.deriveLoginRateKey({
  requestUrl: options.url ?? PROD,
  headers: new Headers(headers),
  pepper: "pepper" in options ? options.pepper : PEPPER,
});

test("10E rate key: HMAC-SHA-256(pepper, Cloudflare client IP) — fixed fixture, lowercase 64-hex", async () => {
  const result = await derive({ "cf-connecting-ip": "203.0.113.7" });
  const expected = createHmac("sha256", PEPPER).update("content-os-login-rate-key:v1:203.0.113.7").digest("hex");
  assert.deepEqual(result, { ok: true, rateKeyHash: expected, mode: "production" });
  assert.equal(result.rateKeyHash, "68be0eb9ca54cac0106ca408825e65661051189c3d8e469c6877577eb3f7f06b", "pinned digest (openssl dgst -sha256 -hmac)");
  assert.match(result.rateKeyHash, /^[0-9a-f]{64}$/);
  assert.notEqual(result.rateKeyHash, createHash("sha256").update("203.0.113.7").digest("hex"), "not a plain (reversible) SHA-256 of the IP");
  assert.ok(!result.rateKeyHash.includes("203"));
});

test("10E rate key: same IP+pepper -> same; different IP -> different; different pepper -> different", async () => {
  const a = (await derive({ "cf-connecting-ip": "203.0.113.7" })).rateKeyHash;
  assert.equal((await derive({ "cf-connecting-ip": "203.0.113.7" })).rateKeyHash, a);
  assert.notEqual((await derive({ "cf-connecting-ip": "203.0.113.8" })).rateKeyHash, a);
  assert.notEqual((await derive({ "cf-connecting-ip": "203.0.113.7" }, { pepper: "another-fixture-pepper-0123456789abcdefgh" })).rateKeyHash, a);
  assert.equal((await derive({ "cf-connecting-ip": "2001:DB8::1" })).rateKeyHash, (await derive({ "cf-connecting-ip": "2001:db8::1" })).rateKeyHash, "IPv6 case-normalized");
});

test("10E rate key: browser-supplied IP headers and rate keys are ignored; only CF-Connecting-IP counts", async () => {
  const base = (await derive({ "cf-connecting-ip": "203.0.113.7" })).rateKeyHash;
  const forged = await derive({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "true-client-ip": "9.9.9.9", "x-rate-key": "a".repeat(64) });
  assert.equal(forged.rateKeyHash, base);
  const noCf = await derive({ "x-forwarded-for": "1.2.3.4", "x-rate-key": "a".repeat(64) });
  assert.deepEqual(noCf, { ok: false, reason: "CLIENT_IP_MISSING" }, "no Cloudflare IP in production -> fail closed, never an 'unknown' bucket");
  assert.deepEqual(await derive({ "cf-connecting-ip": "not an ip; drop table" }), { ok: false, reason: "CLIENT_IP_MISSING" });
});

test("10E rate key: missing / short pepper in production fails closed; development is explicit and loopback-only", async () => {
  for (const pepper of [undefined, "", "   ", "too-short-pepper"]) {
    assert.deepEqual(await derive({ "cf-connecting-ip": "203.0.113.7" }, { pepper }), { ok: false, reason: "PEPPER_MISSING" }, String(pepper));
  }
  const dev = await derive({}, { url: DEV, pepper: undefined });
  assert.equal(dev.mode, "development");
  assert.equal(dev.rateKeyHash, createHmac("sha256", rateKey.DEVELOPMENT_RATE_LIMIT_PEPPER).update(`content-os-login-rate-key:v1:${rateKey.DEVELOPMENT_CLIENT_KEY}`).digest("hex"));
  assert.deepEqual(await derive({ "cf-connecting-ip": "203.0.113.7" }, { url: "http://ibox.example/api/auth/telegram/start", pepper: PEPPER }), { ok: false, reason: "INSECURE_ORIGIN" }, "the development path never applies off loopback");
  assert.notEqual((await derive({ "cf-connecting-ip": "203.0.113.7" }, { url: DEV, pepper: undefined })).rateKeyHash, (await derive({ "cf-connecting-ip": "203.0.113.7" })).rateKeyHash, "the development pepper never equals production");
});

test("10D repository: Task Bot display_code contract; malformed codes rejected", async () => {
  const repo = (row) => new ContentOsAuthRepository({ supabaseUrl: "https://db.test", serviceRoleKey: "k", telegramBotUsername: "ibox_bot" }, async () => [row]);
  assert.equal((await repo(pending()).createChallenge("a".repeat(64), "c".repeat(64))).display_code, "472851");
  await assert.rejects(() => repo(pending({ display_code: "12ab56" })).createChallenge("a".repeat(64), "c".repeat(64)));
});

test("10D login states: expired / cancelled / consumed / unavailable stop polling; polling is bounded", () => {
  for (const status of ["CONSUMED", "CANCELLED", "EXPIRED", "UNAVAILABLE"]) assert.equal(challengeView(status).terminal, true, status);
  for (const status of ["PENDING", "APPROVED"]) assert.equal(challengeView(status).terminal, false, status);
  const started = Date.parse("2026-10-15T10:00:00Z");
  assert.equal(shouldKeepPolling(started + 1_000, started, "2026-10-15T10:10:00Z"), true);
  assert.equal(shouldKeepPolling(started + 10 * 60_000, started, "2026-10-15T10:30:00Z"), false, "10-minute cap");
  assert.equal(shouldKeepPolling(started + 5 * 60_000, started, "2026-10-15T10:04:00Z"), false, "challenge expiry");
  assert.equal(pollDelayMs(0), 1_500);
  assert.equal(pollDelayMs(50), 8_000);
});

test("10D cookie: production __Host- (Secure, HttpOnly, Path=/, no Domain, Strict); explicit loopback-only dev cookie", () => {
  const prod = cookie.sessionSetCookie("t".repeat(43), "https://ibox-content-os.example.workers.dev/api/auth/telegram/complete");
  assert.equal(prod, `__Host-content_os_session=${"t".repeat(43)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure`);
  assert.doesNotMatch(prod, /Domain=/i);
  const dev = cookie.sessionSetCookie("t".repeat(43), "http://127.0.0.1:8787/api/auth/telegram/complete");
  assert.equal(dev, `content_os_session_dev=${"t".repeat(43)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict`);
  assert.throws(() => cookie.sessionSetCookie("t".repeat(43), "http://ibox.example.com/x"), /https/);
  assert.equal(cookie.expiredSessionSetCookie("http://ibox.example.com/x"), null);
  const token = "a".repeat(43);
  assert.equal(cookie.sessionTokenFromCookies(`__Host-content_os_session=${token}`, "https://ibox.example/x"), token);
  assert.equal(cookie.sessionTokenFromCookies(`content_os_session_dev=${token}`, "https://ibox.example/x"), null, "the dev cookie is never accepted in production");
  assert.equal(cookie.sessionTokenFromCookies(`content_os_session=${token}`, "https://ibox.example/x"), null, "the old unprefixed name is no longer accepted");
  assert.equal(cookie.sessionTokenFromCookies(`__Host-content_os_session=${token}; __Host-content_os_session=${token}`, "https://ibox.example/x"), null, "ambiguous duplicates are rejected");
  assert.equal(cookie.sessionTokenFromCookies(`content_os_session_dev=${token}`, "http://localhost:3000/x"), token);
  assert.equal(cookie.sessionTokenFromCookies(`content_os_session_dev=${token}`, "http://ibox.example/x"), null);
});
