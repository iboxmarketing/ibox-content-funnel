/**
 * Shared configuration store (V1 Sprint 2): one reducer-shaped source of
 * truth for Task Types + Workflow Templates, replacing Sprint 1's two
 * independent per-component `useState(fixtures)` copies. This fixes the
 * Sprint 1 risk explicitly called out for Sprint 2: a Task Type edit must
 * be immediately visible to the Workflow Builder, and the builder must
 * always read the latest Task Type configuration.
 *
 * Pure and framework-free on purpose -- `components/content-os-store-provider.tsx`
 * is the thin React (`useReducer`) wrapper around this. Still
 * local/session-only: `initialContentOsState()` seeds from the Sprint 1
 * fixtures and nothing here persists beyond the page session.
 */
import {
  reviseTaskType,
  setTaskTypeActive,
  type TaskType,
  type TaskTypeDraft,
} from "./task-type";
import { TASK_TYPE_FIXTURES } from "./task-type-fixtures";
import {
  addStep,
  removeStep,
  reorderSteps,
  reviseWorkflowTemplate,
  setWorkflowTemplateActive,
  updateStep,
  type NewWorkflowStepInput,
  type WorkflowTemplate,
  type WorkflowTemplateDraft,
} from "./workflow-template";
import { WORKFLOW_TEMPLATE_FIXTURES } from "./workflow-template-fixtures";

export interface ContentOsState {
  readonly taskTypes: readonly TaskType[];
  readonly workflowTemplates: readonly WorkflowTemplate[];
}

export function initialContentOsState(): ContentOsState {
  return {
    taskTypes: structuredClone(TASK_TYPE_FIXTURES) as TaskType[],
    workflowTemplates: structuredClone(WORKFLOW_TEMPLATE_FIXTURES) as WorkflowTemplate[],
  };
}

export type ContentOsAction =
  /** Carries an already-built TaskType (from createTaskType/duplicateTaskType
   * in lib/task-type.ts) rather than a draft, so the caller knows the new
   * id synchronously -- e.g. to select it in the UI right after creating
   * it, without waiting on a render to read it back out of state. */
  | { readonly type: "ADD_TASK_TYPE"; readonly taskType: TaskType }
  | { readonly type: "REVISE_TASK_TYPE"; readonly id: string; readonly changes: Partial<TaskTypeDraft> }
  | { readonly type: "SET_TASK_TYPE_ACTIVE"; readonly id: string; readonly isActive: boolean }
  /** Same reasoning as ADD_TASK_TYPE: carries an already-built WorkflowTemplate. */
  | { readonly type: "ADD_WORKFLOW_TEMPLATE"; readonly template: WorkflowTemplate }
  | { readonly type: "REVISE_WORKFLOW_TEMPLATE"; readonly id: string; readonly changes: Partial<WorkflowTemplateDraft> }
  | { readonly type: "SET_WORKFLOW_TEMPLATE_ACTIVE"; readonly id: string; readonly isActive: boolean }
  | { readonly type: "ADD_WORKFLOW_STEP"; readonly templateId: string; readonly input: NewWorkflowStepInput }
  | { readonly type: "REMOVE_WORKFLOW_STEP"; readonly templateId: string; readonly stepId: string }
  | { readonly type: "UPDATE_WORKFLOW_STEP"; readonly templateId: string; readonly stepId: string; readonly changes: Partial<NewWorkflowStepInput> }
  | { readonly type: "REORDER_WORKFLOW_STEPS"; readonly templateId: string; readonly orderedStepIds: readonly string[] };

function withTemplate(state: ContentOsState, templateId: string, update: (template: WorkflowTemplate) => WorkflowTemplate): ContentOsState {
  return {
    ...state,
    workflowTemplates: state.workflowTemplates.map((template) => (template.id === templateId ? update(template) : template)),
  };
}

/** Pure. Never mutates `state`; always returns a new state (or the same
 * reference when an action targets an id that no longer exists). */
export function contentOsReducer(state: ContentOsState, action: ContentOsAction, now: () => string = () => new Date().toISOString()): ContentOsState {
  switch (action.type) {
    case "ADD_TASK_TYPE": {
      return { ...state, taskTypes: [...state.taskTypes, action.taskType] };
    }
    case "REVISE_TASK_TYPE": {
      const current = state.taskTypes.find((taskType) => taskType.id === action.id);
      if (!current) return state;
      const revised = reviseTaskType(current, action.changes, now);
      return { ...state, taskTypes: state.taskTypes.map((taskType) => (taskType.id === action.id ? revised : taskType)) };
    }
    case "SET_TASK_TYPE_ACTIVE": {
      const current = state.taskTypes.find((taskType) => taskType.id === action.id);
      if (!current) return state;
      const next = setTaskTypeActive(current, action.isActive, now);
      return { ...state, taskTypes: state.taskTypes.map((taskType) => (taskType.id === action.id ? next : taskType)) };
    }
    case "ADD_WORKFLOW_TEMPLATE": {
      return { ...state, workflowTemplates: [...state.workflowTemplates, action.template] };
    }
    case "REVISE_WORKFLOW_TEMPLATE": {
      const current = state.workflowTemplates.find((template) => template.id === action.id);
      if (!current) return state;
      return withTemplate(state, action.id, () => reviseWorkflowTemplate(current, action.changes, now));
    }
    case "SET_WORKFLOW_TEMPLATE_ACTIVE": {
      const current = state.workflowTemplates.find((template) => template.id === action.id);
      if (!current) return state;
      return withTemplate(state, action.id, () => setWorkflowTemplateActive(current, action.isActive, now));
    }
    case "ADD_WORKFLOW_STEP": {
      if (!state.workflowTemplates.some((template) => template.id === action.templateId)) return state;
      return withTemplate(state, action.templateId, (template) => addStep(template, action.input, now));
    }
    case "REMOVE_WORKFLOW_STEP": {
      if (!state.workflowTemplates.some((template) => template.id === action.templateId)) return state;
      return withTemplate(state, action.templateId, (template) => removeStep(template, action.stepId, now));
    }
    case "UPDATE_WORKFLOW_STEP": {
      if (!state.workflowTemplates.some((template) => template.id === action.templateId)) return state;
      return withTemplate(state, action.templateId, (template) => updateStep(template, action.stepId, action.changes, now));
    }
    case "REORDER_WORKFLOW_STEPS": {
      if (!state.workflowTemplates.some((template) => template.id === action.templateId)) return state;
      return withTemplate(state, action.templateId, (template) => reorderSteps(template, action.orderedStepIds, now));
    }
    default:
      return state;
  }
}

export function activeTaskTypes(state: ContentOsState): readonly TaskType[] {
  return state.taskTypes.filter((taskType) => taskType.isActive);
}

export function taskTypeById(state: ContentOsState, id: string): TaskType | undefined {
  return state.taskTypes.find((taskType) => taskType.id === id);
}

export function workflowTemplateById(state: ContentOsState, id: string): WorkflowTemplate | undefined {
  return state.workflowTemplates.find((template) => template.id === id);
}
