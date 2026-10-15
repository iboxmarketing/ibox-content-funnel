import { cookies, headers } from "next/headers";
import { resolveContentOsAuthConfig } from "./config";
import { sha256Hex } from "./crypto";
import {
  ContentOsAuthRepository,
  type AuthenticatedUser,
  type ContentOsRole,
} from "./repository";

import {
  DEVELOPMENT_SESSION_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  expiredSessionSetCookie,
  sessionSetCookie,
  sessionTokenFromCookies,
} from "./session-cookie";

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

/** Server components: the production `__Host-` cookie; the development cookie only on a loopback host. */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  const hostname = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const value = jar.get(PRODUCTION_SESSION_COOKIE)?.value ?? (loopback ? jar.get(DEVELOPMENT_SESSION_COOKIE)?.value : undefined) ?? null;
  return validateRawSessionToken(value);
}

export type RequestAuthentication =
  | { readonly ok: true; readonly user: AuthenticatedUser }
  | { readonly ok: false; readonly response: Response };

export async function requireAuthenticatedUser(request: Request): Promise<RequestAuthentication> {
  try {
    const user = await validateRawSessionToken(sessionTokenFromCookies(request.headers.get("cookie"), request.url));
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

export const sessionCookie = sessionSetCookie;
export const expiredSessionCookie = expiredSessionSetCookie;
export { sessionTokenFromCookies };
