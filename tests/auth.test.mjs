import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    [{ challenge_id: "10000000-0000-4000-8000-000000000001", status: "PENDING", expires_at: "2026-10-15T12:00:00+00:00" }],
    [{ status: "APPROVED", expires_at: "2026-10-15T12:00:00+00:00" }],
    [{ status: "REDEEMED", session_id: "20000000-0000-4000-8000-000000000001", authenticated_user_id: "30000000-0000-4000-8000-000000000001", display_name: "Author", role: "CONTENT_MARKETER", expires_at: "2026-11-14T12:00:00+00:00" }],
    [{ status: "VALID", session_id: "20000000-0000-4000-8000-000000000001", authenticated_user_id: "30000000-0000-4000-8000-000000000001", display_name: "Author", role: "SEO_SPECIALIST", expires_at: "2026-11-14T12:00:00+00:00" }],
    true,
  ];
  const repository = new ContentOsAuthRepository({ supabaseUrl: "https://db.test", serviceRoleKey: "secret", telegramBotUsername: "ibox_bot" }, async (fn, init) => {
    calls.push({ fn, body: JSON.parse(init.body) });
    return rows.shift();
  });
  await repository.createChallenge("a".repeat(64));
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
  assert.equal(JSON.stringify(calls).includes("telegram_user_id"), false);
});
