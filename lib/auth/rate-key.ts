/**
 * Login rate-limit key (server-only; Sprint 10E-FIX).
 *
 *   rateKeyHash = lowercase hex( HMAC-SHA-256( key = CONTENT_OS_RATE_LIMIT_PEPPER,
 *                                              message = "content-os-login-rate-key:v1:" + clientIp ) )
 *
 * - clientIp comes ONLY from Cloudflare's `CF-Connecting-IP` request header,
 *   which the Cloudflare edge sets (a client-sent value is replaced). Nothing
 *   in the request body or any other header selects the key.
 * - The pepper is a Worker secret binding; without it an IPv4 digest would be
 *   reversible by enumeration. The raw IP is never returned, stored or logged;
 *   only this digest reaches the Task Bot (and the edge limiter).
 * - Production (https): pepper (>= 32 chars) and a well-formed client IP are
 *   REQUIRED, otherwise the caller fails closed. There is no "unknown" bucket.
 * - Local development is explicit and loopback-only (http on localhost /
 *   127.0.0.1 / [::1]): a clearly named development pepper and loopback
 *   client key are used when the real values are absent. Any other http
 *   origin is refused.
 *
 * Never import this module from client code.
 */
export const RATE_LIMIT_PEPPER_BINDING = "CONTENT_OS_RATE_LIMIT_PEPPER";
export const DEVELOPMENT_RATE_LIMIT_PEPPER = "content-os-LOCAL-DEVELOPMENT-ONLY-rate-limit-pepper";
export const DEVELOPMENT_CLIENT_KEY = "loopback-development-client";
export const MIN_PEPPER_LENGTH = 32;
const MESSAGE_PREFIX = "content-os-login-rate-key:v1:";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeTrustedClientIp(value: string): string | null {
  if (value.includes(":")) {
    try {
      // URL's host parser validates compressed IPv6 and IPv4-mapped IPv6 using
      // the same Web Platform primitive available in the Workers runtime.
      new URL(`http://[${value}]/`);
      return value.toLowerCase();
    } catch {
      return null;
    }
  }

  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)) {
    return null;
  }
  return value;
}

export type RateKeyFailure = "INSECURE_ORIGIN" | "PEPPER_MISSING" | "CLIENT_IP_MISSING";
export type RateKeyResult =
  | { readonly ok: true; readonly rateKeyHash: string; readonly mode: "production" | "development" }
  | { readonly ok: false; readonly reason: RateKeyFailure };

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveLoginRateKey(input: {
  readonly requestUrl: string;
  readonly headers: Headers;
  readonly pepper: string | undefined;
}): Promise<RateKeyResult> {
  const url = new URL(input.requestUrl);
  const development = url.protocol === "http:" && LOOPBACK.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !development) return { ok: false, reason: "INSECURE_ORIGIN" };

  const configuredPepper = input.pepper?.trim();
  const pepper = configuredPepper && configuredPepper.length >= MIN_PEPPER_LENGTH
    ? configuredPepper
    : development ? DEVELOPMENT_RATE_LIMIT_PEPPER : null;
  if (!pepper) return { ok: false, reason: "PEPPER_MISSING" };

  const rawIp = input.headers.get("cf-connecting-ip")?.trim() ?? "";
  const clientKey = normalizeTrustedClientIp(rawIp) ?? (development ? DEVELOPMENT_CLIENT_KEY : null);
  if (!clientKey) return { ok: false, reason: "CLIENT_IP_MISSING" };

  return { ok: true, rateKeyHash: await hmacSha256Hex(pepper, `${MESSAGE_PREFIX}${clientKey}`), mode: development ? "development" : "production" };
}
