"use client";

/**
 * Generated Preview dialog (V1 Sprint 2, generalized Sprint 3 for
 * multiplicity, extended Sprint 4 for Angle/Material format groups):
 * renders a `PreviewPlan` from lib/content-workflow.ts.
 *
 * One source instance can preview N candidates, possibly of different
 * kinds mixed in the same plan (section 3/4) -- rendering is dispatched
 * per-candidate by `candidate.kind`, not by the plan's overall mode:
 *  - PROBLEM_SPLIT_TO_PARTS / KNOWLEDGE_DISCOVERY_TO_NODES: an editable
 *    name per line, include/exclude, no task created directly.
 *  - ANGLE_TO_ANGLES: an editable name + simple classification
 *    (category/usage/priority) per line, no task created directly. A
 *    plan in this mode may ALSO mix in STEP_FANOUT candidates (e.g.
 *    Destination Decision, once genuinely unlocked) -- rendered exactly
 *    like any other STEP_FANOUT row alongside the Angle rows.
 *  - RESEARCH_TO_BLOGS: one row per existing, UNPLANNED KnowledgeNode,
 *    each optionally producing its own Blog task + context transfer.
 *  - MATERIAL_FORMAT_GROUPS (section 15): candidates grouped and
 *    visually separated by format (Reels / Carousels / Text Posts /
 *    YouTube), each group with its own shared default deadline.
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
import { ANGLE_PRIORITIES, ANGLE_USAGES } from "@/lib/content-entity";

interface RowState {
  readonly key: string;
  readonly included: boolean;
  readonly title: string;
  readonly assignee: string;
  readonly deadline: string;
  readonly selections: readonly TransferSelection[];
  readonly category: string;
  readonly usage: string;
  readonly priority: string;
  readonly publishMode: string;
  readonly note: string;
}

function defaultTitleFor(candidate: PreviewCandidate): string {
  if (candidate.kind === "STEP_FANOUT") return candidate.step.nameTemplate;
  if (candidate.kind === "RESEARCH_TO_BLOGS") return `${candidate.node.name} — blog`;
  if (candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA") return `${candidate.atomicIdea.text} — ${candidate.format}`;
  if (candidate.kind === "PRODUCTION_TASK") return `${candidate.taskType.name} — ${candidate.material.title}`;
  if (candidate.kind === "CHANNEL_PUBLISH" || candidate.kind === "REPUBLISH_FIX") return `${candidate.taskType.name} — ${candidate.channel} — ${candidate.material.title}`;
  return candidate.text;
}

function defaultAssigneeFor(candidate: PreviewCandidate): string {
  const taskType: TaskType | undefined = candidate.kind === "STEP_FANOUT" || candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA" || candidate.kind === "PRODUCTION_TASK" || candidate.kind === "CHANNEL_PUBLISH" || candidate.kind === "REPUBLISH_FIX" ? candidate.taskType : undefined;
  return taskType?.defaultAssigneeRule.kind === "FIXED_ROLE" ? taskType.defaultAssigneeRule.role : "";
}

/** Whether this one candidate creates a task directly (title/assignee/
 * deadline/transfer are meaningful) vs. only an entity (just a name). */
function candidateCreatesTask(candidate: PreviewCandidate): boolean {
  return candidate.kind === "RESEARCH_TO_BLOGS" || candidate.kind === "STEP_FANOUT" || candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA" || candidate.kind === "PRODUCTION_TASK" || candidate.kind === "CHANNEL_PUBLISH" || candidate.kind === "REPUBLISH_FIX";
}

function candidateTaskTypeFor(candidate: PreviewCandidate, planTargetTaskType: TaskType | null): TaskType | null {
  if (candidate.kind === "STEP_FANOUT" || candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA" || candidate.kind === "PRODUCTION_TASK" || candidate.kind === "CHANNEL_PUBLISH" || candidate.kind === "REPUBLISH_FIX") return candidate.taskType;
  return planTargetTaskType;
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

function CandidateRow({ candidate, row, planTargetTaskType, transferCandidates, onChange }: {
  candidate: PreviewCandidate;
  row: RowState;
  planTargetTaskType: TaskType | null;
  transferCandidates: ReturnType<typeof buildTransferCandidates>;
  onChange: (changes: Partial<RowState>) => void;
}) {
  const createsTask = candidateCreatesTask(candidate);
  const candidateTaskType = candidateTaskTypeFor(candidate, planTargetTaskType);

  return (
    <div className={`rounded-xl border p-3 transition ${row.included ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-blue-700" checked={candidate.kind === "PRODUCTION_TASK" ? true : row.included} disabled={candidate.kind === "PRODUCTION_TASK"} onChange={(e) => onChange({ included: e.target.checked })} />
        {candidate.kind === "PRODUCTION_TASK" && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">Majburiy</Badge>}
        {candidate.kind === "STEP_FANOUT" && <Badge variant="outline" className="text-[10px]">{candidate.step.blocking ? "blocking" : "non-blocking"}</Badge>}
        {candidate.kind === "RESEARCH_TO_BLOGS" && <Badge variant="outline" className="text-[10px]">UNPLANNED</Badge>}
        <strong className="text-sm text-slate-950">
          {candidate.kind === "RESEARCH_TO_BLOGS" ? candidate.node.name : candidate.kind === "STEP_FANOUT" || candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA" || candidate.kind === "PRODUCTION_TASK" ? candidate.taskType.name : candidate.kind === "CHANNEL_PUBLISH" || candidate.kind === "REPUBLISH_FIX" ? candidate.channel : null}
        </strong>
      </div>

      {!createsTask ? (
        <>
          <label className="mt-2 block text-[11px] font-semibold text-slate-600">Nomi<Input value={row.title} onChange={(e) => onChange({ title: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
          {candidate.kind === "ANGLE_TO_ANGLES" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-[11px] font-semibold text-slate-600">Category<Input value={row.category} onChange={(e) => onChange({ category: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
              <label className="text-[11px] font-semibold text-slate-600">Usage
                <select value={row.usage} onChange={(e) => onChange({ usage: e.target.value })} disabled={!row.included} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                  {ANGLE_USAGES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-slate-600">Priority
                <select value={row.priority} onChange={(e) => onChange({ priority: e.target.value })} disabled={!row.included} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                  {ANGLE_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="text-[11px] font-semibold text-slate-600">Title<Input value={row.title} onChange={(e) => onChange({ title: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
            <label className="text-[11px] font-semibold text-slate-600">Assignee<Input value={row.assignee} onChange={(e) => onChange({ assignee: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} placeholder="Tanlanmagan" /></label>
            <label className="text-[11px] font-semibold text-slate-600">Deadline<Input type="date" value={row.deadline} onChange={(e) => onChange({ deadline: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
          </div>
          {candidate.kind === "CHANNEL_PUBLISH" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-[11px] font-semibold text-slate-600">Publish mode
                <select value={row.publishMode} onChange={(e) => onChange({ publishMode: e.target.value })} disabled={!row.included} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                  <option value="SCHEDULE">SCHEDULE</option>
                  <option value="PUBLISH_NOW">PUBLISH_NOW</option>
                </select>
              </label>
              <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">Kanalga xos izoh / copy (ixtiyoriy)<Input value={row.note} onChange={(e) => onChange({ note: e.target.value })} className="mt-1 h-8 text-xs" disabled={!row.included} /></label>
            </div>
          )}
          {row.included && candidateTaskType && <TransferSection transferCandidates={transferCandidates} targetTaskType={candidateTaskType} selections={row.selections} onChange={(selections) => onChange({ selections })} />}
        </>
      )}
    </div>
  );
}

const FORMAT_GROUP_LABELS: Record<string, string> = { REEL: "Reels Preview", CAROUSEL: "Carousels Preview", TEXT_POST: "Text Posts Preview", YOUTUBE: "YouTube Preview" };

export function GeneratedTaskPreview({ plan, onCancel, onConfirm }: { plan: PreviewPlan; onCancel: () => void; onConfirm: (selections: readonly CandidateSelectionState[]) => void }) {
  const [rows, setRows] = useState<readonly RowState[]>(() => [
    ...plan.candidates.map((candidate) => ({
      key: candidate.key,
      included: true,
      title: defaultTitleFor(candidate),
      assignee: defaultAssigneeFor(candidate),
      deadline: "",
      selections: [],
      category: "",
      usage: "BOTH",
      priority: "LATER",
      publishMode: "SCHEDULE",
      note: "",
    })),
    // Always present, always submitted as included -- see
    // SHARED_TASK_SELECTION_KEY's doc comment in lib/content-workflow.ts.
    { key: SHARED_TASK_SELECTION_KEY, included: true, title: "", assignee: "", deadline: "", selections: [], category: "", usage: "BOTH", priority: "LATER", publishMode: "SCHEDULE", note: "" },
  ]);
  const transferCandidates = useMemo(() => buildTransferCandidates(plan.sourceInstance, plan.sourceTaskType), [plan]);

  function updateRow(key: string, changes: Partial<RowState>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function applyGroupDeadline(keys: readonly string[], deadline: string) {
    setRows((current) => current.map((row) => (keys.includes(row.key) ? { ...row, deadline } : row)));
  }

  function handleConfirm() {
    const selections: CandidateSelectionState[] = rows.map((row) => ({
      key: row.key, included: row.included, title: row.title, assignee: row.assignee, deadline: row.deadline, selections: row.selections,
      publishMode: row.publishMode, note: row.note,
      category: row.category, usage: row.usage as CandidateSelectionState["usage"], priority: row.priority as CandidateSelectionState["priority"],
    }));
    onConfirm(selections);
  }

  const sharedRow = rows.find((r) => r.key === SHARED_TASK_SELECTION_KEY);

  // Visually separated groups: by format for Material previews (section
  // 15 of Sprint 4), by Material for post-Shoot production tasks (Sprint 5).
  const groups = useMemo(() => {
    if (plan.mode !== "MATERIAL_FORMAT_GROUPS" && plan.mode !== "SHOOT_PRODUCTION" && plan.mode !== "CHANNEL_PUBLISH") return null;
    const grouped = new Map<string, PreviewCandidate[]>();
    for (const candidate of plan.candidates) {
      const label = candidate.kind === "MATERIAL_FROM_ATOMIC_IDEA" ? FORMAT_GROUP_LABELS[candidate.format] ?? candidate.format : candidate.kind === "PRODUCTION_TASK" ? candidate.material.title : candidate.kind === "CHANNEL_PUBLISH" ? candidate.channel : null;
      if (!label) continue;
      const list = grouped.get(label) ?? [];
      list.push(candidate);
      grouped.set(label, list);
    }
    return grouped;
  }, [plan]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generated Preview</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">
          &ldquo;{plan.sourceInstance.title}&rdquo; bajarildi deb belgilanadi. Quyidagilarni ko&apos;rib chiqing, kerak bo&apos;lsa tahrirlang, so&apos;ng Confirm bosing. Faqat tanlanganlar yaratiladi.
        </p>

        {groups ? (
          <div className="space-y-5">
            {(plan.mode === "SHOOT_PRODUCTION" || plan.mode === "CHANNEL_PUBLISH") && (
              <label className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-[11px] font-semibold text-slate-700">Common deadline (hammasi uchun)
                <Input type="date" onChange={(e) => applyGroupDeadline(plan.candidates.map((c) => c.key), e.target.value)} className="h-7 w-36 bg-white text-xs" />
              </label>
            )}
            {[...groups.entries()].map(([format, candidates]) => {
              const keys = candidates.map((c) => c.key);
              return (
                <div key={format} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-950">{format}</h3>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">Shared deadline
                      <Input type="date" onChange={(e) => applyGroupDeadline(keys, e.target.value)} className="h-7 w-36 text-xs" />
                    </label>
                  </div>
                  <div className="space-y-2">
                    {candidates.map((candidate) => {
                      const row = rows.find((r) => r.key === candidate.key);
                      if (!row) return null;
                      return <CandidateRow key={candidate.key} candidate={candidate} row={row} planTargetTaskType={plan.targetTaskType} transferCandidates={transferCandidates} onChange={(changes) => updateRow(candidate.key, changes)} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {plan.candidates.map((candidate) => {
              const row = rows.find((r) => r.key === candidate.key);
              if (!row) return null;
              return <CandidateRow key={candidate.key} candidate={candidate} row={row} planTargetTaskType={plan.targetTaskType} transferCandidates={transferCandidates} onChange={(changes) => updateRow(candidate.key, changes)} />;
            })}
            {!plan.candidates.length && <p className="text-sm text-slate-400">Hozircha hech narsa yo&apos;q.</p>}
          </div>
        )}

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
