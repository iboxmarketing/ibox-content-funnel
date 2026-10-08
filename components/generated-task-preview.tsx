"use client";

/**
 * Generated Task Preview (V1 Sprint 2, sections 9-11): shown after Complete
 * passes validation, before anything is actually created. Only the
 * IMMEDIATE next steps unlocked by the just-completed step are listed --
 * never the rest of the template. Context transfer is opt-in per field,
 * one source field mapped to one destination field at a time; nothing
 * transfers by default. Cancel creates nothing and leaves the source task
 * untouched (still not marked DONE); only Confirm does both at once.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  applyContextTransfer,
  buildTaskInstanceSeed,
  buildTransferCandidates,
  destinationFieldsForTaskType,
  type TaskInstanceSeed,
  type TransferSelection,
} from "@/lib/workflow-runtime";
import type { TaskInstance, TaskInstanceDraft } from "@/lib/task-instance";
import type { TaskType } from "@/lib/task-type";
import type { WorkflowStep } from "@/lib/workflow-template";

interface PreviewItemState {
  readonly step: WorkflowStep;
  readonly taskType: TaskType;
  readonly seed: TaskInstanceSeed;
  readonly included: boolean;
  readonly title: string;
  readonly assignee: string;
  readonly deadline: string;
  readonly selections: readonly TransferSelection[];
}

export function GeneratedTaskPreview({
  sourceInstance,
  sourceTaskType,
  steps,
  taskTypesById,
  onCancel,
  onConfirm,
}: {
  sourceInstance: TaskInstance;
  sourceTaskType: TaskType;
  steps: readonly WorkflowStep[];
  taskTypesById: ReadonlyMap<string, TaskType>;
  onCancel: () => void;
  onConfirm: (drafts: readonly TaskInstanceDraft[]) => void;
}) {
  const transferCandidates = useMemo(() => buildTransferCandidates(sourceInstance, sourceTaskType), [sourceInstance, sourceTaskType]);

  const [items, setItems] = useState<readonly PreviewItemState[]>(() =>
    steps.flatMap((step) => {
      const taskType = taskTypesById.get(step.taskTypeId);
      if (!taskType) return [];
      const seed = buildTaskInstanceSeed(step, taskType, sourceInstance.id);
      return [{ step, taskType, seed, included: true, title: seed.title, assignee: seed.assignee ?? "", deadline: "", selections: [] }];
    }),
  );

  function updateItem(stepId: string, changes: Partial<PreviewItemState>) {
    setItems((current) => current.map((item) => (item.step.id === stepId ? { ...item, ...changes } : item)));
  }

  function handleConfirm() {
    const drafts: TaskInstanceDraft[] = items
      .filter((item) => item.included)
      .map((item) => {
        const { fieldValues, fieldProvenance } = applyContextTransfer(item.seed, sourceInstance, item.selections);
        return {
          ...item.seed,
          title: item.title.trim() || item.seed.title,
          assignee: item.assignee.trim() || null,
          deadline: item.deadline || null,
          fieldValues,
          fieldProvenance,
        };
      });
    onConfirm(drafts);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generated Task Preview</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">
          &ldquo;{sourceInstance.title}&rdquo; bajarildi deb belgilanadi. Quyidagi darhol eligible bo&apos;lgan keyingi qadamlarni ko&apos;rib chiqing, kerak bo&apos;lsa tahrirlang, so&apos;ng Confirm bosing. Faqat tanlanganlar yaratiladi.
        </p>
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.step.id} className={`rounded-xl border p-3 transition ${item.included ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-blue-700" checked={item.included} onChange={(e) => updateItem(item.step.id, { included: e.target.checked })} />
                <strong className="text-sm text-slate-950">{item.taskType.name}</strong>
                <Badge variant="outline" className="ml-auto text-[10px]">{item.step.blocking ? "blocking" : "non-blocking"}</Badge>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="text-[11px] font-semibold text-slate-600">Title<Input value={item.title} onChange={(e) => updateItem(item.step.id, { title: e.target.value })} className="mt-1 h-8 text-xs" disabled={!item.included} /></label>
                <label className="text-[11px] font-semibold text-slate-600">Assignee<Input value={item.assignee} onChange={(e) => updateItem(item.step.id, { assignee: e.target.value })} className="mt-1 h-8 text-xs" disabled={!item.included} placeholder="Tanlanmagan" /></label>
                <label className="text-[11px] font-semibold text-slate-600">Deadline<Input type="date" value={item.deadline} onChange={(e) => updateItem(item.step.id, { deadline: e.target.value })} className="mt-1 h-8 text-xs" disabled={!item.included} /></label>
              </div>

              {item.included && transferCandidates.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-[.05em] text-slate-500">Context transfer (&ldquo;{sourceInstance.title}&rdquo;dan)</p>
                  {transferCandidates.map((candidate) => {
                    const selection = item.selections.find((s) => s.sourceFieldId === candidate.sourceFieldId);
                    const destinationFields = destinationFieldsForTaskType(item.taskType);
                    return (
                      <div key={candidate.sourceFieldId} className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-blue-700"
                          checked={Boolean(selection)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const firstTarget = destinationFields[0];
                              updateItem(item.step.id, { selections: [...item.selections, { sourceFieldId: candidate.sourceFieldId, destinationFieldId: firstTarget?.id ?? "" }] });
                            } else {
                              updateItem(item.step.id, { selections: item.selections.filter((s) => s.sourceFieldId !== candidate.sourceFieldId) });
                            }
                          }}
                        />
                        <span className="font-medium text-slate-700">{candidate.label}:</span>
                        <span className="max-w-[160px] truncate text-slate-500">{String(candidate.value)}</span>
                        {selection && destinationFields.length > 0 && (
                          <>
                            <span className="text-slate-400">→</span>
                            <select
                              value={selection.destinationFieldId}
                              onChange={(e) => updateItem(item.step.id, { selections: item.selections.map((s) => (s.sourceFieldId === candidate.sourceFieldId ? { ...s, destinationFieldId: e.target.value } : s)) })}
                              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
                            >
                              {destinationFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                            </select>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {!items.length && <p className="text-sm text-slate-400">Hozircha keyingi qadam yo&apos;q.</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Bekor qilish</Button>
          <Button type="button" className="bg-blue-700 hover:bg-blue-800" onClick={handleConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
