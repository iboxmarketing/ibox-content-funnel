/**
 * Named external links on a TaskInstance (V1 Sprint 2). No file upload or
 * storage -- a link is just a label + a URL the employee pastes in (e.g.
 * a Google Doc, Figma frame, or published post).
 */

export interface TaskLink {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export type TaskLinkDraft = Omit<TaskLink, "id">;

function stableLinkId(now: () => string): string {
  return `link-${now().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createTaskLink(draft: TaskLinkDraft, now: () => string = () => new Date().toISOString()): TaskLink {
  return { ...draft, id: stableLinkId(now) };
}

/** http(s) only -- deliberately rejects bare strings, javascript:, mailto:,
 * etc. Matches the URL FieldType's own validation in task-instance.ts. */
export function isValidLinkUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export type TaskLinkValidationErrorCode = "MISSING_LABEL" | "INVALID_URL";

export interface TaskLinkValidationError {
  readonly code: TaskLinkValidationErrorCode;
  readonly message: string;
}

/** Pure. Used both for inline UI feedback and before the link is added to
 * a TaskInstance. */
export function validateTaskLink(draft: TaskLinkDraft): TaskLinkValidationError[] {
  const errors: TaskLinkValidationError[] = [];
  if (!draft.label.trim()) errors.push({ code: "MISSING_LABEL", message: "Link nomi (label) kerak." });
  if (!isValidLinkUrl(draft.url)) errors.push({ code: "INVALID_URL", message: `Noto'g'ri URL: "${draft.url}". http:// yoki https:// bilan boshlanishi kerak.` });
  return errors;
}

export function addLink(links: readonly TaskLink[], draft: TaskLinkDraft, now: () => string = () => new Date().toISOString()): readonly TaskLink[] {
  return [...links, createTaskLink(draft, now)];
}

export function updateLink(links: readonly TaskLink[], linkId: string, changes: Partial<TaskLinkDraft>): readonly TaskLink[] {
  return links.map((link) => (link.id === linkId ? { ...link, ...changes } : link));
}

export function removeLink(links: readonly TaskLink[], linkId: string): readonly TaskLink[] {
  return links.filter((link) => link.id !== linkId);
}
