/**
 * Content OS entity model (V1 Sprint 3): the visible content hierarchy,
 * completely separate from the operational TaskInstance runtime.
 *
 *   Domain -> ProblemCategory -> ProblemPart -> KnowledgeNode -> Blog -> Material
 *
 * Angle and Destination are deliberately NOT tree nodes here (per spec).
 * TaskInstances never enter this tree -- a task OPERATES ON an entity (via
 * ContentEntityRef, see task-instance.ts) but is never itself a tree node.
 *
 * Local/session-only, same as every other Sprint 1-3 model: no Supabase,
 * no `tasks.content_ref`, no `content_task_links` table. Entity ids are
 * never reused as task ids or vice versa.
 */

export const CONTENT_ENTITY_TYPES = ["DOMAIN", "PROBLEM_CATEGORY", "PROBLEM_PART", "KNOWLEDGE_NODE", "BLOG", "MATERIAL"] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

/** A typed pointer from a TaskInstance to one entity. This is the local
 * stand-in for the future `content_task_links` bridge -- never implemented
 * as a DB table this sprint, just this plain value object. */
export interface ContentEntityRef {
  readonly entityType: ContentEntityType;
  readonly entityId: string;
}

export function ref(entityType: ContentEntityType, entityId: string): ContentEntityRef {
  return { entityType, entityId };
}

function stableEntityId(prefix: string, seed: string, now: () => string): string {
  const slug = seed.trim().toLocaleLowerCase("uz").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || prefix;
  return `${prefix}-${slug}-${now().replace(/[^0-9]/g, "").slice(-8)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface Domain {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createDomain(name: string, now: () => string = () => new Date().toISOString()): Domain {
  const timestamp = now();
  return { id: stableEntityId("dom", name, now), name, createdAt: timestamp, updatedAt: timestamp };
}

export interface ProblemCategory {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createProblemCategory(domainId: string, name: string, now: () => string = () => new Date().toISOString()): ProblemCategory {
  const timestamp = now();
  return { id: stableEntityId("pcat", name, now), domainId, name, createdAt: timestamp, updatedAt: timestamp };
}

export interface ProblemPart {
  readonly id: string;
  readonly problemCategoryId: string;
  readonly name: string;
  /** The Problem Split TaskInstance.id this part was generated from, if
   * any -- a seeded/manually-added part has null. */
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createProblemPart(problemCategoryId: string, name: string, sourceTaskId: string | null, now: () => string = () => new Date().toISOString()): ProblemPart {
  const timestamp = now();
  return { id: stableEntityId("part", name, now), problemCategoryId, name, sourceTaskId, createdAt: timestamp, updatedAt: timestamp };
}

/** Entity-level status, distinct from any TaskInstance status (section 15):
 * a KnowledgeNode with no Blog task yet is UNPLANNED -- not skipped, not
 * cancelled, just not yet planned into a task. */
export const KNOWLEDGE_NODE_STATUSES = ["UNPLANNED", "PLANNED"] as const;
export type KnowledgeNodeStatus = (typeof KNOWLEDGE_NODE_STATUSES)[number];

export interface KnowledgeNode {
  readonly id: string;
  readonly problemPartId: string;
  readonly name: string;
  readonly status: KnowledgeNodeStatus;
  /** The Knowledge Discovery TaskInstance.id this node was generated from. */
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createKnowledgeNode(problemPartId: string, name: string, sourceTaskId: string | null, now: () => string = () => new Date().toISOString()): KnowledgeNode {
  const timestamp = now();
  return { id: stableEntityId("node", name, now), problemPartId, name, status: "UNPLANNED", sourceTaskId, createdAt: timestamp, updatedAt: timestamp };
}

export function setKnowledgeNodeStatus(node: KnowledgeNode, status: KnowledgeNodeStatus, now: () => string = () => new Date().toISOString()): KnowledgeNode {
  if (node.status === status) return node;
  return { ...node, status, updatedAt: now() };
}

export const BLOG_STATES = ["PLANNED", "DRAFT", "APPROVED", "PUBLISHED"] as const;
export type BlogState = (typeof BLOG_STATES)[number];

export interface Blog {
  readonly id: string;
  readonly knowledgeNodeId: string;
  readonly title: string;
  readonly primaryLink: string | null;
  readonly state: BlogState;
  /** The Research TaskInstance.id whose Confirm chose this node for a Blog. */
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A Blog entity is only ever created together with its Blog TaskInstance,
 * at Research-preview Confirm time -- there is no earlier "planned blog"
 * entity state. Simpler lifecycle: KnowledgeNode.status flips to PLANNED
 * and the Blog entity + Blog task are created in the same Confirm. */
export function createBlog(knowledgeNodeId: string, title: string, sourceTaskId: string | null, now: () => string = () => new Date().toISOString()): Blog {
  const timestamp = now();
  return { id: stableEntityId("blog", title, now), knowledgeNodeId, title, primaryLink: null, state: "PLANNED", sourceTaskId, createdAt: timestamp, updatedAt: timestamp };
}

export function setBlogState(blog: Blog, state: BlogState, now: () => string = () => new Date().toISOString()): Blog {
  if (blog.state === state) return blog;
  return { ...blog, state, updatedAt: now() };
}

export function setBlogPrimaryLink(blog: Blog, primaryLink: string | null, now: () => string = () => new Date().toISOString()): Blog {
  return { ...blog, primaryLink, updatedAt: now() };
}

export const MATERIAL_FORMATS = ["REEL", "CAROUSEL", "TEXT_POST"] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];
export const MATERIAL_STATUSES = ["PLANNED", "DRAFT", "DONE"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

/** Minimal entity boundary for future Repurpose work -- not the full
 * Reel/Carousel production chain (deferred this sprint). CTA fields stay
 * deferred too. */
export interface Material {
  readonly id: string;
  readonly blogId: string;
  readonly title: string;
  readonly format: MaterialFormat;
  readonly primaryAtomicIdea: string | null;
  readonly status: MaterialStatus;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createMaterial(
  input: { blogId: string; title: string; format: MaterialFormat; primaryAtomicIdea?: string | null; sourceTaskId?: string | null },
  now: () => string = () => new Date().toISOString(),
): Material {
  const timestamp = now();
  return {
    id: stableEntityId("mat", input.title, now),
    blogId: input.blogId,
    title: input.title,
    format: input.format,
    primaryAtomicIdea: input.primaryAtomicIdea ?? null,
    status: "PLANNED",
    sourceTaskId: input.sourceTaskId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
