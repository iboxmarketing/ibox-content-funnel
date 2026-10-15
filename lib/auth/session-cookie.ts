/**
 * Session cookie policy (pure; Sprint 10D).
 *
 * Production (any https origin): `__Host-content_os_session` — Secure,
 * HttpOnly, Path=/, no Domain, SameSite=Strict. The `__Host-` prefix makes the
 * browser refuse the cookie unless all of those hold, so no subdomain or
 * insecure page can plant or overwrite it.
 *
 * Local development over http on a loopback host only:
 * `content_os_session_dev` (no Secure, otherwise identical). It is never
 * issued or accepted for any non-loopback host, and an http request to a
 * non-loopback host gets no session cookie at all. Production is never
 * weakened for local development.
 */
export const PRODUCTION_SESSION_COOKIE = "__Host-content_os_session";
export const DEVELOPMENT_SESSION_COOKIE = "content_os_session_dev";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class InsecureSessionOriginError extends Error {
  constructor() {
    super("Session cookies are issued only over https (or http on a loopback development host).");
    this.name = "InsecureSessionOriginError";
  }
}

export type CookieMode = { readonly name: string; readonly secure: boolean };

/** Which cookie this request's origin uses, or null when no session cookie may exist here. */
export function sessionCookieMode(requestUrl: string): CookieMode | null {
  const url = new URL(requestUrl);
  if (url.protocol === "https:") return { name: PRODUCTION_SESSION_COOKIE, secure: true };
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname.toLowerCase())) return { name: DEVELOPMENT_SESSION_COOKIE, secure: false };
  return null;
}

function serialize(mode: CookieMode, value: string, maxAge: number): string {
  return [
    `${mode.name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(mode.secure ? ["Secure"] : []),
  ].join("; ");
}

export function sessionSetCookie(rawToken: string, requestUrl: string): string {
  const mode = sessionCookieMode(requestUrl);
  if (!mode) throw new InsecureSessionOriginError();
  return serialize(mode, rawToken, SESSION_MAX_AGE_SECONDS);
}

export function expiredSessionSetCookie(requestUrl: string): string | null {
  const mode = sessionCookieMode(requestUrl);
  return mode ? serialize(mode, "", 0) : null;
}

/** Exactly one well-formed session cookie under this origin's name, else null. */
export function sessionTokenFromCookies(cookieHeader: string | null, requestUrl: string): string | null {
  const mode = sessionCookieMode(requestUrl);
  if (!mode || !cookieHeader) return null;
  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${mode.name}=`))
    .map((part) => part.slice(mode.name.length + 1));
  if (matches.length !== 1 || !COOKIE_TOKEN.test(matches[0])) return null;
  return matches[0];
}
