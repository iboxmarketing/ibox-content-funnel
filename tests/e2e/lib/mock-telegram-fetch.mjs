/**
 * LOCAL E2E CHILD-PROCESS PRELOAD ONLY. Intercepts Task Bot's outbound
 * api.telegram.org calls, records the request in a throwaway file, and
 * returns Telegram's normal `{ ok: true }` shape. Every other fetch keeps
 * using Next/Node's real implementation, so the local Supabase gateway is
 * still exercised. No Telegram or other external host is contacted.
 */
import { appendFileSync } from "node:fs";

const telegramOrigin = "https://api.telegram.org/";
const upstreamFetch = globalThis.fetch.bind(globalThis);

async function e2eFetch(input, init) {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (url.startsWith(telegramOrigin)) {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    appendFileSync(process.env.TELEGRAM_E2E_LOG, `${JSON.stringify({ url, body })}\n`, "utf8");
    return Response.json({ ok: true, result: {} });
  }
  return upstreamFetch(input, init);
}

// Next captures this function as its origin fetch when it installs the
// framework cache/tracing wrapper. Reinstalling after that point would make
// the two wrappers call each other recursively, so this assignment happens
// exactly once, before Next starts.
globalThis.fetch = e2eFetch;
