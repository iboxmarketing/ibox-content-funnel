import { createHash, createHmac } from "node:crypto";

/**
 * Outbound signer for marketing-team-task-bot's server-to-server auth
 * protocol (see that repo's docs/CONTENT_OS_SERVICE_AUTH.md). Produces
 * exactly the four headers that side verifies -- never the secret itself,
 * and never anything the bot did not ask for. The subject is the current
 * public.users.id returned by Telegram web-session validation.
 *
 * This module must only ever run server-side. It is not itself wrapped in
 * `import "server-only"` because that package is unresolvable under this
 * repo's plain-Node test harness (the same reason lib/google-sheets.ts's
 * "server-only" import is never exercised by `node --test`); the guarantee
 * instead comes from this module being imported only by server API code --
 * see task-client-signed-service-security.test.mjs.
 *
 * Canonical signing input, byte-for-byte matching the bot side:
 *   signingKey = HMAC-SHA256("content-os-service-auth-v1", secret)
 *   bodyHash   = SHA-256(rawBodyBytes) as lowercase hex (empty string hashed for a bodyless request)
 *   canonical  = timestamp + "\n" + METHOD + "\n" + path + "\n" + bodyHash + "\n" + provider + "\n" + externalSubject
 *   signature  = HMAC-SHA256(canonical, signingKey) as lowercase hex
 */

export const CONTENT_OS_TIMESTAMP_HEADER = "x-content-os-timestamp";
export const CONTENT_OS_ACTOR_PROVIDER_HEADER = "x-content-os-actor-provider";
export const CONTENT_OS_ACTOR_SUBJECT_HEADER = "x-content-os-actor-subject";
export const CONTENT_OS_SIGNATURE_HEADER = "x-content-os-signature";

/** Fixed for this integration -- not configurable, per the agreed protocol. */
export const CONTENT_OS_TASK_BACKEND_PROVIDER = "CONTENT_OS_TELEGRAM_SESSION";

export type SignedTaskBackendHeaders = Readonly<
  Record<
    | typeof CONTENT_OS_TIMESTAMP_HEADER
    | typeof CONTENT_OS_ACTOR_PROVIDER_HEADER
    | typeof CONTENT_OS_ACTOR_SUBJECT_HEADER
    | typeof CONTENT_OS_SIGNATURE_HEADER,
    string
  >
>;

export interface SignTaskBackendRequestInput {
  readonly method: string;
  readonly path: string;
  readonly bodyText: string;
  /** Current public.users.id from the validated Content OS Telegram session. */
  readonly externalSubject: string;
}

export class TaskBackendSignerInputError extends Error {
  readonly code = "TASK_BACKEND_SIGNER_INPUT_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "TaskBackendSignerInputError";
  }
}

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("content-os-service-auth-v1").digest();
}

function bodyHashHex(bodyText: string): string {
  return createHash("sha256").update(bodyText).digest("hex");
}

/** Never returns or logs the secret -- only the resulting headers. `now` is
 * injectable so tests get deterministic timestamps/signatures. */
export function signTaskBackendRequest(
  input: SignTaskBackendRequestInput,
  secret: string,
  now: () => Date = () => new Date(),
): SignedTaskBackendHeaders {
  if (!input.externalSubject) {
    throw new TaskBackendSignerInputError("A current Telegram-session actor id is required to sign a task-backend request.");
  }
  if (!secret) {
    throw new TaskBackendSignerInputError("A task-backend service secret is required to sign a request.");
  }

  const timestamp = Math.floor(now().getTime() / 1000);
  const canonical = [
    String(timestamp),
    input.method.toUpperCase(),
    input.path,
    bodyHashHex(input.bodyText),
    CONTENT_OS_TASK_BACKEND_PROVIDER,
    input.externalSubject,
  ].join("\n");
  const signature = createHmac("sha256", signingKey(secret)).update(canonical).digest("hex");

  return {
    [CONTENT_OS_TIMESTAMP_HEADER]: String(timestamp),
    [CONTENT_OS_ACTOR_PROVIDER_HEADER]: CONTENT_OS_TASK_BACKEND_PROVIDER,
    [CONTENT_OS_ACTOR_SUBJECT_HEADER]: input.externalSubject,
    [CONTENT_OS_SIGNATURE_HEADER]: signature,
  };
}
