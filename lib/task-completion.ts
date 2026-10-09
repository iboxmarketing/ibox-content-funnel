/**
 * The single completion entry point (V1 Sprint 6, section 1).
 *
 * Sprint 5 handlers returned outcomes, but the orchestration around them
 * (validation, review, DONE-vs-deferred, preview) was assembled in
 * several UI spots. Everything now flows through here:
 *
 *   requestTaskCompletion(ctx)      employee presses Complete / Submit
 *   decideTaskReview(ctx, decision) reviewer approves / requests revision
 *
 * Both are pure: they return a `CompletionDecision` for the caller to
 * apply (status transition, entity mutations, new tasks, preview). They
 * coordinate, in order:
 *   1. standard field validation (+ effective step overrides),
 *   2. the Task Type's custom handler validation,
 *   3. the review requirement (`reviewRequired`, step override aware),
 *   4. the handler's completion outcome (entity mutations, task drafts,
 *      optional Generated Preview, immediate-vs-deferred DONE).
 * A handler can only contribute (2) and (4) -- it cannot skip (1) or (3).
 *
 * Review uses ONLY the existing statuses: a reviewRequired task goes
 * REVIEW on submit; Request revision moves the SAME task to REVISION;
 * resubmitting returns it to REVIEW; Approve runs the completion outcome.
 * No revision TaskInstance, no APPROVED / PENDING_REVIEW status.
 *
 * Sprint 7.1 -- review by a SEPARATE task (Head Review -> Blog): a handler
 * declaring `reviewsSourceTask` decides on its source task. Choosing the
 * revision value returns SOURCE_REVISION_REQUESTED (source DONE ->
 * REVISION, reviewer -> BLOCKED). Completing the corrected source returns
 * RESUBMITTED_TO_REVIEWER (source -> DONE, the SAME reviewer -> ASSIGNED).
 * Approve is an ordinary completion of the reviewer.
 */
import { validateTaskInstanceForCompletion, type CompletionValidationError } from "./task-instance";
import { effectiveRequiredFields, effectiveReviewRequired } from "./workflow-template";
import type { FieldDefinition } from "./task-type";
import type { ContentEntityAction } from "./content-entity-store";
import {
  resolveRuntimeHandler,
  resubmissionFollowUpPlan,
  runTaskCompletion,
  waitingSourceReviewer,
  runtimeCompletionErrors,
  type TaskRuntimeCompletionResult,
  type TaskRuntimeContext,
} from "./task-runtime-handlers";

export type CompletionAction = "COMPLETE" | "SUBMIT_FOR_REVIEW" | "RESUBMIT" | "AWAITING_REVIEW" | "NONE";

export interface CompletionState {
  readonly errors: readonly CompletionValidationError[];
  readonly action: CompletionAction;
}

export type ReviewDecision = "APPROVE" | "REQUEST_REVISION";

export type CompletionDecision =
  | { readonly kind: "BLOCKED"; readonly errors: readonly CompletionValidationError[] }
  | { readonly kind: "SUBMITTED_FOR_REVIEW"; readonly entityActions: readonly ContentEntityAction[] }
  | { readonly kind: "REVISION_REQUESTED" }
  | { readonly kind: "SOURCE_REVISION_REQUESTED"; readonly sourceTaskId: string; readonly decisionFieldId: string; readonly note: string }
  | { readonly kind: "RESUBMITTED_TO_REVIEWER"; readonly reviewerTaskId: string; readonly decisionFieldId: string; readonly result: TaskRuntimeCompletionResult }
  | { readonly kind: "COMPLETED"; readonly result: TaskRuntimeCompletionResult };

function currentStep(context: TaskRuntimeContext) {
  return context.template && context.instance.workflowStepId ? context.template.steps.find((s) => s.id === context.instance.workflowStepId) ?? null : null;
}

export function effectiveRequiredFieldsFor(context: TaskRuntimeContext): readonly FieldDefinition[] {
  const step = currentStep(context);
  return step ? effectiveRequiredFields(context.taskType.requiredFields, step) : context.taskType.requiredFields;
}

export function isReviewRequiredFor(context: TaskRuntimeContext): boolean {
  const step = currentStep(context);
  return step ? effectiveReviewRequired(context.taskType.reviewRequired, step) : context.taskType.reviewRequired;
}

function allErrors(context: TaskRuntimeContext): CompletionValidationError[] {
  return [...validateTaskInstanceForCompletion(context.instance, effectiveRequiredFieldsFor(context)), ...runtimeCompletionErrors(context)];
}

/** What the UI should show: the current blocking reasons and which
 * completion action the primary button represents. TaskDetail renders
 * this; it does not decide it. */
export function getCompletionState(context: TaskRuntimeContext): CompletionState {
  const { status } = context.instance;
  if (status === "DONE" || status === "CANCELLED") return { errors: [], action: "NONE" };
  if (status === "REVIEW") return { errors: [], action: "AWAITING_REVIEW" };
  const errors = allErrors(context);
  if (isReviewRequiredFor(context)) return { errors, action: status === "REVISION" ? "RESUBMIT" : "SUBMIT_FOR_REVIEW" };
  if (status === "REVISION" && waitingSourceReviewer(context)) return { errors, action: "RESUBMIT" };
  return { errors, action: "COMPLETE" };
}

export function requestTaskCompletion(context: TaskRuntimeContext, now: () => string = () => new Date().toISOString()): CompletionDecision {
  const state = getCompletionState(context);
  if (state.action === "NONE") return { kind: "BLOCKED", errors: [{ code: "MISSING_REQUIRED_FIELD", message: "Task allaqachon yopilgan." }] };
  if (state.action === "AWAITING_REVIEW") return { kind: "BLOCKED", errors: [{ code: "MISSING_REQUIRED_FIELD", message: "Task review kutmoqda — avval Head qaror qiladi." }] };
  if (state.errors.length) return { kind: "BLOCKED", errors: state.errors };
  if (state.action === "SUBMIT_FOR_REVIEW" || state.action === "RESUBMIT") {
    if (!isReviewRequiredFor(context)) {
      const waiting = waitingSourceReviewer(context);
      if (waiting) {
        const result = { entityActions: [], taskDrafts: [], plan: resubmissionFollowUpPlan(context), completeNow: true };
        return { kind: "RESUBMITTED_TO_REVIEWER", reviewerTaskId: waiting.reviewer.id, decisionFieldId: waiting.config.decisionFieldId, result };
      }
    }
    return { kind: "SUBMITTED_FOR_REVIEW", entityActions: resolveRuntimeHandler(context.taskType.name).onSubmitForReview?.(context) ?? [] };
  }
  const sourceReview = resolveRuntimeHandler(context.taskType.name).reviewsSourceTask;
  if (sourceReview && context.instance.sourceTaskId && context.instance.fieldValues[sourceReview.decisionFieldId] === sourceReview.revisionValue) {
    const note = context.instance.fieldValues[sourceReview.noteFieldId];
    return { kind: "SOURCE_REVISION_REQUESTED", sourceTaskId: context.instance.sourceTaskId, decisionFieldId: sourceReview.decisionFieldId, note: typeof note === "string" ? note : "" };
  }
  return { kind: "COMPLETED", result: runTaskCompletion(context, now) };
}

export function decideTaskReview(context: TaskRuntimeContext, decision: ReviewDecision, now: () => string = () => new Date().toISOString()): CompletionDecision {
  if (context.instance.status !== "REVIEW") return { kind: "BLOCKED", errors: [{ code: "MISSING_REQUIRED_FIELD", message: "Faqat REVIEW holatidagi taskni ko'rib chiqish mumkin." }] };
  if (decision === "REQUEST_REVISION") return { kind: "REVISION_REQUESTED" };
  const errors = allErrors(context);
  if (errors.length) return { kind: "BLOCKED", errors };
  return { kind: "COMPLETED", result: runTaskCompletion(context, now) };
}
