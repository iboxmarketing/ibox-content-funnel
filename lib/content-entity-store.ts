/**
 * Shared Content Entity store (V1 Sprint 3, extended Sprint 4):
 * session-only reducer holding the whole Domain -> ProblemCategory ->
 * ProblemPart -> KnowledgeNode -> Blog -> Material tree, plus the
 * Sprint 4 side relations (Angle, Destination, Angle<->Destination links,
 * RepurposeMap, AtomicIdea) that are NOT tree nodes themselves. Mirrors
 * content-os-store.ts / task-runtime-store.ts in shape: pure state +
 * actions here, a thin `useReducer` React wrapper in
 * components/content-entity-store-provider.tsx.
 */
import {
  confirmMaterialResultReview,
  setBlogPrimaryLink,
  setBlogState,
  setDestinationStatus,
  setKnowledgeNodeStatus,
  setMaterialCta,
  setMaterialDestination,
  setMaterialProduction,
  setMaterialStatus,
  setShootSessionStatus,
  type Angle,
  type AngleDestinationLink,
  type AtomicIdea,
  type Blog,
  type BlogState,
  type ContentEntityRef,
  type ContentEntityType,
  type Destination,
  type DestinationStatus,
  type Domain,
  type KnowledgeNode,
  type KnowledgeNodeStatus,
  type CtaType,
  type Material,
  type MaterialResultReview,
  type MaterialStatus,
  type ShootSession,
  type ShootSessionStatus,
  type ProblemCategory,
  type ProblemPart,
  type RepurposeMap,
} from "./content-entity";
import { QOLDIQ_CONTENT_ENTITY_FIXTURE } from "./content-entity-fixtures";

export interface ContentEntityState {
  readonly domains: readonly Domain[];
  readonly problemCategories: readonly ProblemCategory[];
  readonly problemParts: readonly ProblemPart[];
  readonly knowledgeNodes: readonly KnowledgeNode[];
  readonly blogs: readonly Blog[];
  readonly materials: readonly Material[];
  readonly angles: readonly Angle[];
  readonly destinations: readonly Destination[];
  readonly angleDestinationLinks: readonly AngleDestinationLink[];
  readonly repurposeMaps: readonly RepurposeMap[];
  readonly atomicIdeas: readonly AtomicIdea[];
  readonly shootSessions: readonly ShootSession[];
  /** Sprint 7: one Material-level result review per Material. */
  readonly materialResultReviews: readonly MaterialResultReview[];
}

export function initialContentEntityState(): ContentEntityState {
  return structuredClone(QOLDIQ_CONTENT_ENTITY_FIXTURE) as ContentEntityState;
}

export function emptyContentEntityState(): ContentEntityState {
  return {
    domains: [],
    problemCategories: [],
    problemParts: [],
    knowledgeNodes: [],
    blogs: [],
    materials: [],
    angles: [],
    destinations: [],
    angleDestinationLinks: [],
    repurposeMaps: [],
    atomicIdeas: [],
    shootSessions: [],
    materialResultReviews: [],
  };
}

export type ContentEntityAction =
  | { readonly type: "ADD_PROBLEM_CATEGORY"; readonly category: ProblemCategory }
  | { readonly type: "ADD_PROBLEM_PARTS"; readonly parts: readonly ProblemPart[] }
  | { readonly type: "ADD_KNOWLEDGE_NODES"; readonly nodes: readonly KnowledgeNode[] }
  | { readonly type: "SET_KNOWLEDGE_NODE_STATUS"; readonly id: string; readonly status: KnowledgeNodeStatus }
  | { readonly type: "ADD_BLOGS"; readonly blogs: readonly Blog[] }
  | { readonly type: "SET_BLOG_STATE"; readonly id: string; readonly state: BlogState }
  | { readonly type: "SET_BLOG_PRIMARY_LINK"; readonly id: string; readonly primaryLink: string | null }
  | { readonly type: "ADD_MATERIAL"; readonly material: Material }
  | { readonly type: "ADD_MATERIALS"; readonly materials: readonly Material[] }
  | { readonly type: "SET_MATERIAL_STATUS"; readonly id: string; readonly status: MaterialStatus }
  | { readonly type: "SET_MATERIAL_DESTINATION"; readonly id: string; readonly destinationId: string | null }
  | { readonly type: "ADD_ANGLES"; readonly angles: readonly Angle[] }
  | { readonly type: "ADD_DESTINATION"; readonly destination: Destination }
  | { readonly type: "SET_DESTINATION_STATUS"; readonly id: string; readonly status: DestinationStatus }
  | { readonly type: "ADD_ANGLE_DESTINATION_LINKS"; readonly links: readonly AngleDestinationLink[] }
  | { readonly type: "ADD_REPURPOSE_MAP"; readonly repurposeMap: RepurposeMap }
  | { readonly type: "ADD_ATOMIC_IDEAS"; readonly ideas: readonly AtomicIdea[] }
  | { readonly type: "SET_MATERIAL_CTA"; readonly id: string; readonly ctaType: CtaType; readonly ctaText: string; readonly destinationId: string | null }
  | { readonly type: "SET_MATERIAL_PRODUCTION"; readonly id: string; readonly shootSessionId?: string | null }
  | { readonly type: "ADD_SHOOT_SESSION"; readonly session: ShootSession }
  | { readonly type: "SET_SHOOT_SESSION_STATUS"; readonly id: string; readonly status: ShootSessionStatus }
  /** A confirmed successful publish (sourceTaskId set) or a manual date
   * edit (sourceTaskId null). Upserts the Material's one result review. */
  | { readonly type: "CONFIRM_MATERIAL_RESULT_REVIEW"; readonly materialId: string; readonly resultReviewAt: string | null; readonly sourceTaskId: string | null };

/** Pure. Never mutates `state`. */
export function contentEntityReducer(state: ContentEntityState, action: ContentEntityAction, now: () => string = () => new Date().toISOString()): ContentEntityState {
  switch (action.type) {
    case "ADD_PROBLEM_CATEGORY":
      return { ...state, problemCategories: [...state.problemCategories, action.category] };
    case "ADD_PROBLEM_PARTS":
      return { ...state, problemParts: [...state.problemParts, ...action.parts] };
    case "ADD_KNOWLEDGE_NODES":
      return { ...state, knowledgeNodes: [...state.knowledgeNodes, ...action.nodes] };
    case "SET_KNOWLEDGE_NODE_STATUS": {
      const current = state.knowledgeNodes.find((node) => node.id === action.id);
      if (!current) return state;
      const next = setKnowledgeNodeStatus(current, action.status, now);
      return { ...state, knowledgeNodes: state.knowledgeNodes.map((node) => (node.id === action.id ? next : node)) };
    }
    case "ADD_BLOGS":
      return { ...state, blogs: [...state.blogs, ...action.blogs] };
    case "SET_BLOG_STATE": {
      const current = state.blogs.find((blog) => blog.id === action.id);
      if (!current) return state;
      return { ...state, blogs: state.blogs.map((blog) => (blog.id === action.id ? setBlogState(current, action.state, now) : blog)) };
    }
    case "SET_BLOG_PRIMARY_LINK": {
      const current = state.blogs.find((blog) => blog.id === action.id);
      if (!current) return state;
      return { ...state, blogs: state.blogs.map((blog) => (blog.id === action.id ? setBlogPrimaryLink(current, action.primaryLink, now) : blog)) };
    }
    case "ADD_MATERIAL":
      return { ...state, materials: [...state.materials, action.material] };
    case "ADD_MATERIALS":
      return { ...state, materials: [...state.materials, ...action.materials] };
    case "SET_MATERIAL_STATUS": {
      const current = state.materials.find((material) => material.id === action.id);
      if (!current) return state;
      return { ...state, materials: state.materials.map((material) => (material.id === action.id ? setMaterialStatus(current, action.status, now) : material)) };
    }
    case "SET_MATERIAL_DESTINATION": {
      const current = state.materials.find((material) => material.id === action.id);
      if (!current) return state;
      return { ...state, materials: state.materials.map((material) => (material.id === action.id ? setMaterialDestination(current, action.destinationId, now) : material)) };
    }
    case "ADD_ANGLES":
      return { ...state, angles: [...state.angles, ...action.angles] };
    case "ADD_DESTINATION":
      return { ...state, destinations: [...state.destinations, action.destination] };
    case "SET_DESTINATION_STATUS": {
      const current = state.destinations.find((destination) => destination.id === action.id);
      if (!current) return state;
      return { ...state, destinations: state.destinations.map((destination) => (destination.id === action.id ? setDestinationStatus(current, action.status, now) : destination)) };
    }
    case "ADD_ANGLE_DESTINATION_LINKS":
      return { ...state, angleDestinationLinks: [...state.angleDestinationLinks, ...action.links] };
    case "ADD_REPURPOSE_MAP":
      return { ...state, repurposeMaps: [...state.repurposeMaps, action.repurposeMap] };
    case "ADD_ATOMIC_IDEAS":
      return { ...state, atomicIdeas: [...state.atomicIdeas, ...action.ideas] };
    case "SET_MATERIAL_CTA": {
      const current = state.materials.find((material) => material.id === action.id);
      if (!current) return state;
      const next = setMaterialCta(current, { ctaType: action.ctaType, ctaText: action.ctaText, destinationId: action.destinationId }, now);
      return { ...state, materials: state.materials.map((material) => (material.id === action.id ? next : material)) };
    }
    case "SET_MATERIAL_PRODUCTION": {
      const current = state.materials.find((material) => material.id === action.id);
      if (!current) return state;
      const next = setMaterialProduction(current, { shootSessionId: action.shootSessionId }, now);
      return { ...state, materials: state.materials.map((material) => (material.id === action.id ? next : material)) };
    }
    case "ADD_SHOOT_SESSION":
      return { ...state, shootSessions: [...state.shootSessions, action.session] };
    case "SET_SHOOT_SESSION_STATUS": {
      const current = state.shootSessions.find((session) => session.id === action.id);
      if (!current) return state;
      return { ...state, shootSessions: state.shootSessions.map((session) => (session.id === action.id ? setShootSessionStatus(current, action.status, now) : session)) };
    }
    case "CONFIRM_MATERIAL_RESULT_REVIEW": {
      const current = state.materialResultReviews.find((review) => review.materialId === action.materialId);
      const next = confirmMaterialResultReview(current, action, now);
      return { ...state, materialResultReviews: current ? state.materialResultReviews.map((review) => (review === current ? next : review)) : [...state.materialResultReviews, next] };
    }
    default:
      return state;
  }
}

// --- Tree lookups ---

export function materialResultReviewFor(state: ContentEntityState, materialId: string): MaterialResultReview | undefined {
  return state.materialResultReviews.find((review) => review.materialId === materialId);
}

export function problemCategoriesForDomain(state: ContentEntityState, domainId: string): readonly ProblemCategory[] {
  return state.problemCategories.filter((category) => category.domainId === domainId);
}

export function problemPartsForCategory(state: ContentEntityState, problemCategoryId: string): readonly ProblemPart[] {
  return state.problemParts.filter((part) => part.problemCategoryId === problemCategoryId);
}

export function knowledgeNodesForPart(state: ContentEntityState, problemPartId: string): readonly KnowledgeNode[] {
  return state.knowledgeNodes.filter((node) => node.problemPartId === problemPartId);
}

export function blogsForNode(state: ContentEntityState, knowledgeNodeId: string): readonly Blog[] {
  return state.blogs.filter((blog) => blog.knowledgeNodeId === knowledgeNodeId);
}

export function materialsForBlog(state: ContentEntityState, blogId: string): readonly Material[] {
  return state.materials.filter((material) => material.blogId === blogId);
}

export function anglesForKnowledgeNode(state: ContentEntityState, knowledgeNodeId: string): readonly Angle[] {
  return state.angles.filter((angle) => angle.knowledgeNodeId === knowledgeNodeId);
}

export function destinationsForProblemCategory(state: ContentEntityState, problemCategoryId: string): readonly Destination[] {
  return state.destinations.filter((destination) => destination.problemCategoryId === problemCategoryId);
}

export function destinationsForAngle(state: ContentEntityState, angleId: string): readonly Destination[] {
  const destinationIds = new Set(state.angleDestinationLinks.filter((link) => link.angleId === angleId).map((link) => link.destinationId));
  return state.destinations.filter((destination) => destinationIds.has(destination.id));
}

export function anglesForDestination(state: ContentEntityState, destinationId: string): readonly Angle[] {
  const angleIds = new Set(state.angleDestinationLinks.filter((link) => link.destinationId === destinationId).map((link) => link.angleId));
  return state.angles.filter((angle) => angleIds.has(angle.id));
}

export function materialsForDestination(state: ContentEntityState, destinationId: string): readonly Material[] {
  return state.materials.filter((material) => material.destinationId === destinationId);
}

/** Section 4: the Destination Library a Material may pick from is the one
 * scoped to its own ProblemCategory (Material -> Blog -> KnowledgeNode ->
 * ProblemPart -> ProblemCategory). */
export function problemCategoryIdForMaterial(state: ContentEntityState, material: Material): string | null {
  const blog = state.blogs.find((b) => b.id === material.blogId);
  const node = blog ? state.knowledgeNodes.find((n) => n.id === blog.knowledgeNodeId) : undefined;
  const part = node ? state.problemParts.find((p) => p.id === node.problemPartId) : undefined;
  return part?.problemCategoryId ?? null;
}

export function repurposeMapForBlog(state: ContentEntityState, blogId: string): RepurposeMap | undefined {
  return state.repurposeMaps.find((map) => map.blogId === blogId);
}

export function atomicIdeasForRepurposeMap(state: ContentEntityState, repurposeMapId: string): readonly AtomicIdea[] {
  return state.atomicIdeas.filter((idea) => idea.repurposeMapId === repurposeMapId);
}

export function entityByRef(
  state: ContentEntityState,
  entityRef: ContentEntityRef,
): Domain | ProblemCategory | ProblemPart | KnowledgeNode | Blog | Material | Angle | Destination | RepurposeMap | ShootSession | undefined {
  switch (entityRef.entityType) {
    case "DOMAIN":
      return state.domains.find((e) => e.id === entityRef.entityId);
    case "PROBLEM_CATEGORY":
      return state.problemCategories.find((e) => e.id === entityRef.entityId);
    case "PROBLEM_PART":
      return state.problemParts.find((e) => e.id === entityRef.entityId);
    case "KNOWLEDGE_NODE":
      return state.knowledgeNodes.find((e) => e.id === entityRef.entityId);
    case "BLOG":
      return state.blogs.find((e) => e.id === entityRef.entityId);
    case "MATERIAL":
      return state.materials.find((e) => e.id === entityRef.entityId);
    case "ANGLE":
      return state.angles.find((e) => e.id === entityRef.entityId);
    case "DESTINATION":
      return state.destinations.find((e) => e.id === entityRef.entityId);
    case "REPURPOSE_MAP":
      return state.repurposeMaps.find((e) => e.id === entityRef.entityId);
    case "SHOOT_SESSION":
      return state.shootSessions.find((e) => e.id === entityRef.entityId);
    default:
      return undefined;
  }
}

/** Human-readable label for Task Detail's "Working on" (section 14). Never
 * the whole tree -- just this one entity's own name/title. */
export function labelForRef(state: ContentEntityState, entityRef: ContentEntityRef): string | null {
  const entity = entityByRef(state, entityRef);
  if (!entity) return null;
  if ("name" in entity) return entity.name;
  if ("title" in entity) return entity.title;
  return entityRef.entityId; // RepurposeMap has neither -- fall back to its id
}

// --- Tree integrity validation ---

export type ContentTreeValidationErrorCode =
  | "ORPHAN_PROBLEM_CATEGORY"
  | "ORPHAN_PROBLEM_PART"
  | "ORPHAN_KNOWLEDGE_NODE"
  | "ORPHAN_BLOG"
  | "ORPHAN_MATERIAL"
  | "ORPHAN_ANGLE"
  | "ORPHAN_DESTINATION"
  | "ORPHAN_ANGLE_DESTINATION_LINK"
  | "ORPHAN_REPURPOSE_MAP"
  | "ORPHAN_ATOMIC_IDEA"
  | "ORPHAN_SHOOT_SESSION";

export interface ContentTreeValidationError {
  readonly code: ContentTreeValidationErrorCode;
  readonly entityId: string;
  readonly message: string;
}

/** Pure. Confirms every parent reference in the tree actually resolves --
 * a ProblemPart really belongs to an existing ProblemCategory, and so on
 * down to Material belonging to an existing Blog. */
export function validateContentTree(state: ContentEntityState): ContentTreeValidationError[] {
  const errors: ContentTreeValidationError[] = [];
  const domainIds = new Set(state.domains.map((d) => d.id));
  const categoryIds = new Set(state.problemCategories.map((c) => c.id));
  const partIds = new Set(state.problemParts.map((p) => p.id));
  const nodeIds = new Set(state.knowledgeNodes.map((n) => n.id));
  const blogIds = new Set(state.blogs.map((b) => b.id));

  for (const category of state.problemCategories) {
    if (!domainIds.has(category.domainId)) errors.push({ code: "ORPHAN_PROBLEM_CATEGORY", entityId: category.id, message: `Problem Category "${category.name}" noma'lum Domain'ga ishora qiladi.` });
  }
  for (const part of state.problemParts) {
    if (!categoryIds.has(part.problemCategoryId)) errors.push({ code: "ORPHAN_PROBLEM_PART", entityId: part.id, message: `Problem Part "${part.name}" noma'lum Problem Category'ga ishora qiladi.` });
  }
  for (const node of state.knowledgeNodes) {
    if (!partIds.has(node.problemPartId)) errors.push({ code: "ORPHAN_KNOWLEDGE_NODE", entityId: node.id, message: `Knowledge Node "${node.name}" noma'lum Problem Part'ga ishora qiladi.` });
  }
  for (const blog of state.blogs) {
    if (!nodeIds.has(blog.knowledgeNodeId)) errors.push({ code: "ORPHAN_BLOG", entityId: blog.id, message: `Blog "${blog.title}" noma'lum Knowledge Node'ga ishora qiladi.` });
  }
  for (const material of state.materials) {
    if (!blogIds.has(material.blogId)) errors.push({ code: "ORPHAN_MATERIAL", entityId: material.id, message: `Material "${material.title}" noma'lum Blog'ga ishora qiladi.` });
  }

  const angleIds = new Set(state.angles.map((a) => a.id));
  const destinationIds = new Set(state.destinations.map((d) => d.id));
  const repurposeMapIds = new Set(state.repurposeMaps.map((m) => m.id));

  for (const angle of state.angles) {
    if (!nodeIds.has(angle.knowledgeNodeId)) errors.push({ code: "ORPHAN_ANGLE", entityId: angle.id, message: `Angle "${angle.title}" noma'lum Knowledge Node'ga ishora qiladi.` });
  }
  for (const destination of state.destinations) {
    if (!categoryIds.has(destination.problemCategoryId)) errors.push({ code: "ORPHAN_DESTINATION", entityId: destination.id, message: `Destination "${destination.name}" noma'lum Problem Category'ga ishora qiladi.` });
  }
  for (const link of state.angleDestinationLinks) {
    if (!angleIds.has(link.angleId) || !destinationIds.has(link.destinationId)) errors.push({ code: "ORPHAN_ANGLE_DESTINATION_LINK", entityId: link.id, message: `Angle<->Destination link "${link.id}" noma'lum entity'ga ishora qiladi.` });
  }
  for (const map of state.repurposeMaps) {
    if (!blogIds.has(map.blogId)) errors.push({ code: "ORPHAN_REPURPOSE_MAP", entityId: map.id, message: `Repurpose Map "${map.id}" noma'lum Blog'ga ishora qiladi.` });
  }
  for (const idea of state.atomicIdeas) {
    if (!repurposeMapIds.has(idea.repurposeMapId)) errors.push({ code: "ORPHAN_ATOMIC_IDEA", entityId: idea.id, message: `Atomic Idea "${idea.id}" noma'lum Repurpose Map'ga ishora qiladi.` });
  }

  const materialIds = new Set(state.materials.map((m) => m.id));
  for (const session of state.shootSessions) {
    if (session.materialIds.some((id) => !materialIds.has(id))) errors.push({ code: "ORPHAN_SHOOT_SESSION", entityId: session.id, message: `Shoot Session "${session.title}" noma'lum Material'ga ishora qiladi.` });
  }

  return errors;
}

export type { ContentEntityType };
