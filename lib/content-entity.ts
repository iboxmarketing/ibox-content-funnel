/**
 * Content OS entity model (V1 Sprint 3, extended Sprint 4): the visible
 * content hierarchy, completely separate from the operational TaskInstance
 * runtime.
 *
 *   Domain -> ProblemCategory -> ProblemPart -> KnowledgeNode -> Blog -> Material
 *
 * Angle, Destination, and RepurposeMap are deliberately NOT tree nodes
 * (per spec) -- Angle attaches to a KnowledgeNode, Destination to a
 * ProblemCategory, RepurposeMap to a Blog, all as side relations rather
 * than tree levels. TaskInstances never enter this tree -- a task OPERATES
 * ON an entity (via ContentEntityRef, see task-instance.ts) but is never
 * itself a tree node.
 *
 * Local/session-only, same as every other Sprint 1-4 model: no Supabase,
 * no `tasks.content_ref`, no `content_task_links` table. Entity ids are
 * never reused as task ids or vice versa. The future production bridge
 * stays conceptual only: content entity <-> content_task_links <->
 * existing public.tasks.id -- content_task_links is not implemented.
 */

export const CONTENT_ENTITY_TYPES = ["DOMAIN", "PROBLEM_CATEGORY", "PROBLEM_PART", "KNOWLEDGE_NODE", "BLOG", "MATERIAL", "ANGLE", "DESTINATION", "REPURPOSE_MAP"] as const;
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

export const MATERIAL_FORMATS = ["REEL", "CAROUSEL", "TEXT_POST", "YOUTUBE"] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];
export const MATERIAL_STATUSES = ["PLANNED", "IN_PRODUCTION", "READY", "PUBLISHED"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

/**
 * One Material per confirmed (AtomicIdea, format) pair -- the same Atomic
 * Idea selected for Reel + Carousel + Text produces three Material
 * entities (section 16). `destinationId` deliberately stays optional:
 * per the approved product rule, CTA/exact Destination is chosen in a
 * LATER production task, never forced at Material creation time --
 * `destinationNeeded` (copied from the Atomic Idea) is all that's known
 * here. Not the full Reel/Carousel production chain (deferred).
 */
export interface Material {
  readonly id: string;
  readonly blogId: string;
  readonly title: string;
  readonly format: MaterialFormat;
  readonly primaryAtomicIdeaId: string;
  readonly angleId: string | null;
  readonly destinationNeeded: boolean;
  readonly destinationId: string | null;
  readonly status: MaterialStatus;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createMaterial(
  input: {
    blogId: string;
    title: string;
    format: MaterialFormat;
    primaryAtomicIdeaId: string;
    angleId?: string | null;
    destinationNeeded?: boolean;
    destinationId?: string | null;
    sourceTaskId?: string | null;
  },
  now: () => string = () => new Date().toISOString(),
): Material {
  const timestamp = now();
  return {
    id: stableEntityId("mat", input.title, now),
    blogId: input.blogId,
    title: input.title,
    format: input.format,
    primaryAtomicIdeaId: input.primaryAtomicIdeaId,
    angleId: input.angleId ?? null,
    destinationNeeded: input.destinationNeeded ?? false,
    destinationId: input.destinationId ?? null,
    status: "PLANNED",
    sourceTaskId: input.sourceTaskId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function setMaterialStatus(material: Material, status: MaterialStatus, now: () => string = () => new Date().toISOString()): Material {
  if (material.status === status) return material;
  return { ...material, status, updatedAt: now() };
}

export function setMaterialDestination(material: Material, destinationId: string | null, now: () => string = () => new Date().toISOString()): Material {
  return { ...material, destinationId, updatedAt: now() };
}

// --- Angle (section 2): local to one KnowledgeNode, never a global library ---

export const ANGLE_USAGES = ["ORGANIC", "PERFORMANCE", "BOTH"] as const;
export type AngleUsage = (typeof ANGLE_USAGES)[number];
export const ANGLE_PRIORITIES = ["NOW", "LATER", "TEST"] as const;
export type AnglePriority = (typeof ANGLE_PRIORITIES)[number];

export interface Angle {
  readonly id: string;
  readonly knowledgeNodeId: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly category: string;
  readonly painScore: number;
  readonly clarityScore: number;
  readonly evidenceScore: number;
  readonly iboxRelevanceScore: number;
  readonly organicPotential: number;
  readonly performancePotential: number;
  readonly usage: AngleUsage;
  readonly priority: AnglePriority;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AngleDraft {
  readonly title: string;
  readonly shortDescription?: string;
  readonly category?: string;
  readonly painScore?: number;
  readonly clarityScore?: number;
  readonly evidenceScore?: number;
  readonly iboxRelevanceScore?: number;
  readonly organicPotential?: number;
  readonly performancePotential?: number;
  readonly usage?: AngleUsage;
  readonly priority?: AnglePriority;
}

export function createAngle(knowledgeNodeId: string, draft: AngleDraft, sourceTaskId: string | null, now: () => string = () => new Date().toISOString()): Angle {
  const timestamp = now();
  return {
    id: stableEntityId("angle", draft.title, now),
    knowledgeNodeId,
    title: draft.title,
    shortDescription: draft.shortDescription ?? "",
    category: draft.category ?? "",
    painScore: draft.painScore ?? 0,
    clarityScore: draft.clarityScore ?? 0,
    evidenceScore: draft.evidenceScore ?? 0,
    iboxRelevanceScore: draft.iboxRelevanceScore ?? 0,
    organicPotential: draft.organicPotential ?? 0,
    performancePotential: draft.performancePotential ?? 0,
    usage: draft.usage ?? "BOTH",
    priority: draft.priority ?? "LATER",
    sourceTaskId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// --- Destination (section 5): belongs to a ProblemCategory, never the knowledge tree ---

export const DESTINATION_TYPES = ["YOUTUBE", "CHECKLIST_OR_PDF", "EXTERNAL_TOOL_OR_URL"] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];
export const DESTINATION_STATUSES = ["PLANNED", "IN_PROGRESS", "READY"] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export interface Destination {
  readonly id: string;
  readonly problemCategoryId: string;
  readonly name: string;
  readonly type: DestinationType;
  readonly valueProposition: string;
  readonly status: DestinationStatus;
  readonly primaryUrl: string | null;
  readonly owner: string | null;
  readonly deadline: string | null;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createDestination(
  input: { problemCategoryId: string; name: string; type: DestinationType; valueProposition?: string; owner?: string | null; deadline?: string | null; sourceTaskId?: string | null },
  now: () => string = () => new Date().toISOString(),
): Destination {
  const timestamp = now();
  return {
    id: stableEntityId("dest", input.name, now),
    problemCategoryId: input.problemCategoryId,
    name: input.name,
    type: input.type,
    valueProposition: input.valueProposition ?? "",
    status: "PLANNED",
    primaryUrl: null,
    owner: input.owner ?? null,
    deadline: input.deadline ?? null,
    sourceTaskId: input.sourceTaskId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function setDestinationStatus(destination: Destination, status: DestinationStatus, now: () => string = () => new Date().toISOString()): Destination {
  if (destination.status === status) return destination;
  return { ...destination, status, updatedAt: now() };
}

/** Section 21: not enforced anywhere yet (no publish runtime this
 * sprint) -- just the state a future Publish gate would read: "if a
 * Material has an exact Destination, that Destination must be READY
 * before Publish." */
export function isDestinationReadyForPublish(destination: Destination): boolean {
  return destination.status === "READY";
}

/** Angle <-> Destination, many-to-many (section 10). Material <->
 * Destination stays a direct optional FK on Material for now
 * (`Material.destinationId`) -- the spec only requires many-to-many
 * support for Angle <-> Destination this sprint ("later" for Material). */
export interface AngleDestinationLink {
  readonly id: string;
  readonly angleId: string;
  readonly destinationId: string;
  readonly createdAt: string;
}

export function createAngleDestinationLink(angleId: string, destinationId: string, now: () => string = () => new Date().toISOString()): AngleDestinationLink {
  return { id: stableEntityId("link", `${angleId}-${destinationId}`, now), angleId, destinationId, createdAt: now() };
}

// --- RepurposeMap + AtomicIdea (sections 12-14) ---

export interface RepurposeMap {
  readonly id: string;
  readonly blogId: string;
  readonly sourceTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createRepurposeMap(blogId: string, sourceTaskId: string | null, now: () => string = () => new Date().toISOString()): RepurposeMap {
  const timestamp = now();
  return { id: stableEntityId("rmap", blogId, now), blogId, sourceTaskId, createdAt: timestamp, updatedAt: timestamp };
}

export const ATOMIC_IDEA_COVERAGE_TYPES = ["PROBLEM", "CAUSE", "CONSEQUENCE", "SOLUTION", "OTHER"] as const;
export type AtomicIdeaCoverageType = (typeof ATOMIC_IDEA_COVERAGE_TYPES)[number];
export const ATOMIC_IDEA_DECISIONS = ["CREATE_CONTENT", "BLOG_ONLY", "LATER"] as const;
export type AtomicIdeaDecision = (typeof ATOMIC_IDEA_DECISIONS)[number];

/** No separate Treatment field, no Format Fit scoring (per instruction --
 * deliberately not over-built this sprint). */
export interface AtomicIdea {
  readonly id: string;
  readonly repurposeMapId: string;
  readonly text: string;
  readonly coverageType: AtomicIdeaCoverageType;
  readonly decision: AtomicIdeaDecision;
  readonly selectedFormats: readonly MaterialFormat[];
  readonly angleId: string | null;
  readonly destinationNeeded: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createAtomicIdea(
  input: {
    repurposeMapId: string;
    text: string;
    coverageType: AtomicIdeaCoverageType;
    decision: AtomicIdeaDecision;
    selectedFormats: readonly MaterialFormat[];
    angleId?: string | null;
    destinationNeeded?: boolean;
  },
  now: () => string = () => new Date().toISOString(),
): AtomicIdea {
  const timestamp = now();
  return {
    id: stableEntityId("idea", input.text, now),
    repurposeMapId: input.repurposeMapId,
    text: input.text,
    coverageType: input.coverageType,
    decision: input.decision,
    selectedFormats: input.selectedFormats,
    angleId: input.angleId ?? null,
    destinationNeeded: input.destinationNeeded ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
