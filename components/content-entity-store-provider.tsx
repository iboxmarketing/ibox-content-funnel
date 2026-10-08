"use client";

/**
 * Thin React wrapper around lib/content-entity-store.ts's pure reducer
 * (V1 Sprint 3, extended Sprint 4). Holds the whole Domain ->
 * ProblemCategory -> ProblemPart -> KnowledgeNode -> Blog -> Material
 * tree, plus the Sprint 4 side relations (Angle, Destination,
 * Angle<->Destination links, RepurposeMap, AtomicIdea) for the session.
 * No persistence, no Supabase.
 */
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import {
  contentEntityReducer,
  initialContentEntityState,
  type ContentEntityAction,
  type ContentEntityState,
} from "@/lib/content-entity-store";
import type {
  Angle,
  AngleDestinationLink,
  AtomicIdea,
  Blog,
  BlogState,
  Destination,
  DestinationStatus,
  KnowledgeNode,
  KnowledgeNodeStatus,
  Material,
  MaterialStatus,
  ProblemCategory,
  ProblemPart,
  RepurposeMap,
} from "@/lib/content-entity";

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
  readonly addMaterials: (materials: readonly Material[]) => void;
  readonly setMaterialStatus: (id: string, status: MaterialStatus) => void;
  readonly setMaterialDestination: (id: string, destinationId: string | null) => void;
  readonly addAngles: (angles: readonly Angle[]) => void;
  readonly addDestination: (destination: Destination) => void;
  readonly setDestinationStatus: (id: string, status: DestinationStatus) => void;
  readonly addAngleDestinationLinks: (links: readonly AngleDestinationLink[]) => void;
  readonly addRepurposeMap: (repurposeMap: RepurposeMap) => void;
  readonly addAtomicIdeas: (ideas: readonly AtomicIdea[]) => void;
  /** Applies any list of reducer actions in order -- the one path every
   * handler/preview outcome uses to mutate content entities. */
  readonly applyActions: (actions: readonly ContentEntityAction[]) => void;
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
  const addMaterials = useCallback((materials: readonly Material[]) => { if (materials.length) dispatch({ type: "ADD_MATERIALS", materials }); }, []);
  const setMaterialStatus = useCallback((id: string, status: MaterialStatus) => dispatch({ type: "SET_MATERIAL_STATUS", id, status }), []);
  const setMaterialDestination = useCallback((id: string, destinationId: string | null) => dispatch({ type: "SET_MATERIAL_DESTINATION", id, destinationId }), []);
  const addAngles = useCallback((angles: readonly Angle[]) => { if (angles.length) dispatch({ type: "ADD_ANGLES", angles }); }, []);
  const addDestination = useCallback((destination: Destination) => dispatch({ type: "ADD_DESTINATION", destination }), []);
  const setDestinationStatus = useCallback((id: string, status: DestinationStatus) => dispatch({ type: "SET_DESTINATION_STATUS", id, status }), []);
  const addAngleDestinationLinks = useCallback((links: readonly AngleDestinationLink[]) => { if (links.length) dispatch({ type: "ADD_ANGLE_DESTINATION_LINKS", links }); }, []);
  const addRepurposeMap = useCallback((repurposeMap: RepurposeMap) => dispatch({ type: "ADD_REPURPOSE_MAP", repurposeMap }), []);
  const addAtomicIdeas = useCallback((ideas: readonly AtomicIdea[]) => { if (ideas.length) dispatch({ type: "ADD_ATOMIC_IDEAS", ideas }); }, []);

  const applyActions = useCallback((actions: readonly ContentEntityAction[]) => { for (const action of actions) dispatch(action); }, []);

  const value = useMemo<ContentEntityStoreValue>(
    () => ({
      state,
      addProblemCategory,
      addProblemParts,
      addKnowledgeNodes,
      setKnowledgeNodeStatus,
      addBlogs,
      setBlogState,
      setBlogPrimaryLink,
      addMaterial,
      addMaterials,
      setMaterialStatus,
      setMaterialDestination,
      addAngles,
      addDestination,
      setDestinationStatus,
      addAngleDestinationLinks,
      addRepurposeMap,
      addAtomicIdeas,
      applyActions,
    }),
    [
      state, addProblemCategory, addProblemParts, addKnowledgeNodes, setKnowledgeNodeStatus, addBlogs, setBlogState, setBlogPrimaryLink,
      addMaterial, addMaterials, setMaterialStatus, setMaterialDestination, addAngles, addDestination, setDestinationStatus,
      addAngleDestinationLinks, addRepurposeMap, addAtomicIdeas, applyActions,
    ],
  );

  return <ContentEntityStoreContext.Provider value={value}>{children}</ContentEntityStoreContext.Provider>;
}

export function useContentEntityStore(): ContentEntityStoreValue {
  const value = useContext(ContentEntityStoreContext);
  if (!value) throw new Error("useContentEntityStore must be used within a ContentEntityStoreProvider");
  return value;
}
