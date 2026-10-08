"use client";

/**
 * Thin React wrapper around lib/content-entity-store.ts's pure reducer
 * (V1 Sprint 3). Holds the whole Domain -> ProblemCategory -> ProblemPart
 * -> KnowledgeNode -> Blog -> Material tree for the session. No
 * persistence, no Supabase.
 */
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import {
  contentEntityReducer,
  initialContentEntityState,
  type ContentEntityAction,
  type ContentEntityState,
} from "@/lib/content-entity-store";
import type { Blog, BlogState, KnowledgeNode, KnowledgeNodeStatus, Material, ProblemCategory, ProblemPart } from "@/lib/content-entity";

interface ContentEntityStoreValue {
  readonly state: ContentEntityState;
  readonly addProblemCategory: (category: ProblemCategory) => void;
  readonly addProblemParts: (parts: readonly ProblemPart[]) => void;
  readonly addKnowledgeNodes: (nodes: readonly KnowledgeNode[]) => void;
  readonly setKnowledgeNodeStatus: (id: string, status: KnowledgeNodeStatus) => void;
  readonly addBlogs: (blogs: readonly Blog[]) => void;
  readonly setBlogState: (id: string, state: BlogState) => void;
  readonly setBlogPrimaryLink: (id: string, primaryLink: string | null) => void;
  readonly addMaterial: (material: Material) => void;
}

const ContentEntityStoreContext = createContext<ContentEntityStoreValue | null>(null);

export function ContentEntityStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer((current: ContentEntityState, action: ContentEntityAction) => contentEntityReducer(current, action), undefined, initialContentEntityState);

  const addProblemCategory = useCallback((category: ProblemCategory) => dispatch({ type: "ADD_PROBLEM_CATEGORY", category }), []);
  const addProblemParts = useCallback((parts: readonly ProblemPart[]) => { if (parts.length) dispatch({ type: "ADD_PROBLEM_PARTS", parts }); }, []);
  const addKnowledgeNodes = useCallback((nodes: readonly KnowledgeNode[]) => { if (nodes.length) dispatch({ type: "ADD_KNOWLEDGE_NODES", nodes }); }, []);
  const setKnowledgeNodeStatus = useCallback((id: string, status: KnowledgeNodeStatus) => dispatch({ type: "SET_KNOWLEDGE_NODE_STATUS", id, status }), []);
  const addBlogs = useCallback((blogs: readonly Blog[]) => { if (blogs.length) dispatch({ type: "ADD_BLOGS", blogs }); }, []);
  const setBlogState = useCallback((id: string, blogState: BlogState) => dispatch({ type: "SET_BLOG_STATE", id, state: blogState }), []);
  const setBlogPrimaryLink = useCallback((id: string, primaryLink: string | null) => dispatch({ type: "SET_BLOG_PRIMARY_LINK", id, primaryLink }), []);
  const addMaterial = useCallback((material: Material) => dispatch({ type: "ADD_MATERIAL", material }), []);

  const value = useMemo<ContentEntityStoreValue>(
    () => ({ state, addProblemCategory, addProblemParts, addKnowledgeNodes, setKnowledgeNodeStatus, addBlogs, setBlogState, setBlogPrimaryLink, addMaterial }),
    [state, addProblemCategory, addProblemParts, addKnowledgeNodes, setKnowledgeNodeStatus, addBlogs, setBlogState, setBlogPrimaryLink, addMaterial],
  );

  return <ContentEntityStoreContext.Provider value={value}>{children}</ContentEntityStoreContext.Provider>;
}

export function useContentEntityStore(): ContentEntityStoreValue {
  const value = useContext(ContentEntityStoreContext);
  if (!value) throw new Error("useContentEntityStore must be used within a ContentEntityStoreProvider");
  return value;
}
