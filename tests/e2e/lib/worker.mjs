/**
 * LOCAL E2E ONLY. Runs the BUILT Worker (dist/server, same entry as
 * `npm start`) under local wrangler/workerd on 127.0.0.1 and a throwaway TLS
 * CA so the Worker can call the local gateway over https (the app config
 * requires https). Nothing is deployed.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;

export function makeLocalTls() {
  const dir = mkdtempSync(join(tmpdir(), "ibox-e2e-tls-"));
  const run = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "1", "-subj", "/CN=ibox-e2e-local-ca", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
  run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=127.0.0.1");
  execFileSync("sh", ["-c", "printf 'subjectAltName=IP:127.0.0.1\\nbasicConstraints=CA:FALSE\\nextendedKeyUsage=serverAuth\\n' > ext.cnf"], { cwd: dir });
  run("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "1", "-extfile", "ext.cnf");
  return { dir, ca: join(dir, "ca.pem"), key: join(dir, "server.key"), cert: join(dir, "server.pem"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

export async function startWorker({ vars = {}, caFile = null }) {
  const port = await freePort();
  const state = mkdtempSync(join(tmpdir(), "ibox-e2e-wrangler-")); // isolated from .wrangler/state and other workers
  const args = ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json", "--local", "--persist-to", state, "--ip", "127.0.0.1", "--inspector-port", "0", "--port", String(port)];
  for (const [name, value] of Object.entries(vars)) args.push("--var", `${name}:${value}`);
  const child = spawn("node", args, { cwd: ROOT, env: { ...process.env, ...(caFile ? { NODE_EXTRA_CA_CERTS: caFile } : {}), FORCE_COLOR: "0" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", (d) => output.push(d.toString()));
  child.stderr.on("data", (d) => output.push(d.toString()));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    if (output.join("").includes("Ready on")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!output.join("").includes("Ready on")) throw new Error(`worker did not start:\n${output.join("")}`);
  return {
    url,
    output: () => output.join(""),
    stop: () => {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      rmSync(state, { recursive: true, force: true });
    },
  };
}
