"use client";

import { useMemo, useState } from "react";
import { Copy, Link2, ListChecks, Plus, Power, Search, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FIELD_TYPES,
  RECOMMENDED_DAYS,
  validateTaskType,
  type AssigneeRule,
  type FieldDefinition,
  type FieldType,
  type RecommendedDay,
  type TaskType,
  type TaskTypeDraft,
} from "@/lib/task-type";
import { useContentOsStore } from "@/components/content-os-store-provider";

function emptyDraft(): TaskTypeDraft {
  return {
    name: "",
    description: "",
    requiredFields: [],
    optionalFields: [],
    defaultPrompt: null,
    promptVersion: null,
    defaultAssigneeRule: { kind: "DEFAULT_CONTENT_OWNER" },
    recommendedDay: null,
    reviewRequired: false,
    allowedLinkLabels: [],
    completionRequirements: [],
  };
}

function newField(): FieldDefinition {
  return { id: `field-${Math.random().toString(36).slice(2, 8)}`, label: "", type: "TEXT", required: true };
}

function assigneeRuleLabel(rule: AssigneeRule): string {
  if (rule.kind === "DEFAULT_CONTENT_OWNER") return "Default Content Owner";
  if (rule.kind === "MANUAL") return "Qo'lda tanlash";
  return `Fixed role: ${rule.role || "—"}`;
}

function FieldRow({ field, onChange, onRemove }: { field: FieldDefinition; onChange: (field: FieldDefinition) => void; onRemove: () => void }) {
  const isSelectLike = field.type === "SELECT" || field.type === "MULTI_SELECT";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} placeholder="Maydon nomi" className="h-8 min-w-[160px] flex-1 bg-white text-xs" />
        <select value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600"><input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} className="size-3.5 accent-blue-700" /> Majburiy</label>
        <Button type="button" variant="ghost" size="icon" className="size-7 text-slate-400 hover:text-red-600" onClick={onRemove} aria-label="Maydonni o'chirish"><Trash2 className="size-3.5" /></Button>
      </div>
      {isSelectLike && (
        <div className="mt-2">
          <Input
            value={(field.options ?? []).map((o) => o.label).join(", ")}
            onChange={(e) => {
              const options = e.target.value.split(",").map((part) => part.trim()).filter(Boolean).map((label) => ({ value: label, label }));
              onChange({ ...field, options });
            }}
            placeholder="Variantlar, vergul bilan: A, B, C"
            className="h-8 bg-white text-xs"
          />
        </div>
      )}
    </div>
  );
}

function TaskTypeEditor({ draft, onChange }: { draft: TaskTypeDraft; onChange: (draft: TaskTypeDraft) => void }) {
  const errors = useMemo(() => validateTaskType(draft), [draft]);
  const updateField = (list: "requiredFields" | "optionalFields", index: number, field: FieldDefinition) => {
    const next = [...draft[list]];
    next[index] = field;
    onChange({ ...draft, [list]: next });
  };
  const removeField = (list: "requiredFields" | "optionalFields", index: number) => {
    onChange({ ...draft, [list]: draft[list].filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold text-slate-700">Nomi<Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} className="mt-1 h-9 rounded-xl" placeholder="masalan: Blog" /></label>
      <label className="block space-y-1.5 text-xs font-semibold text-slate-700">Tavsif<Textarea value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} className="mt-1 min-h-16 rounded-xl" /></label>

      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Majburiy maydonlar</span><Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => onChange({ ...draft, requiredFields: [...draft.requiredFields, newField()] })}><Plus className="size-3.5" /> Maydon</Button></div>
        <div className="space-y-2">{draft.requiredFields.map((field, index) => <FieldRow key={field.id || index} field={field} onChange={(f) => updateField("requiredFields", index, f)} onRemove={() => removeField("requiredFields", index)} />)}{!draft.requiredFields.length && <p className="text-[11px] text-slate-400">Majburiy maydon yo’q.</p>}</div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Ixtiyoriy maydonlar</span><Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => onChange({ ...draft, optionalFields: [...draft.optionalFields, newField()] })}><Plus className="size-3.5" /> Maydon</Button></div>
        <div className="space-y-2">{draft.optionalFields.map((field, index) => <FieldRow key={field.id || index} field={field} onChange={(f) => updateField("optionalFields", index, f)} onRemove={() => removeField("optionalFields", index)} />)}{!draft.optionalFields.length && <p className="text-[11px] text-slate-400">Ixtiyoriy maydon yo’q.</p>}</div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.06em] text-blue-800"><Sparkles className="size-3.5" /> Default prompt — faqat Head tahrirlaydi</div>
        <Textarea value={draft.defaultPrompt ?? ""} onChange={(e) => onChange({ ...draft, defaultPrompt: e.target.value || null, promptVersion: e.target.value ? draft.promptVersion ?? "v1" : null })} className="mt-2 min-h-24 bg-white font-mono text-[11px]" placeholder="Prompt matni. INPUT bo'limi oxirida, bo'sh qoldiriladi." />
        {draft.defaultPrompt && <label className="mt-2 block text-[11px] font-semibold text-blue-800">Versiya<Input value={draft.promptVersion ?? ""} onChange={(e) => onChange({ ...draft, promptVersion: e.target.value })} className="mt-1 h-8 w-32 bg-white text-xs" /></label>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Default assignee qoidasi
          <Select value={draft.defaultAssigneeRule.kind} onValueChange={(value) => onChange({ ...draft, defaultAssigneeRule: value === "FIXED_ROLE" ? { kind: "FIXED_ROLE", role: draft.defaultAssigneeRule.kind === "FIXED_ROLE" ? draft.defaultAssigneeRule.role : "" } : { kind: value as "DEFAULT_CONTENT_OWNER" | "MANUAL" } })}>
            <SelectTrigger className="mt-1 h-9 w-full rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="DEFAULT_CONTENT_OWNER">Default Content Owner</SelectItem><SelectItem value="FIXED_ROLE">Fixed role</SelectItem><SelectItem value="MANUAL">Qo’lda tanlash</SelectItem></SelectContent>
          </Select>
        </label>
        {draft.defaultAssigneeRule.kind === "FIXED_ROLE" && (
          <label className="space-y-1.5 text-xs font-semibold text-slate-700">Rol nomi<Input value={draft.defaultAssigneeRule.role} onChange={(e) => onChange({ ...draft, defaultAssigneeRule: { kind: "FIXED_ROLE", role: e.target.value } })} className="mt-1 h-9 rounded-xl" placeholder="masalan: SEO" /></label>
        )}
        <label className="space-y-1.5 text-xs font-semibold text-slate-700">Tavsiya etilgan kun
          <Select value={draft.recommendedDay ?? "NONE"} onValueChange={(value) => onChange({ ...draft, recommendedDay: value === "NONE" ? null : value as RecommendedDay })}>
            <SelectTrigger className="mt-1 h-9 w-full rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="NONE">Belgilanmagan</SelectItem>{RECOMMENDED_DAYS.map((day) => <SelectItem key={day} value={day}>{day}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:col-span-2"><input type="checkbox" checked={draft.reviewRequired} onChange={(e) => onChange({ ...draft, reviewRequired: e.target.checked })} className="size-4 accent-blue-700" /> Review talab qilinadi</label>
        {draft.reviewRequired && (
          <label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Review bosqichi
            <select value={draft.reviewStage ?? "DRAFT"} onChange={(e) => onChange({ ...draft, reviewStage: e.target.value as "DRAFT" | "FINAL" })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs">
              <option value="DRAFT">Draft / Concept (faqat shu taskni to’xtatadi)</option>
              <option value="FINAL">Final asset (tasdiqlanmaguncha Publish bloklanadi)</option>
            </select>
          </label>
        )}
        <label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Ruxsat etilgan link label’lar (vergul bilan)<Input value={draft.allowedLinkLabels.join(", ")} onChange={(e) => onChange({ ...draft, allowedLinkLabels: e.target.value.split(",").map((part) => part.trim()).filter(Boolean) })} className="mt-1 h-9 rounded-xl" placeholder="Script, Figma, Raw, Final, Reference" /></label>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-800">Xatolar ({errors.length})</p><ul className="mt-1.5 space-y-1 text-[11px] text-red-700">{errors.map((error, index) => <li key={index}>• {error.message}</li>)}</ul></div>
      )}
    </div>
  );
}

export function TaskTypeLibrary() {
  const { state, createTaskType, reviseTaskType, duplicateTaskType, setTaskTypeActive } = useContentOsStore();
  const taskTypes = state.taskTypes;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(taskTypes[0]?.id ?? null);
  const [draft, setDraft] = useState<TaskTypeDraft | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [notice, setNotice] = useState("Sessiya-only konfiguratsiya · Supabase yoki task backendga yozilmaydi.");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("uz");
    if (!q) return taskTypes;
    return taskTypes.filter((t) => t.name.toLocaleLowerCase("uz").includes(q) || t.description.toLocaleLowerCase("uz").includes(q));
  }, [taskTypes, query]);

  const selected = taskTypes.find((t) => t.id === selectedId) ?? null;

  function openForEdit(taskType: TaskType) {
    setSelectedId(taskType.id);
    setDraft(structuredClone(taskType));
    setDraftIsNew(false);
  }

  function openForCreate() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setDraftIsNew(true);
  }

  function saveDraft() {
    if (!draft) return;
    const errors = validateTaskType(draft);
    if (errors.length) { setNotice(`Saqlanmadi: ${errors.length} ta xato bor.`); return; }
    if (draftIsNew) {
      const created = createTaskType(draft);
      setSelectedId(created.id);
      setNotice(`"${created.name}" yaratildi (lokal sessiya).`);
    } else if (selected) {
      reviseTaskType(selected.id, draft);
      setNotice(`"${draft.name}" yangilandi — v${selected.version + 1} (lokal sessiya).`);
    }
    setDraft(null);
    setDraftIsNew(false);
  }

  function duplicate(taskType: TaskType) {
    const copy = duplicateTaskType(taskType.id);
    if (copy) setSelectedId(copy.id);
    setNotice(`"${taskType.name}" nusxalandi.`);
  }

  function toggleActive(taskType: TaskType) {
    setTaskTypeActive(taskType.id, !taskType.isActive);
    setNotice(`"${taskType.name}" ${!taskType.isActive ? "faollashtirildi" : "o'chirildi"}.`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Task Type Library</h1><p className="text-[11px] text-slate-500">Qayta ishlatiladigan task konfiguratsiyasi — Head tomonidan boshqariladi</p></div>
        <div className="relative ml-auto min-w-[220px] max-w-[360px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Qidirish..." className="h-9 bg-slate-50 pl-9 shadow-none" /></div>
        <Button size="sm" className="h-9 rounded-xl bg-blue-700 hover:bg-blue-800" onClick={openForCreate}><Plus className="size-4" /> Yangi Task Type</Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-900 lg:px-5"><ShieldCheck className="size-3.5" /> {notice}</div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:border-b-0 lg:border-r">
          <div className="space-y-2">
            {filtered.map((taskType) => (
              // A div (not <button>): the row contains its own buttons, and
              // nested <button>s are invalid HTML (Sprint 7 pilot finding).
              <div key={taskType.id} role="button" tabIndex={0} onClick={() => openForEdit(taskType)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openForEdit(taskType); } }} className={`w-full cursor-pointer rounded-xl border p-3 text-left transition ${selectedId === taskType.id && !draftIsNew ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"} ${!taskType.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2"><strong className="truncate text-sm font-semibold text-slate-950">{taskType.name}</strong><Badge variant="outline" className="ml-auto shrink-0 text-[9px]">v{taskType.version}</Badge></div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{taskType.description}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1"><ListChecks className="size-3" /> {taskType.requiredFields.length} majburiy</span>
                  {taskType.allowedLinkLabels.length > 0 && <span className="flex items-center gap-1"><Link2 className="size-3" /> {taskType.allowedLinkLabels.length} link</span>}
                  {!taskType.isActive && <Badge variant="outline" className="border-slate-300 text-slate-500">Nofaol</Badge>}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-6 rounded-md px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); duplicate(taskType); }}><Copy className="size-3" /> Nusxa</Button>
                  <Button type="button" variant="outline" size="sm" className="h-6 rounded-md px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); toggleActive(taskType); }}><Power className="size-3" /> {taskType.isActive ? "O'chirish" : "Yoqish"}</Button>
                </div>
              </div>
            ))}
            {!filtered.length && <p className="p-4 text-center text-xs text-slate-400">Hech narsa topilmadi.</p>}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 lg:p-6">
          {draft ? (
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-center gap-2"><h2 className="text-lg font-bold text-slate-950">{draftIsNew ? "Yangi Task Type" : `Tahrirlash: ${selected?.name}`}</h2><Button type="button" variant="ghost" size="sm" className="ml-auto text-slate-500" onClick={() => { setDraft(null); setDraftIsNew(false); }}>Bekor qilish</Button></div>
              <TaskTypeEditor draft={draft} onChange={setDraft} />
              <div className="mt-5"><Button type="button" onClick={saveDraft} className="rounded-xl bg-blue-700 hover:bg-blue-800">Saqlash</Button></div>
            </div>
          ) : selected ? (
            <div className="mx-auto max-w-2xl space-y-4">
              <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-slate-950">{selected.name}</h2><Badge variant="outline">v{selected.version}</Badge><Button type="button" variant="outline" size="sm" className="ml-auto rounded-lg" onClick={() => openForEdit(selected)}>Tahrirlash</Button></div>
              <p className="text-sm text-slate-600">{selected.description}</p>
              <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <p><strong className="text-slate-900">Assignee:</strong> {assigneeRuleLabel(selected.defaultAssigneeRule)}</p>
                <p><strong className="text-slate-900">Tavsiya kun:</strong> {selected.recommendedDay ?? "Belgilanmagan"}</p>
                <p><strong className="text-slate-900">Review:</strong> {selected.reviewRequired ? "Talab qilinadi" : "Talab qilinmaydi"}</p>
                <p><strong className="text-slate-900">Link label’lar:</strong> {selected.allowedLinkLabels.join(", ") || "yo’q"}</p>
              </div>
              <div><p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Majburiy maydonlar</p><div className="mt-2 flex flex-wrap gap-1.5">{selected.requiredFields.map((f) => <Badge key={f.id} variant="secondary">{f.label} · {f.type}</Badge>)}{!selected.requiredFields.length && <span className="text-xs text-slate-400">yo’q</span>}</div></div>
              {selected.defaultPrompt && <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-blue-800">Default prompt · {selected.promptVersion}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{selected.defaultPrompt}</pre></div>}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Tahrirlash uchun Task Type tanlang.</div>
          )}
        </main>
      </div>
    </div>
  );
}
