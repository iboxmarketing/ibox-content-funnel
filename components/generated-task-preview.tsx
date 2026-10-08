"use client";

/**
 * Generated Preview dialog (V1 Sprint 2, generalized Sprint 3 for
 * multiplicity): renders a `PreviewPlan` from lib/content-workflow.ts.
 *
 * One source instance can now preview N candidates of possibly the same
 * Task Type (section 3) -- a plan carries a list of PreviewCandidate, not
 * one fixed shape per step. Four rendering shapes, one per PreviewMode:
 *  - text-candidate modes (Problem Split -> Parts, Knowledge Discovery ->
 *    Nodes): an editable name per line, include/exclude.
 *  - RESEARCH_TO_BLOGS: one row per already-existing, UNPLANNED
 *    KnowledgeNode, each optionally producing its own Blog task + context
 *    transfer from the Research instance.
 *  - STEP_FANOUT: Sprint 2's original one-row-per-generated-step shape.
 *
 * Cancel creates nothing and leaves the source task untouched (still not
 * marked DONE); only Confirm does both at once (see workflow-run-view.tsx).
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildTransferCandidates, destinationFieldsForTaskType, type TransferSelection } from "@/lib/workflow-runtime";
import { SHARED_TASK_SELECTION_KEY, type CandidateSelectionState, type PreviewCandidate, type PreviewPlan } from "@/lib/content-workflow";
import type { TaskType } from "@/lib/task-type";

interface RowState {
  readonly key: string;
  readonly included: boolean;
  readonly title: string;
  readonly assignee: string;
  readonly deadline: string;
  readonly selections: readonly TransferSelection[];
}

function defaultTitleFor(candidate: PreviewCandidate): string {
  if (candidate.kind === "STEP_FANOUT") return candidate.step.nameTemplate;
  if (candidate.kind === "RESEARCH_TO_BLOGS") return `${candidate.node.name} — blog`;
  return candidate.text;
}

function defaultAssigneeFor(candidate: PreviewCandidate): string {
  const taskType: TaskType | undefined = candidate.kind === "STEP_FANOUT" ? candidate.taskType : undefined;
  return taskType?.defaultAssigneeRule.kind === "FIXED_ROLE" ? taskType.defaultAssigneeRule.role : "";
}

function TransferSection({ transferCandidates, targetTaskType, selections, onChange }: {
  transferCandidates: ReturnType<typeof buildTransferCandidates>;
  targetTaskType: TaskType;
  selections: readonly TransferSelection[];
  onChange: (selections: readonly TransferSelection[]) => void;
}) {
  if (!transferCandidates.length) return null;
  const destinationFields = destinationFieldsForTaskType(targetTaskType);
  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
      <p className="text-[10px] font-bold uppercase tracking-[.05em] text-slate-500">Context transfer</p>
      {transferCandidates.map((candidate) => {
        const selection = selections.find((s) => s.sourceFieldId === candidate.sourceFieldId);
        return (
          <div key={candidate.sourceFieldId} className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              className="size-3.5 accent-blue-700"
              checked={Boolean(selection)}
              onChange={(e) => {
                if (e.target.checked) {
                  const firstTarget = destinationFields[0];
                  onChange([...selections, { sourceFieldId: candidate.sourceFieldId, destinationFieldId: firstTarget?.id ?? "" }]);
                } else {
                  onChange(selections.filter((s) => s.sourceFieldId !== candidate.sourceFieldId));
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
                  onChange={(e) => onChange(selections.map((s) => (s.sourceFieldId === candidate.sourceFieldId ? { ...s, destinationFieldId: e.target.value } : s)))}
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
  );
}

export function GeneratedTaskPreview({ plan, onCancel, onConfirm }: { plan: PreviewPlan; onCancel: () => void; onConfirm: (selections: readonly CandidateSelectionState[]) => void }) {
  const [rows, setRows] = useState<readonly RowState[]>(() => [
    ...plan.candidates.map((candidate) => ({
      key: candidate.key,
      included: true,
      title: defaultTitleFor(candidate),
      assignee: defaultAssigneeFor(candidate),
      deadline: "",
      selections: [],
    })),
    // Always present, always submitted as included -- see
    // SHARED_TASK_SELECTION_KEY's doc comment in lib/content-workflow.ts.
    { key: SHARED_TASK_SELECTION_KEY, included: true, title: "", assignee: "", deadline: "", selections: [] },
  ]);
  const transferCandidates = useMemo(() => buildTransferCandidates(plan.sourceInstance, plan.sourceTaskType), [plan]);

  function updateRow(key: string, changes: Partial<RowState>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function handleConfirm() {
    const selections: CandidateSelectionState[] = rows.map((row) => ({ key: row.key, included: row.included, title: row.title, assignee: row.assignee, deadline: row.deadline, selections: row.selections }));
    onConfirm(selections);
  }

  const isTextMode = plan.mode === "PROBLEM_SPLIT_TO_PARTS" || plan.mode === "KNOWLEDGE_DISCOVERY_TO_NODES";
  const sharedRow = rows.find((r) => r.key === SHARED_TASK_SELECTION_KEY);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generated Preview</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">
          &ldquo;{plan.sourceInstance.title}&rdquo; bajarildi deb belgilanadi. Quyidagilarni ko&apos;rib chiqing, kerak bo&apos;lsa tahrirlang, so&apos;ng Confirm bosing. Faqat tanlanganlar yaratiladi.
        </p>

        <div className="space-y-3">
          {plan.candidates.map((candidate) => {
            const row = rows.find((r) => r.key === candidate.key);
            if (!row) return null;
            const candidateTaskType = candidate.kind === "STEP_FANOUT" ? candidate.taskType : plan.targetTaskType;
            return (
              <div key={candidate.key} className={`rounded-xl border p-3 transition ${row.included ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-blue-700" checked={row.included} onChange={(e) => updateRow(candidate.key, { included: e.target.checked })} />
                  {candidate.kind === "STEP_FANOUT" && <Badge variant="outline" className="text-[10px]">{candidate.step.blocking ? "blocking" : "non-blocking"}</Badge>}
                  {candidate.kind === "RESEARCH_TO_BLOGS" && <Badge variant="outline" className="text-[10px]">UNPLANNED</Badge>}
                  <strong className="text-sm text-slate-950">{candidate.kind === "RESEARCH_TO_BLOGS" ? candidate.node.name : candidate.kind === "STEP_FANOUT" ? candidate.taskType.name : null}</strong>
                </div>

                {isTextMode ? (
                  <label className="mt-2 block text-[11px] font-semibold text-slate-600">Nomi<Input value={row.title} onChange={(e) => updateRow(candidate.key, { title: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
                ) : (
                  <>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <label className="text-[11px] font-semibold text-slate-600">Title<Input value={row.title} onChange={(e) => updateRow(candidate.key, { title: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
                      <label className="text-[11px] font-semibold text-slate-600">Assignee<Input value={row.assignee} onChange={(e) => updateRow(candidate.key, { assignee: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} placeholder="Tanlanmagan" /></label>
                      <label className="text-[11px] font-semibold text-slate-600">Deadline<Input type="date" value={row.deadline} onChange={(e) => updateRow(candidate.key, { deadline: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
                    </div>
                    {row.included && candidate.kind === "RESEARCH_TO_BLOGS" && candidateTaskType && (
                      <TransferSection transferCandidates={transferCandidates} targetTaskType={candidateTaskType} selections={row.selections} onChange={(selections) => updateRow(candidate.key, { selections })} />
                    )}
                    {row.included && candidate.kind === "STEP_FANOUT" && candidateTaskType && (
                      <TransferSection transferCandidates={transferCandidates} targetTaskType={candidateTaskType} selections={row.selections} onChange={(selections) => updateRow(candidate.key, { selections })} />
                    )}
                  </>
                )}
              </div>
            );
          })}
          {!plan.candidates.length && <p className="text-sm text-slate-400">Hozircha hech narsa yo&apos;q.</p>}
        </div>

        {plan.mode === "KNOWLEDGE_DISCOVERY_TO_NODES" && plan.targetTaskType && sharedRow && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.05em] text-blue-800">Tanlangan node&apos;lar uchun BITTA umumiy {plan.targetTaskType.name} task yaratiladi</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-slate-600">Assignee<Input value={sharedRow.assignee} onChange={(e) => updateRow(sharedRow.key, { assignee: e.target.value })} className="mt-1 h-8 bg-white text-xs" placeholder="Tanlanmagan" /></label>
              <label className="text-[11px] font-semibold text-slate-600">Deadline<Input type="date" value={sharedRow.deadline} onChange={(e) => updateRow(sharedRow.key, { deadline: e.target.value })} className="mt-1 h-8 bg-white text-xs" /></label>
            </div>
            <TransferSection transferCandidates={transferCandidates} targetTaskType={plan.targetTaskType} selections={sharedRow.selections} onChange={(selections) => updateRow(sharedRow.key, { selections })} />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Bekor qilish</Button>
          <Button type="button" className="bg-blue-700 hover:bg-blue-800" onClick={handleConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
