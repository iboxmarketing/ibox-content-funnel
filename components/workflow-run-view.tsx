"use client";

/**
 * Workflow Run / Task Runtime (V1 Sprint 2, extended Sprint 3 for
 * multiplicity + content entities). "Start workflow" creates the
 * dependency-free root step(s) directly (there is no source task to
 * preview from yet); every later task is created only through
 * Complete -> Generated Preview -> Confirm, which may now create several
 * TaskInstances of the same WorkflowStep plus the content entities they
 * operate on (ProblemPart / KnowledgeNode / Blog). Still local/session
 * only -- nothing here calls TaskClient.create() or Supabase.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Play, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContentOsStore } from "@/components/content-os-store-provider";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import { useContentEntityStore } from "@/components/content-entity-store-provider";
import { TaskDetail } from "@/components/task-detail";
import { GeneratedTaskPreview } from "@/components/generated-task-preview";
import { buildTaskInstanceSeed, getStartableSteps } from "@/lib/workflow-runtime";
import { confirmPreviewPlan, outcomeToEntityActions, type CandidateSelectionState, type PreviewPlan } from "@/lib/content-workflow";
import { decideTaskReview, requestTaskCompletion, type CompletionDecision, type ReviewDecision } from "@/lib/task-completion";
import { resolveRuntimeHandler, type TaskRuntimeContext } from "@/lib/task-runtime-handlers";
import { ref } from "@/lib/content-entity";
import { labelForRef, type ContentEntityState } from "@/lib/content-entity-store";
import { entityTypeLabelUz } from "@/lib/content-workflow";
import type { TaskInstance } from "@/lib/task-instance";

const STATUS_BADGE_CLASS: Record<string, string> = {
  DONE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-slate-300 bg-slate-100 text-slate-500",
};

/** What a task works on, shown in the list so fanned-out tasks of the same
 * step (identical titles) stay distinguishable (Sprint 7 pilot fix). */
function workingOnLabel(content: ContentEntityState, instance: TaskInstance): string | null {
  if (instance.contentRef) {
    const name = labelForRef(content, instance.contentRef);
    return name ? `${entityTypeLabelUz(instance.contentRef.entityType)}: ${name}` : null;
  }
  const related = instance.relatedEntityRefs ?? [];
  const names = related.map((r) => labelForRef(content, r)).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

function TaskRow({ instance, typeName, workingOn, onOpen }: { instance: TaskInstance; typeName: string; workingOn: string | null; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-200">
      {instance.status === "DONE" && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-950">{instance.title}</p>
        <p className="truncate text-[11px] text-slate-500">{typeName}{workingOn ? ` · ${workingOn}` : ""}</p>
      </div>
      <Badge variant="outline" className={STATUS_BADGE_CLASS[instance.status] ?? "border-blue-200 bg-blue-50 text-blue-700"}>{instance.status}{instance.outcome === "SKIPPED" ? " · SKIPPED" : ""}</Badge>
    </button>
  );
}

export function WorkflowRunView() {
  const { state: contentOsState } = useContentOsStore();
  const { state: runtimeState, createInstances, complete, submitForReview, approveReview, requestRevision } = useTaskRuntimeStore();
  const contentEntityStore = useContentEntityStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(contentOsState.workflowTemplates[0]?.id ?? null);
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PreviewPlan | null>(null);
  const [startCategoryId, setStartCategoryId] = useState<string>("");

  const taskTypesById = useMemo(() => new Map(contentOsState.taskTypes.map((t) => [t.id, t])), [contentOsState.taskTypes]);
  const template = contentOsState.workflowTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const instancesForTemplate = useMemo(
    () => runtimeState.instances.filter((instance) => instance.workflowTemplateId === selectedTemplateId),
    [runtimeState.instances, selectedTemplateId],
  );

  // Tasks outside any WorkflowTemplate (Material production, Shoot, Destination creation).
  const standaloneInstances = useMemo(() => runtimeState.instances.filter((instance) => !instance.workflowTemplateId), [runtimeState.instances]);
  const startableSteps = template ? getStartableSteps(template, instancesForTemplate) : [];
  const hasStarted = instancesForTemplate.length > 0;
  // A root step whose handler declares `startsOn` needs the employee to
  // pick that entity explicitly before the workflow starts.
  const needsCategory = startableSteps.some((step) => {
    const taskType = taskTypesById.get(step.taskTypeId);
    return taskType ? resolveRuntimeHandler(taskType.name).startsOn === "PROBLEM_CATEGORY" : false;
  });
  const chosenCategoryId = startCategoryId || contentEntityStore.state.problemCategories[0]?.id || "";

  function startWorkflow() {
    if (!template) return;
    const drafts = startableSteps.flatMap((step) => {
      const taskType = taskTypesById.get(step.taskTypeId);
      if (!taskType) return [];
      const contentRef = resolveRuntimeHandler(taskType.name).startsOn === "PROBLEM_CATEGORY" && chosenCategoryId ? ref("PROBLEM_CATEGORY", chosenCategoryId) : null;
      return [buildTaskInstanceSeed(step, taskType, null, contentRef)];
    });
    if (!drafts.length) return;
    const created = createInstances(drafts);
    setOpenInstanceId(created[0]?.id ?? null);
  }

  function contextFor(instance: TaskInstance): TaskRuntimeContext | null {
    const taskType = taskTypesById.get(instance.taskTypeId);
    if (!taskType) return null;
    return {
      instance,
      taskType,
      template: instance.workflowTemplateId ? contentOsState.workflowTemplates.find((t) => t.id === instance.workflowTemplateId) ?? null : null,
      allInstances: runtimeState.instances,
      taskTypesById,
      content: contentEntityStore.state,
    };
  }

  /** Applies a CompletionDecision from the single completion entry point
   * (lib/task-completion.ts). This view never inspects a Task Type name or
   * decides business completion semantics: it only carries the decision
   * out -- status transition, entity mutations, new tasks, preview. */
  function applyCompletionDecision(instance: TaskInstance, decision: CompletionDecision) {
    switch (decision.kind) {
      case "BLOCKED":
        return; // Task Detail already shows the blocking reasons
      case "SUBMITTED_FOR_REVIEW":
        contentEntityStore.applyActions(decision.entityActions);
        submitForReview(instance.id);
        return;
      case "REVISION_REQUESTED":
        return; // handled with its note in handleReviewDecision
      case "COMPLETED": {
        const { result } = decision;
        contentEntityStore.applyActions(result.entityActions);
        const created = result.taskDrafts.length ? createInstances(result.taskDrafts) : [];
        if (result.completeNow) complete(instance.id);
        if (result.plan) {
          setPendingPlan(result.plan);
          return;
        }
        setOpenInstanceId(created[0]?.id ?? null);
      }
    }
  }

  function handleRequestComplete(instance: TaskInstance) {
    const context = contextFor(instance);
    if (!context) {
      complete(instance.id);
      setOpenInstanceId(null);
      return;
    }
    applyCompletionDecision(instance, requestTaskCompletion(context));
  }

  function handleReviewDecision(instance: TaskInstance, reviewDecision: ReviewDecision, note: string) {
    const context = contextFor(instance);
    if (!context) return;
    const decision = decideTaskReview(context, reviewDecision);
    if (decision.kind === "REVISION_REQUESTED") {
      requestRevision(instance.id, note);
      return;
    }
    if (decision.kind === "COMPLETED") approveReview(instance.id, note);
    applyCompletionDecision(instance, decision);
  }

  function handlePreviewConfirm(selections: readonly CandidateSelectionState[]) {
    if (!pendingPlan) return;
    const outcome = confirmPreviewPlan(pendingPlan, selections);
    contentEntityStore.applyActions(outcomeToEntityActions(outcome));
    const created = createInstances(outcome.taskDrafts);
    complete(pendingPlan.sourceInstance.id);
    setPendingPlan(null);
    setOpenInstanceId(created[0]?.id ?? pendingPlan.sourceInstance.id);
  }

  if (openInstanceId) {
    return (
      <>
        <TaskDetail instanceId={openInstanceId} onClose={() => setOpenInstanceId(null)} onComplete={handleRequestComplete} onReviewDecision={handleReviewDecision} onOpenInstance={setOpenInstanceId} />
        {pendingPlan && <GeneratedTaskPreview plan={pendingPlan} onCancel={() => setPendingPlan(null)} onConfirm={handlePreviewConfirm} />}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Workflow Run</h1><p className="text-[11px] text-slate-500">Konfiguratsiyalangan workflow’ni lokal ravishda ishga tushirish</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-900 lg:px-5"><ShieldCheck className="size-3.5" /> Sessiya-only runtime · real task backendga yozilmaydi.</div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:border-b-0 lg:border-r">
          <div className="space-y-2">
            {contentOsState.workflowTemplates.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedTemplateId(item.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedTemplateId === item.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                <strong className="truncate text-sm font-semibold text-slate-950">{item.name}</strong>
                <p className="mt-1 text-[11px] text-slate-500">{item.steps.length} step · {item.moduleType}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 lg:p-6">
          {template ? (
            <div className="mx-auto max-w-2xl space-y-4">
              {!hasStarted ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="text-sm text-slate-500">Hali boshlanmagan. Boshlanganda, bog’liqlik bo’lmagan birinchi step(lar) uchun task yaratiladi.</p>
                  {needsCategory && (
                    <label className="mx-auto mt-4 block max-w-xs text-left text-[11px] font-semibold text-slate-600">Problem Category
                      <select value={chosenCategoryId} onChange={(e) => setStartCategoryId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                        {contentEntityStore.state.problemCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                    </label>
                  )}
                  <Button type="button" className="mt-4 rounded-xl bg-blue-700 hover:bg-blue-800" disabled={!startableSteps.length || (needsCategory && !chosenCategoryId)} onClick={startWorkflow}><Play className="size-4" /> Workflow’ni boshlash</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><ListTodo className="size-4 text-blue-700" /> Tasklar ({instancesForTemplate.length})</h3>
                  {instancesForTemplate.map((instance) => (
                    <TaskRow key={instance.id} instance={instance} typeName={taskTypesById.get(instance.taskTypeId)?.name ?? instance.taskTypeId} workingOn={workingOnLabel(contentEntityStore.state, instance)} onOpen={() => setOpenInstanceId(instance.id)} />
                  ))}
                </div>
              )}
              {standaloneInstances.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><ListTodo className="size-4 text-blue-700" /> Material va boshqa tasklar ({standaloneInstances.length})</h3>
                  {standaloneInstances.map((instance) => (
                    <TaskRow key={instance.id} instance={instance} typeName={taskTypesById.get(instance.taskTypeId)?.name ?? instance.taskTypeId} workingOn={workingOnLabel(contentEntityStore.state, instance)} onOpen={() => setOpenInstanceId(instance.id)} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Workflow tanlang.</div>
          )}
        </main>
      </div>
    </div>
  );
}
