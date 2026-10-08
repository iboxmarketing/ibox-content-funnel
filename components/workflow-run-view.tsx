"use client";

/**
 * Workflow Run / Task Runtime (V1 Sprint 2): the local view that actually
 * runs a configured WorkflowTemplate. "Start workflow" creates the
 * dependency-free root step(s) directly (there is no source task to
 * preview from yet); every later step is created only through
 * Complete -> Generated Task Preview -> Confirm. Still local/session only
 * -- nothing here calls TaskClient.create() or Supabase.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Play, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContentOsStore } from "@/components/content-os-store-provider";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import { TaskDetail } from "@/components/task-detail";
import { GeneratedTaskPreview } from "@/components/generated-task-preview";
import {
  buildTaskInstanceSeed,
  getImmediateNextStepsAfterSettlement,
  getStartableSteps,
} from "@/lib/workflow-runtime";
import type { TaskInstance, TaskInstanceDraft } from "@/lib/task-instance";
import type { WorkflowStep } from "@/lib/workflow-template";

interface PendingPreview {
  readonly sourceInstance: TaskInstance;
  readonly sourceTaskTypeId: string;
  readonly steps: readonly WorkflowStep[];
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  DONE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-slate-300 bg-slate-100 text-slate-500",
};

export function WorkflowRunView() {
  const { state: contentOsState } = useContentOsStore();
  const { state: runtimeState, createInstances, complete } = useTaskRuntimeStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(contentOsState.workflowTemplates[0]?.id ?? null);
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);

  const taskTypesById = useMemo(() => new Map(contentOsState.taskTypes.map((t) => [t.id, t])), [contentOsState.taskTypes]);
  const template = contentOsState.workflowTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const instancesForTemplate = useMemo(
    () => runtimeState.instances.filter((instance) => instance.workflowTemplateId === selectedTemplateId),
    [runtimeState.instances, selectedTemplateId],
  );

  const startableSteps = template ? getStartableSteps(template, instancesForTemplate) : [];
  const hasStarted = instancesForTemplate.length > 0;

  function startWorkflow() {
    if (!template) return;
    const drafts: TaskInstanceDraft[] = startableSteps.flatMap((step) => {
      const taskType = taskTypesById.get(step.taskTypeId);
      if (!taskType) return [];
      return [buildTaskInstanceSeed(step, taskType, null)];
    });
    if (!drafts.length) return;
    const created = createInstances(drafts);
    setOpenInstanceId(created[0]?.id ?? null);
  }

  function handleRequestComplete(instance: TaskInstance) {
    const instanceTemplate = instance.workflowTemplateId ? contentOsState.workflowTemplates.find((t) => t.id === instance.workflowTemplateId) ?? null : null;
    if (!instanceTemplate || !instance.workflowStepId) {
      complete(instance.id);
      setOpenInstanceId(null);
      return;
    }
    const simulatedSettled = [
      ...runtimeState.instances.filter((item) => item.id !== instance.id),
      { ...instance, status: "DONE" as const, outcome: "COMPLETED" as const },
    ];
    const nextSteps = getImmediateNextStepsAfterSettlement(instanceTemplate, simulatedSettled, instance.workflowStepId);
    if (!nextSteps.length) {
      complete(instance.id);
      setOpenInstanceId(null);
      return;
    }
    setPendingPreview({ sourceInstance: instance, sourceTaskTypeId: instance.taskTypeId, steps: nextSteps });
  }

  function handlePreviewConfirm(drafts: readonly TaskInstanceDraft[]) {
    if (!pendingPreview) return;
    const created = createInstances(drafts);
    complete(pendingPreview.sourceInstance.id);
    setPendingPreview(null);
    setOpenInstanceId(created[0]?.id ?? pendingPreview.sourceInstance.id);
  }

  if (openInstanceId) {
    return (
      <>
        <TaskDetail instanceId={openInstanceId} onClose={() => setOpenInstanceId(null)} onComplete={handleRequestComplete} onOpenInstance={setOpenInstanceId} />
        {pendingPreview && (
          <GeneratedTaskPreview
            sourceInstance={pendingPreview.sourceInstance}
            sourceTaskType={taskTypesById.get(pendingPreview.sourceTaskTypeId)!}
            steps={pendingPreview.steps}
            taskTypesById={taskTypesById}
            onCancel={() => setPendingPreview(null)}
            onConfirm={handlePreviewConfirm}
          />
        )}
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
                  <Button type="button" className="mt-4 rounded-xl bg-blue-700 hover:bg-blue-800" disabled={!startableSteps.length} onClick={startWorkflow}><Play className="size-4" /> Workflow’ni boshlash</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><ListTodo className="size-4 text-blue-700" /> Tasklar ({instancesForTemplate.length})</h3>
                  {instancesForTemplate.map((instance) => {
                    const taskType = taskTypesById.get(instance.taskTypeId);
                    return (
                      <button key={instance.id} type="button" onClick={() => setOpenInstanceId(instance.id)} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-200">
                        {instance.status === "DONE" && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-950">{instance.title}</p>
                          <p className="text-[11px] text-slate-500">{taskType?.name ?? instance.taskTypeId}</p>
                        </div>
                        <Badge variant="outline" className={STATUS_BADGE_CLASS[instance.status] ?? "border-blue-200 bg-blue-50 text-blue-700"}>{instance.status}{instance.outcome === "SKIPPED" ? " · SKIPPED" : ""}</Badge>
                      </button>
                    );
                  })}
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
