/**
 * LOCAL E2E ONLY. A minimal stand-in for the Supabase API gateway in front of
 * a real PostgREST: serves `/rest/v1/*`, requires the `apikey` header (as the
 * Supabase gateway does), forwards everything else unchanged, and can inject
 * network faults. The request log never records apikey / Authorization.
 */
import { createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";

export const E2E_JWT_SECRET = "local-e2e-jwt-secret-not-a-real-secret-0123456789";

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

/** HS256 JWT like Supabase's legacy service_role / anon API keys. */
export function mintKey(role, secret = E2E_JWT_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ iss: "supabase", role, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

/**
 * faults: [{ match(entry) -> boolean, mode: "drop-after-commit" | "fail-before" | "hang" }]
 * drop-after-commit forwards the request (the database commits) and then
 * destroys the client socket: the caller sees a network error after commit.
 */
export async function startGateway({ upstream, apiKeys, tls = null }) {
  const log = [];
  const faults = [];
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://gateway.local");
    const entry = { method: req.method, path: url.pathname, query: url.search, prefer: req.headers.prefer ?? null, contentType: req.headers["content-type"] ?? null, body: body.toString("utf8"), status: null, fault: null };
    log.push(entry);
    if (!apiKeys.includes(req.headers.apikey)) {
      entry.status = 401;
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Invalid API key" }));
      return;
    }
    if (!url.pathname.startsWith("/rest/v1/")) {
      entry.status = 404;
      res.writeHead(404).end();
      return;
    }
    const index = faults.findIndex((f) => f.match(entry));
    const fault = index === -1 ? null : faults.splice(index, 1)[0];
    if (fault?.mode === "hang") {
      entry.fault = fault.mode;
      return; // never answers; the caller's timeout must end the request
    }
    if (fault?.mode === "fail-before") {
      entry.fault = fault.mode;
      req.socket.destroy();
      return;
    }
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!["host", "connection", "content-length", "apikey"].includes(name)) headers[name] = value;
    }
    const response = await fetch(`${upstream}${url.pathname.slice("/rest/v1".length)}${url.search}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const text = await response.text();
    entry.status = response.status;
    entry.response = text;
    if (fault?.mode === "drop-after-commit") {
      entry.fault = fault.mode;
      req.socket.destroy();
      return;
    }
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" }).end(text);
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `${tls ? "https" : "http"}://127.0.0.1:${port}`,
    log,
    faults,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
