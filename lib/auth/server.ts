import { cookies } from "next/headers";
import { resolveContentOsAuthConfig } from "./config";
import { sha256Hex } from "./crypto";
import {
  ContentOsAuthRepository,
  type AuthenticatedUser,
  type ContentOsRole,
} from "./repository";

export const CONTENT_OS_SESSION_COOKIE = "content_os_session";
export const CONTENT_OS_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const UPSTREAM_TIMEOUT_MS = 10_000;

export class AuthBackendUnavailableError extends Error {
  constructor() {
    super("Content OS authentication backend is unavailable.");
    this.name = "AuthBackendUnavailableError";
  }
}

export class AuthForbiddenError extends Error {
  constructor() {
    super("This role is not permitted to perform the requested action.");
    this.name = "AuthForbiddenError";
  }
}

function serverFetch(url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

export function createServerAuthRepository(): {
  readonly config: ReturnType<typeof resolveContentOsAuthConfig>;
  readonly repository: ContentOsAuthRepository;
} {
  const config = resolveContentOsAuthConfig(process.env);
  return { config, repository: new ContentOsAuthRepository(config, serverFetch) };
}

export function sessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${CONTENT_OS_SESSION_COOKIE}=`))
    .map((part) => part.slice(CONTENT_OS_SESSION_COOKIE.length + 1));
  if (matches.length !== 1 || !COOKIE_TOKEN.test(matches[0])) return null;
  return matches[0];
}

async function validateRawSessionToken(rawToken: string | null): Promise<AuthenticatedUser | null> {
  if (!rawToken || !COOKIE_TOKEN.test(rawToken)) return null;
  try {
    const { repository } = createServerAuthRepository();
    return await repository.validateSession(await sha256Hex(rawToken));
  } catch (error) {
    console.error(JSON.stringify({
      event: "content_os.auth",
      action: "validate",
      outcome: "backend_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
    }));
    throw new AuthBackendUnavailableError();
  }
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const value = (await cookies()).get(CONTENT_OS_SESSION_COOKIE)?.value ?? null;
  return validateRawSessionToken(value);
}

export type RequestAuthentication =
  | { readonly ok: true; readonly user: AuthenticatedUser }
  | { readonly ok: false; readonly response: Response };

export async function requireAuthenticatedUser(request: Request): Promise<RequestAuthentication> {
  try {
    const user = await validateRawSessionToken(sessionTokenFromCookieHeader(request.headers.get("cookie")));
    if (!user) {
      return {
        ok: false,
        response: Response.json(
          { code: "UNAUTHENTICATED", error: "Sign in required." },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    return { ok: true, user };
  } catch (error) {
    if (error instanceof AuthBackendUnavailableError) {
      return {
        ok: false,
        response: Response.json(
          { code: "AUTH_BACKEND_UNAVAILABLE", error: "Authentication is temporarily unavailable." },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    throw error;
  }
}

export function requireRole(user: AuthenticatedUser, ...roles: readonly ContentOsRole[]): AuthenticatedUser {
  if (!roles.includes(user.role)) throw new AuthForbiddenError();
  return user;
}

export function isHead(user: AuthenticatedUser): boolean {
  return user.role === "HEAD_OF_MARKETING";
}

export function sessionCookie(rawToken: string, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  return [
    `${CONTENT_OS_SESSION_COOKIE}=${rawToken}`,
    "Path=/",
    `Max-Age=${CONTENT_OS_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function expiredSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  return [
    `${CONTENT_OS_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
