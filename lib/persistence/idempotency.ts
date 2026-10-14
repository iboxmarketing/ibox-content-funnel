/**
 * Retry-safety helpers for the drafted idempotency model
 * (content_os_idempotency_keys + content_os_create_task_idempotent):
 * a request hash (same key + different request ⇒ conflict), deterministic
 * entity ids (a retried create never makes a second Content OS row), and
 * deterministic keys per purpose. Server-side only (node:crypto).
 */
import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively, so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** 64-char lowercase SHA-256 hex, as content_os_idempotency_keys.request_hash requires. */
export function requestHash(request: unknown): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

/** Fixed namespace for Content OS deterministic ids (RFC 4122 v5). */
export const CONTENT_OS_ID_NAMESPACE = "6f1c2c0e-4d6b-5a3e-9c1d-2b7e8a9f0c11";

/** RFC 4122 version-5 (SHA-1, name-based) UUID. */
export function deterministicUuid(name: string, namespace = CONTENT_OS_ID_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const bytes = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The Task Bot attaches its 4-channel posting checklist to any task whose
 * title/description contains the `#posting` tag (word-boundary regex in
 * create_task_with_event_v2). No Content OS Task Type requires that
 * checklist (contract §posting_checklist_required), so Content OS text sent
 * to the Task Bot must never trigger it by accident — e.g. a Material
 * titled "Why #posting matters". The tag's `#` is replaced by a fullwidth
 * `＃`, which the Task Bot regex does not match; the text stays readable.
 */
export function neutralizePostingTag(text: string): string {
  return text.replace(/#(?=posting(?![A-Za-z0-9_]))/gi, "＃");
}

/** Deterministic idempotency keys per purpose (contract §M). */
export const idempotencyKeys = {
  blogTask: (requestKey: string) => `blog:${requestKey}`,
  headReviewTask: (blogTaskId: string) => `head-review:${blogTaskId}`,
  publishCheck: (publishTaskId: string) => publishTaskId,
  materialLearning: (materialId: string) => materialId,
} as const;
