"use client";

/**
 * Thin React wrapper around lib/task-runtime-store.ts's pure reducer (V1
 * Sprint 2). Holds every local TaskInstance created so far for the
 * Workflow Run view, plus "suggest as template improvement" notes.
 * Session-memory only; no TaskClient, no Supabase.
 */
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import {
  initialTaskRuntimeState,
  taskRuntimeReducer,
  type TaskRuntimeAction,
  type TaskRuntimeState,
} from "@/lib/task-runtime-store";
import { createTaskInstance, type AtomicIdeaDraft, type FieldValue, type TaskInstance, type TaskInstanceDraft, type TaskInstanceStatus } from "@/lib/task-instance";
import type { TaskLinkDraft } from "@/lib/task-link";
import type { FieldDefinition } from "@/lib/task-type";

interface TaskRuntimeStoreValue {
  readonly state: TaskRuntimeState;
  /** Builds each draft into a real TaskInstance (via createTaskInstance)
   * before dispatch and returns the built entities synchronously, so the
   * caller can e.g. navigate straight to the first newly-generated task
   * right after Confirm. */
  readonly createInstances: (drafts: readonly TaskInstanceDraft[]) => readonly TaskInstance[];
  readonly setStatus: (instanceId: string, status: TaskInstanceStatus) => void;
  readonly setDeadline: (instanceId: string, deadline: string | null) => void;
  readonly setAssignee: (instanceId: string, assignee: string | null) => void;
  readonly setFieldValue: (instanceId: string, fieldId: string, value: FieldValue) => void;
  readonly editTransferredFieldValue: (instanceId: string, fieldId: string, value: FieldValue, writeBack?: { sourceTaskId: string; sourceFieldId: string }) => void;
  readonly addCustomField: (instanceId: string, field: FieldDefinition) => void;
  readonly removeCustomField: (instanceId: string, fieldId: string) => void;
  readonly addAtomicIdeaDraft: (instanceId: string, draft: AtomicIdeaDraft) => void;
  readonly updateAtomicIdeaDraft: (instanceId: string, draftId: string, changes: Partial<Omit<AtomicIdeaDraft, "id">>) => void;
  readonly removeAtomicIdeaDraft: (instanceId: string, draftId: string) => void;
  readonly addLink: (instanceId: string, draft: TaskLinkDraft) => void;
  readonly updateLink: (instanceId: string, linkId: string, changes: Partial<TaskLinkDraft>) => void;
  readonly removeLink: (instanceId: string, linkId: string) => void;
  readonly complete: (instanceId: string) => void;
  readonly skip: (instanceId: string, reason: string) => void;
  readonly addSuggestion: (taskInstanceId: string, taskTypeId: string, field: FieldDefinition, note: string) => void;
}

const TaskRuntimeStoreContext = createContext<TaskRuntimeStoreValue | null>(null);

export function TaskRuntimeStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer((current: TaskRuntimeState, action: TaskRuntimeAction) => taskRuntimeReducer(current, action), undefined, initialTaskRuntimeState);

  const createInstances = useCallback((drafts: readonly TaskInstanceDraft[]) => {
    const instances = drafts.map((draft) => createTaskInstance(draft));
    dispatch({ type: "ADD_INSTANCES", instances });
    return instances;
  }, []);
  const setStatus = useCallback((instanceId: string, status: TaskInstanceStatus) => dispatch({ type: "SET_STATUS", instanceId, status }), []);
  const setDeadline = useCallback((instanceId: string, deadline: string | null) => dispatch({ type: "SET_DEADLINE", instanceId, deadline }), []);
  const setAssignee = useCallback((instanceId: string, assignee: string | null) => dispatch({ type: "SET_ASSIGNEE", instanceId, assignee }), []);
  const setFieldValue = useCallback((instanceId: string, fieldId: string, value: FieldValue) => dispatch({ type: "SET_FIELD_VALUE", instanceId, fieldId, value }), []);
  const editTransferredFieldValue = useCallback(
    (instanceId: string, fieldId: string, value: FieldValue, writeBack?: { sourceTaskId: string; sourceFieldId: string }) =>
      dispatch({ type: "EDIT_TRANSFERRED_FIELD_VALUE", instanceId, fieldId, value, alsoUpdateSourceTaskId: writeBack?.sourceTaskId, sourceFieldId: writeBack?.sourceFieldId }),
    [],
  );
  const addCustomField = useCallback((instanceId: string, field: FieldDefinition) => dispatch({ type: "ADD_CUSTOM_FIELD", instanceId, field }), []);
  const removeCustomField = useCallback((instanceId: string, fieldId: string) => dispatch({ type: "REMOVE_CUSTOM_FIELD", instanceId, fieldId }), []);
  const addAtomicIdeaDraft = useCallback((instanceId: string, draft: AtomicIdeaDraft) => dispatch({ type: "ADD_ATOMIC_IDEA_DRAFT", instanceId, draft }), []);
  const updateAtomicIdeaDraft = useCallback((instanceId: string, draftId: string, changes: Partial<Omit<AtomicIdeaDraft, "id">>) => dispatch({ type: "UPDATE_ATOMIC_IDEA_DRAFT", instanceId, draftId, changes }), []);
  const removeAtomicIdeaDraft = useCallback((instanceId: string, draftId: string) => dispatch({ type: "REMOVE_ATOMIC_IDEA_DRAFT", instanceId, draftId }), []);
  const addLink = useCallback((instanceId: string, draft: TaskLinkDraft) => dispatch({ type: "ADD_LINK", instanceId, draft }), []);
  const updateLink = useCallback((instanceId: string, linkId: string, changes: Partial<TaskLinkDraft>) => dispatch({ type: "UPDATE_LINK", instanceId, linkId, changes }), []);
  const removeLink = useCallback((instanceId: string, linkId: string) => dispatch({ type: "REMOVE_LINK", instanceId, linkId }), []);
  const complete = useCallback((instanceId: string) => dispatch({ type: "COMPLETE", instanceId }), []);
  const skip = useCallback((instanceId: string, reason: string) => dispatch({ type: "SKIP", instanceId, reason }), []);
  const addSuggestion = useCallback((taskInstanceId: string, taskTypeId: string, field: FieldDefinition, note: string) => dispatch({ type: "ADD_SUGGESTION", taskInstanceId, taskTypeId, field, note }), []);

  const value = useMemo<TaskRuntimeStoreValue>(
    () => ({
      state, createInstances, setStatus, setDeadline, setAssignee, setFieldValue, editTransferredFieldValue, addCustomField, removeCustomField,
      addAtomicIdeaDraft, updateAtomicIdeaDraft, removeAtomicIdeaDraft, addLink, updateLink, removeLink, complete, skip, addSuggestion,
    }),
    [
      state, createInstances, setStatus, setDeadline, setAssignee, setFieldValue, editTransferredFieldValue, addCustomField, removeCustomField,
      addAtomicIdeaDraft, updateAtomicIdeaDraft, removeAtomicIdeaDraft, addLink, updateLink, removeLink, complete, skip, addSuggestion,
    ],
  );

  return <TaskRuntimeStoreContext.Provider value={value}>{children}</TaskRuntimeStoreContext.Provider>;
}

export function useTaskRuntimeStore(): TaskRuntimeStoreValue {
  const value = useContext(TaskRuntimeStoreContext);
  if (!value) throw new Error("useTaskRuntimeStore must be used within a TaskRuntimeStoreProvider");
  return value;
}
