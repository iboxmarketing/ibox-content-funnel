"use client";

/**
 * Thin React wrapper around lib/content-os-store.ts's pure reducer (V1
 * Sprint 2). This is what fixes the Sprint 1 risk: Task Type Library and
 * Workflow Template Builder now read/write the same `useReducer` state
 * instead of each seeding an independent copy from fixtures, so a Task
 * Type edit is immediately visible in the Workflow Builder (and vice
 * versa). Session-memory only -- a reload resets to the Sprint 1
 * fixtures, same as before.
 */
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import {
  contentOsReducer,
  initialContentOsState,
  type ContentOsAction,
  type ContentOsState,
} from "@/lib/content-os-store";
import { createTaskType as buildTaskType, duplicateTaskType as buildDuplicateTaskType, type TaskType, type TaskTypeDraft } from "@/lib/task-type";
import { createWorkflowTemplate as buildWorkflowTemplate, type NewWorkflowStepInput, type WorkflowTemplate, type WorkflowTemplateDraft } from "@/lib/workflow-template";

interface ContentOsStoreValue {
  readonly state: ContentOsState;
  /** Returns the newly-created entity synchronously (built via the pure
   * Sprint 1 lib functions before dispatch) so the caller can e.g. select
   * it right away, without waiting for a re-render to read it back out of
   * state. */
  readonly createTaskType: (draft: TaskTypeDraft) => TaskType;
  readonly reviseTaskType: (id: string, changes: Partial<TaskTypeDraft>) => void;
  readonly duplicateTaskType: (id: string) => TaskType | null;
  readonly setTaskTypeActive: (id: string, isActive: boolean) => void;
  readonly createWorkflowTemplate: (draft: WorkflowTemplateDraft) => WorkflowTemplate;
  readonly reviseWorkflowTemplate: (id: string, changes: Partial<WorkflowTemplateDraft>) => void;
  readonly setWorkflowTemplateActive: (id: string, isActive: boolean) => void;
  readonly addWorkflowStep: (templateId: string, input: NewWorkflowStepInput) => void;
  readonly removeWorkflowStep: (templateId: string, stepId: string) => void;
  readonly updateWorkflowStep: (templateId: string, stepId: string, changes: Partial<NewWorkflowStepInput>) => void;
  readonly reorderWorkflowSteps: (templateId: string, orderedStepIds: readonly string[]) => void;
}

const ContentOsStoreContext = createContext<ContentOsStoreValue | null>(null);

export function ContentOsStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer((current: ContentOsState, action: ContentOsAction) => contentOsReducer(current, action), undefined, initialContentOsState);

  const createTaskType = useCallback((draft: TaskTypeDraft) => {
    const created = buildTaskType(draft);
    dispatch({ type: "ADD_TASK_TYPE", taskType: created });
    return created;
  }, []);
  const reviseTaskType = useCallback((id: string, changes: Partial<TaskTypeDraft>) => dispatch({ type: "REVISE_TASK_TYPE", id, changes }), []);
  const duplicateTaskType = useCallback(
    (id: string) => {
      const source = state.taskTypes.find((taskType) => taskType.id === id);
      if (!source) return null;
      const copy = buildDuplicateTaskType(source);
      dispatch({ type: "ADD_TASK_TYPE", taskType: copy });
      return copy;
    },
    [state.taskTypes],
  );
  const setTaskTypeActive = useCallback((id: string, isActive: boolean) => dispatch({ type: "SET_TASK_TYPE_ACTIVE", id, isActive }), []);
  const createWorkflowTemplate = useCallback((draft: WorkflowTemplateDraft) => {
    const created = buildWorkflowTemplate(draft);
    dispatch({ type: "ADD_WORKFLOW_TEMPLATE", template: created });
    return created;
  }, []);
  const reviseWorkflowTemplate = useCallback((id: string, changes: Partial<WorkflowTemplateDraft>) => dispatch({ type: "REVISE_WORKFLOW_TEMPLATE", id, changes }), []);
  const setWorkflowTemplateActive = useCallback((id: string, isActive: boolean) => dispatch({ type: "SET_WORKFLOW_TEMPLATE_ACTIVE", id, isActive }), []);
  const addWorkflowStep = useCallback((templateId: string, input: NewWorkflowStepInput) => dispatch({ type: "ADD_WORKFLOW_STEP", templateId, input }), []);
  const removeWorkflowStep = useCallback((templateId: string, stepId: string) => dispatch({ type: "REMOVE_WORKFLOW_STEP", templateId, stepId }), []);
  const updateWorkflowStep = useCallback((templateId: string, stepId: string, changes: Partial<NewWorkflowStepInput>) => dispatch({ type: "UPDATE_WORKFLOW_STEP", templateId, stepId, changes }), []);
  const reorderWorkflowSteps = useCallback((templateId: string, orderedStepIds: readonly string[]) => dispatch({ type: "REORDER_WORKFLOW_STEPS", templateId, orderedStepIds }), []);

  const value = useMemo<ContentOsStoreValue>(
    () => ({
      state,
      createTaskType,
      reviseTaskType,
      duplicateTaskType,
      setTaskTypeActive,
      createWorkflowTemplate,
      reviseWorkflowTemplate,
      setWorkflowTemplateActive,
      addWorkflowStep,
      removeWorkflowStep,
      updateWorkflowStep,
      reorderWorkflowSteps,
    }),
    [state, createTaskType, reviseTaskType, duplicateTaskType, setTaskTypeActive, createWorkflowTemplate, reviseWorkflowTemplate, setWorkflowTemplateActive, addWorkflowStep, removeWorkflowStep, updateWorkflowStep, reorderWorkflowSteps],
  );

  return <ContentOsStoreContext.Provider value={value}>{children}</ContentOsStoreContext.Provider>;
}

export function useContentOsStore(): ContentOsStoreValue {
  const value = useContext(ContentOsStoreContext);
  if (!value) throw new Error("useContentOsStore must be used within a ContentOsStoreProvider");
  return value;
}
