"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, GitBranch, Lock, Plus, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TASK_TYPE_FIXTURES } from "@/lib/task-type-fixtures";
import {
  MODULE_TYPES,
  addStep,
  createWorkflowTemplate,
  removeStep,
  reorderSteps,
  reviseWorkflowTemplate,
  updateStep,
  validateWorkflowTemplate,
  type ModuleType,
  type WorkflowStep,
  type WorkflowTemplate,
} from "@/lib/workflow-template";
import { WORKFLOW_TEMPLATE_FIXTURES } from "@/lib/workflow-template-fixtures";

const TASK_TYPES = TASK_TYPE_FIXTURES.filter((taskType) => taskType.isActive);
const TASK_TYPE_IDS = new Set(TASK_TYPES.map((taskType) => taskType.id));

function StepRow({
  step,
  index,
  total,
  allSteps,
  onChange,
  onMove,
  onRemove,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
  allSteps: readonly WorkflowStep[];
  onChange: (changes: Partial<WorkflowStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const otherSteps = allSteps.filter((item) => item.id !== step.id);
  const dependedOnByOthers = allSteps.some((item) => item.dependsOn.includes(step.id));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">{index + 1}</Badge>
        <Input value={step.nameTemplate} onChange={(e) => onChange({ nameTemplate: e.target.value })} className="h-8 min-w-[200px] flex-1 text-sm font-semibold" />
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="size-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Yuqoriga"><ArrowUp className="size-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className="size-7" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Pastga"><ArrowDown className="size-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className="size-7 text-slate-400 hover:text-red-600" onClick={onRemove} aria-label="O'chirish"><Trash2 className="size-3.5" /></Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] font-semibold text-slate-600">Task Type
          <Select value={step.taskTypeId} onValueChange={(value) => onChange({ taskTypeId: value })}>
            <SelectTrigger className="mt-1 h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_TYPES.map((taskType) => <SelectItem key={taskType.id} value={taskType.id}>{taskType.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <div className="space-y-1 text-[11px] font-semibold text-slate-600">Dependencies
          <div className="mt-1 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5">
            {otherSteps.length ? otherSteps.map((candidate) => {
              const checked = step.dependsOn.includes(candidate.id);
              return <label key={candidate.id} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] ${checked ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-500"}`}>
                <input type="checkbox" className="size-3 accent-blue-700" checked={checked} onChange={(e) => onChange({ dependsOn: e.target.checked ? [...step.dependsOn, candidate.id] : step.dependsOn.filter((id) => id !== candidate.id) })} />
                {candidate.nameTemplate}
              </label>;
            }) : <span className="text-[10px] text-slate-400">Boshqa step yo’q</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={step.blocking} onChange={(e) => onChange({ blocking: e.target.checked })} className="size-3.5 accent-blue-700" /> {step.blocking ? <Lock className="size-3.5 text-amber-600" /> : <Unlock className="size-3.5 text-slate-400" />} Blocking</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={step.skippable} onChange={(e) => onChange({ skippable: e.target.checked })} className="size-3.5 accent-blue-700" /> Skippable</label>
        {step.blocking && !dependedOnByOthers && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">Hech kim bog’liq emas</Badge>}
      </div>

      <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[.05em] text-slate-500">Step override (ixtiyoriy)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[10px] font-semibold text-slate-600">Review required override
            <select
              value={step.overrides?.reviewRequired === undefined ? "INHERIT" : String(step.overrides.reviewRequired)}
              onChange={(e) => onChange({ overrides: { ...step.overrides, reviewRequired: e.target.value === "INHERIT" ? undefined : e.target.value === "true" } })}
              className="mt-1 h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
            >
              <option value="INHERIT">Task Type’dan meros</option>
              <option value="true">Ha</option>
              <option value="false">Yo’q</option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

function ValidationPanel({ errors }: { errors: ReturnType<typeof validateWorkflowTemplate> }) {
  if (!errors.length) {
    return <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800"><CheckCircle2 className="size-4" /> Validatsiyadan o’tdi — xato yo’q.</div>;
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-2 text-xs font-bold text-red-800"><AlertTriangle className="size-4" /> {errors.length} ta validatsiya xatosi</p>
      <ul className="mt-2 space-y-1.5 text-[11px] text-red-700">{errors.map((error, index) => <li key={index}>• <span className="font-mono">{error.code}</span> — {error.message}</li>)}</ul>
    </div>
  );
}

export function WorkflowTemplateBuilder() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(() => structuredClone(WORKFLOW_TEMPLATE_FIXTURES) as WorkflowTemplate[]);
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const [notice, setNotice] = useState("Sessiya-only konfiguratsiya · hech qanday real task yaratilmaydi.");
  const template = templates.find((item) => item.id === selectedId) ?? null;
  const errors = useMemo(() => template ? validateWorkflowTemplate(template, TASK_TYPE_IDS) : [], [template]);

  function updateTemplate(next: WorkflowTemplate) {
    setTemplates((current) => current.map((item) => item.id === next.id ? next : item));
  }

  function createNew() {
    const created = createWorkflowTemplate({ name: "Yangi workflow", description: "", moduleType: "OTHER" });
    setTemplates((current) => [...current, created]);
    setSelectedId(created.id);
    setNotice("Yangi workflow yaratildi (lokal sessiya).");
  }

  function addNewStep() {
    if (!template || !TASK_TYPES[0]) return;
    const next = addStep(template, { taskTypeId: TASK_TYPES[0].id, nameTemplate: TASK_TYPES[0].name, dependsOn: [], blocking: false, skippable: false });
    updateTemplate(next);
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    if (!template) return;
    const ids = template.steps.map((step) => step.id);
    const index = ids.indexOf(stepId);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= ids.length) return;
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    updateTemplate(reorderSteps(template, ids));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Workflow Template Builder</h1><p className="text-[11px] text-slate-500">Task Type’larni qayta ishlatiladigan zanjirga ulash</p></div>
        <Button size="sm" className="ml-auto h-9 rounded-xl bg-blue-700 hover:bg-blue-800" onClick={createNew}><Plus className="size-4" /> Yangi workflow</Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-900 lg:px-5"><ShieldCheck className="size-3.5" /> {notice}</div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:border-b-0 lg:border-r">
          <div className="space-y-2">
            {templates.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === item.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                <div className="flex items-center gap-2"><strong className="truncate text-sm font-semibold text-slate-950">{item.name}</strong><Badge variant="outline" className="ml-auto shrink-0 text-[9px]">v{item.version}</Badge></div>
                <p className="mt-1 text-[11px] text-slate-500">{item.steps.length} step · {item.moduleType}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 lg:p-6">
          {template ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-semibold text-slate-700">Nomi<Input value={template.name} onChange={(e) => updateTemplate(reviseWorkflowTemplate(template, { name: e.target.value }))} className="mt-1 h-9" /></label>
                  <label className="space-y-1 text-xs font-semibold text-slate-700">Module type
                    <Select value={template.moduleType} onValueChange={(value) => updateTemplate(reviseWorkflowTemplate(template, { moduleType: value as ModuleType }))}>
                      <SelectTrigger className="mt-1 h-9 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{MODULE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">Tavsif<Textarea value={template.description} onChange={(e) => updateTemplate(reviseWorkflowTemplate(template, { description: e.target.value }))} className="mt-1 min-h-14" /></label>
                </div>
              </div>

              <ValidationPanel errors={errors} />

              <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold text-slate-950"><GitBranch className="size-4 text-blue-700" /> Steps ({template.steps.length})</h3><Button type="button" variant="outline" size="sm" onClick={addNewStep}><Plus className="size-4" /> Step qo’shish</Button></div>
              <div className="space-y-3">
                {template.steps.map((step, index) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={index}
                    total={template.steps.length}
                    allSteps={template.steps}
                    onChange={(changes) => updateTemplate(updateStep(template, step.id, changes))}
                    onMove={(direction) => moveStep(step.id, direction)}
                    onRemove={() => updateTemplate(removeStep(template, step.id))}
                  />
                ))}
                {!template.steps.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">Hali step yo’q.</div>}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Workflow tanlang yoki yangi yarating.</div>
          )}
        </main>
      </div>
    </div>
  );
}
