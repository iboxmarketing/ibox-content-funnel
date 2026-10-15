/** LOCAL E2E ONLY. Starts the already-built Task Bot on 127.0.0.1. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTENT_ROOT = new URL("../../../", import.meta.url).pathname;
const BOT_ROOT = join(CONTENT_ROOT, "..", "marketing-team-task-bot-sprint9b");
const PRELOAD = join(CONTENT_ROOT, "tests/e2e/lib/mock-telegram-fetch.mjs");

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

export async function startTaskBot({ supabaseUrl, anonKey, serviceKey, serviceSecret, caFile }) {
  if (!existsSync(join(BOT_ROOT, ".next/BUILD_ID"))) {
    throw new Error("Task Bot must be built before the cross-repo E2E rehearsal.");
  }
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), "ibox-e2e-task-bot-"));
  const telegramLog = join(temp, "telegram.ndjson");
  const output = [];
  const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: BOT_ROOT,
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: caFile,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${PRELOAD}`.trim(),
      NEXT_TELEMETRY_DISABLED: "1",
      APP_URL: `http://127.0.0.1:${port}`,
      APP_TIMEZONE: "Asia/Tashkent",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
      TELEGRAM_WEBHOOK_SECRET: "local_e2e_webhook_secret_123",
      TELEGRAM_GROUP_ID: "-1001234567890",
      HEAD_TELEGRAM_USER_ID: "9001",
      CONTENT_OS_SERVICE_AUTH_ENABLED: "true",
      CONTENT_OS_SERVICE_SECRET: serviceSecret,
      TELEGRAM_E2E_LOG: telegramLog,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/api/tasks`, { signal: AbortSignal.timeout(500) });
      if (response.status === 401) { ready = true; break; }
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    throw new Error(`Task Bot did not start:\n${output.join("")}`);
  }
  return {
    url,
    output: () => output.join(""),
    telegramMessages: () => existsSync(telegramLog)
      ? readFileSync(telegramLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [],
    stop: () => {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      rmSync(temp, { recursive: true, force: true });
    },
  };
}
