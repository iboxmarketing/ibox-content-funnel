/**
 * Shared Content Entity store (V1 Sprint 3): session-only reducer holding
 * the whole Domain -> ProblemCategory -> ProblemPart -> KnowledgeNode ->
 * Blog -> Material tree. Mirrors content-os-store.ts / task-runtime-store.ts
 * in shape: pure state + actions here, a thin `useReducer` React wrapper in
 * components/content-entity-store-provider.tsx.
 */
import {
  setBlogPrimaryLink,
  setBlogState,
  setKnowledgeNodeStatus,
  type Blog,
  type BlogState,
  type ContentEntityRef,
  type ContentEntityType,
  type Domain,
  type KnowledgeNode,
  type KnowledgeNodeStatus,
  type Material,
  type ProblemCategory,
  type ProblemPart,
} from "./content-entity";
import { QOLDIQ_CONTENT_ENTITY_FIXTURE } from "./content-entity-fixtures";

export interface ContentEntityState {
  readonly domains: readonly Domain[];
  readonly problemCategories: readonly ProblemCategory[];
  readonly problemParts: readonly ProblemPart[];
  readonly knowledgeNodes: readonly KnowledgeNode[];
  readonly blogs: readonly Blog[];
  readonly materials: readonly Material[];
}

export function initialContentEntityState(): ContentEntityState {
  return structuredClone(QOLDIQ_CONTENT_ENTITY_FIXTURE) as ContentEntityState;
}

export function emptyContentEntityState(): ContentEntityState {
  return { domains: [], problemCategories: [], problemParts: [], knowledgeNodes: [], blogs: [], materials: [] };
}

export type ContentEntityAction =
  | { readonly type: "ADD_PROBLEM_CATEGORY"; readonly category: ProblemCategory }
  | { readonly type: "ADD_PROBLEM_PARTS"; readonly parts: readonly ProblemPart[] }
  | { readonly type: "ADD_KNOWLEDGE_NODES"; readonly nodes: readonly KnowledgeNode[] }
  | { readonly type: "SET_KNOWLEDGE_NODE_STATUS"; readonly id: string; readonly status: KnowledgeNodeStatus }
  | { readonly type: "ADD_BLOGS"; readonly blogs: readonly Blog[] }
  | { readonly type: "SET_BLOG_STATE"; readonly id: string; readonly state: BlogState }
  | { readonly type: "SET_BLOG_PRIMARY_LINK"; readonly id: string; readonly primaryLink: string | null }
  | { readonly type: "ADD_MATERIAL"; readonly material: Material };

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
    default:
      return state;
  }
}

// --- Tree lookups ---

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

export function entityByRef(state: ContentEntityState, entityRef: ContentEntityRef): Domain | ProblemCategory | ProblemPart | KnowledgeNode | Blog | Material | undefined {
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
    default:
      return undefined;
  }
}

/** Human-readable label for Task Detail's "Working on" (section 14). Never
 * the whole tree -- just this one entity's own name/title. */
export function labelForRef(state: ContentEntityState, entityRef: ContentEntityRef): string | null {
  const entity = entityByRef(state, entityRef);
  if (!entity) return null;
  return "name" in entity ? entity.name : entity.title;
}

// --- Tree integrity validation ---

export type ContentTreeValidationErrorCode =
  | "ORPHAN_PROBLEM_CATEGORY"
  | "ORPHAN_PROBLEM_PART"
  | "ORPHAN_KNOWLEDGE_NODE"
  | "ORPHAN_BLOG"
  | "ORPHAN_MATERIAL";

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

  return errors;
}

export type { ContentEntityType };
