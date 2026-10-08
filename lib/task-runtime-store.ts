/**
 * Local Task Runtime store (V1 Sprint 2): the session-only reducer holding
 * every TaskInstance created so far plus any "suggest as template
 * improvement" notes. Mirrors content-os-store.ts's shape: pure state +
 * actions here, a thin `useReducer` React wrapper in
 * components/task-runtime-store-provider.tsx. No persistence, no
 * TaskClient, no Supabase.
 */
import {
  addAtomicIdeaDraft,
  addCustomFieldToInstance,
  createTemplateImprovementSuggestion,
  editTransferredFieldValue,
  markTaskInstanceDone,
  removeAtomicIdeaDraft,
  removeCustomFieldFromInstance,
  setTaskInstanceFieldValue,
  setTaskInstanceStatus,
  skipTaskInstance,
  updateAtomicIdeaDraft,
  type AtomicIdeaDraft,
  type FieldValue,
  type TaskInstance,
  type TaskInstanceStatus,
  type TemplateImprovementSuggestion,
} from "./task-instance";
import { addLink, removeLink, updateLink, type TaskLinkDraft } from "./task-link";
import type { FieldDefinition } from "./task-type";

export interface TaskRuntimeState {
  readonly instances: readonly TaskInstance[];
  readonly suggestions: readonly TemplateImprovementSuggestion[];
}

export function initialTaskRuntimeState(): TaskRuntimeState {
  return { instances: [], suggestions: [] };
}

export type TaskRuntimeAction =
  /** Carries already-built TaskInstance entities (from createTaskInstance
   * in lib/task-instance.ts), same reasoning as content-os-store.ts's
   * ADD_TASK_TYPE: the caller needs the new ids synchronously, e.g. to
   * navigate straight to the first newly-generated task after Confirm. */
  | { readonly type: "ADD_INSTANCES"; readonly instances: readonly TaskInstance[] }
  | { readonly type: "SET_STATUS"; readonly instanceId: string; readonly status: TaskInstanceStatus }
  | { readonly type: "SET_FIELD_VALUE"; readonly instanceId: string; readonly fieldId: string; readonly value: FieldValue }
  | { readonly type: "EDIT_TRANSFERRED_FIELD_VALUE"; readonly instanceId: string; readonly fieldId: string; readonly value: FieldValue; readonly alsoUpdateSourceTaskId?: string; readonly sourceFieldId?: string }
  | { readonly type: "ADD_CUSTOM_FIELD"; readonly instanceId: string; readonly field: FieldDefinition }
  | { readonly type: "REMOVE_CUSTOM_FIELD"; readonly instanceId: string; readonly fieldId: string }
  | { readonly type: "ADD_ATOMIC_IDEA_DRAFT"; readonly instanceId: string; readonly draft: AtomicIdeaDraft }
  | { readonly type: "UPDATE_ATOMIC_IDEA_DRAFT"; readonly instanceId: string; readonly draftId: string; readonly changes: Partial<Omit<AtomicIdeaDraft, "id">> }
  | { readonly type: "REMOVE_ATOMIC_IDEA_DRAFT"; readonly instanceId: string; readonly draftId: string }
  | { readonly type: "ADD_LINK"; readonly instanceId: string; readonly draft: TaskLinkDraft }
  | { readonly type: "UPDATE_LINK"; readonly instanceId: string; readonly linkId: string; readonly changes: Partial<TaskLinkDraft> }
  | { readonly type: "REMOVE_LINK"; readonly instanceId: string; readonly linkId: string }
  | { readonly type: "COMPLETE"; readonly instanceId: string }
  | { readonly type: "SKIP"; readonly instanceId: string; readonly reason: string }
  | { readonly type: "ADD_SUGGESTION"; readonly taskInstanceId: string; readonly taskTypeId: string; readonly field: FieldDefinition; readonly note: string };

function withInstance(state: TaskRuntimeState, instanceId: string, update: (instance: TaskInstance) => TaskInstance): TaskRuntimeState {
  return { ...state, instances: state.instances.map((instance) => (instance.id === instanceId ? update(instance) : instance)) };
}

/** Pure. Never mutates `state`. */
export function taskRuntimeReducer(state: TaskRuntimeState, action: TaskRuntimeAction, now: () => string = () => new Date().toISOString()): TaskRuntimeState {
  switch (action.type) {
    case "ADD_INSTANCES": {
      return { ...state, instances: [...state.instances, ...action.instances] };
    }
    case "SET_STATUS": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => setTaskInstanceStatus(instance, action.status, now));
    }
    case "SET_FIELD_VALUE": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => setTaskInstanceFieldValue(instance, action.fieldId, action.value, now));
    }
    case "EDIT_TRANSFERRED_FIELD_VALUE": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      let next = withInstance(state, action.instanceId, (instance) => editTransferredFieldValue(instance, action.fieldId, action.value, now));
      if (action.alsoUpdateSourceTaskId && action.sourceFieldId && next.instances.some((instance) => instance.id === action.alsoUpdateSourceTaskId)) {
        next = withInstance(next, action.alsoUpdateSourceTaskId, (instance) => setTaskInstanceFieldValue(instance, action.sourceFieldId as string, action.value, now));
      }
      return next;
    }
    case "ADD_CUSTOM_FIELD": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => addCustomFieldToInstance(instance, action.field, now));
    }
    case "REMOVE_CUSTOM_FIELD": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => removeCustomFieldFromInstance(instance, action.fieldId, now));
    }
    case "ADD_ATOMIC_IDEA_DRAFT": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => addAtomicIdeaDraft(instance, action.draft, now));
    }
    case "UPDATE_ATOMIC_IDEA_DRAFT": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => updateAtomicIdeaDraft(instance, action.draftId, action.changes, now));
    }
    case "REMOVE_ATOMIC_IDEA_DRAFT": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => removeAtomicIdeaDraft(instance, action.draftId, now));
    }
    case "ADD_LINK": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => ({ ...instance, links: addLink(instance.links, action.draft, now), updatedAt: now() }));
    }
    case "UPDATE_LINK": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => ({ ...instance, links: updateLink(instance.links, action.linkId, action.changes), updatedAt: now() }));
    }
    case "REMOVE_LINK": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => ({ ...instance, links: removeLink(instance.links, action.linkId), updatedAt: now() }));
    }
    case "COMPLETE": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => markTaskInstanceDone(instance, now));
    }
    case "SKIP": {
      if (!state.instances.some((instance) => instance.id === action.instanceId)) return state;
      return withInstance(state, action.instanceId, (instance) => skipTaskInstance(instance, action.reason, now));
    }
    case "ADD_SUGGESTION": {
      const suggestion = createTemplateImprovementSuggestion(
        { taskInstanceId: action.taskInstanceId, taskTypeId: action.taskTypeId, field: action.field, note: action.note },
        now,
      );
      return { ...state, suggestions: [...state.suggestions, suggestion] };
    }
    default:
      return state;
  }
}

export function instanceById(state: TaskRuntimeState, id: string): TaskInstance | undefined {
  return state.instances.find((instance) => instance.id === id);
}

export function instancesForTemplate(state: TaskRuntimeState, workflowTemplateId: string): readonly TaskInstance[] {
  return state.instances.filter((instance) => instance.workflowTemplateId === workflowTemplateId);
}
