"use client";

/**
 * Local Task Detail screen (V1 Sprint 2). Deliberately NOT the giant
 * methodology document -- just what one person needs to do one task:
 * title, Task Type, status, assignee, deadline, required/optional/custom
 * fields, links, Copy Prompt, Complete, Skip.
 *
 * "Complete" only validates + hands the instance to the parent via
 * `onComplete` -- it never marks the instance DONE itself. Per spec, DONE
 * is only ever set together with creating the immediate next steps, at
 * Confirm time in the Generated Task Preview (see workflow-run-view.tsx).
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Copy, Lightbulb, Link2, Plus, SkipForward, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useContentOsStore } from "@/components/content-os-store-provider";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import { useContentEntityStore } from "@/components/content-entity-store-provider";
import { anglesForKnowledgeNode, destinationsForProblemCategory, labelForRef } from "@/lib/content-entity-store";
import { entityTypeLabelUz } from "@/lib/content-workflow";
import { ATOMIC_IDEA_COVERAGE_TYPES, ATOMIC_IDEA_DECISIONS, DESTINATION_TYPES, MATERIAL_FORMATS, type Destination, type MaterialFormat } from "@/lib/content-entity";
import {
  canCompleteTaskInstance,
  emptyAtomicIdeaDraft,
  provenanceForField,
  validateAtomicIdeaCoverage,
  validateMinimumCandidateLines,
  validateTaskInstanceForCompletion,
  type AtomicIdeaDraft,
  type CompletionValidationError,
  type FieldValue,
  type TaskInstance,
} from "@/lib/task-instance";
import { validateTaskLink } from "@/lib/task-link";
import { effectiveRequiredFields } from "@/lib/workflow-template";
import { FIELD_TYPES, type FieldDefinition, type FieldType } from "@/lib/task-type";

/** Fields handled entirely by DestinationDecisionBlock's dedicated UI --
 * never rendered by the generic required/optional field loop. */
const DESTINATION_DECISION_HIDDEN_FIELD_IDS = new Set(["chosen-destination-id", "destination-type"]);

function FieldInput({ field, value, onChange }: { field: FieldDefinition; value: FieldValue; onChange: (value: FieldValue) => void }) {
  switch (field.type) {
    case "TEXT":
    case "URL":
      return <Input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="h-9 bg-white" placeholder={field.type === "URL" ? "https://..." : undefined} />;
    case "LONG_TEXT":
      return <Textarea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="min-h-20 bg-white" />;
    case "NUMBER":
      return <Input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="h-9 bg-white" />;
    case "BOOLEAN":
      return <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="size-4 accent-blue-700" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> Ha</label>;
    case "DATE":
      return <Input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className="h-9 bg-white" />;
    case "DATETIME":
      return <Input type="datetime-local" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className="h-9 bg-white" />;
    case "SELECT":
      return (
        <Select value={typeof value === "string" ? value : undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-9 w-full bg-white"><SelectValue placeholder="Tanlang" /></SelectTrigger>
          <SelectContent>{(field.options ?? []).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${checked ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-500"}`}>
                <input type="checkbox" className="size-3 accent-blue-700" checked={checked} onChange={(e) => onChange(e.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))} />
                {option.label}
              </label>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

function FieldRow({
  instance,
  field,
  error,
  isCustom,
  onSuggest,
}: {
  instance: TaskInstance;
  field: FieldDefinition;
  error?: string;
  isCustom?: boolean;
  onSuggest?: (field: FieldDefinition) => void;
}) {
  const { setFieldValue, editTransferredFieldValue } = useTaskRuntimeStore();
  const provenance = provenanceForField(instance, field.id);
  const storedValue = instance.fieldValues[field.id] ?? null;
  const [pendingValue, setPendingValue] = useState<FieldValue | null>(null);
  const hasPendingEdit = provenance && pendingValue !== null && pendingValue !== storedValue;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <span>{field.label}</span>
        {field.required && <span className="text-red-600">*</span>}
        <Badge variant="outline" className="text-[9px] font-normal text-slate-400">{field.type}</Badge>
        {isCustom && <Badge variant="outline" className="border-purple-200 bg-purple-50 text-[9px] text-purple-700">Custom</Badge>}
        {provenance && !hasPendingEdit && <span className="flex items-center gap-1 text-[10px] font-normal text-blue-600"><Lightbulb className="size-3" /> ko’chirilgan</span>}
      </div>
      <FieldInput
        field={field}
        value={provenance ? (pendingValue ?? storedValue) : storedValue}
        onChange={(value) => {
          if (provenance) setPendingValue(value);
          else setFieldValue(instance.id, field.id, value);
        }}
      />
      {hasPendingEdit && provenance && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-[11px] text-blue-800">
          <span>Bu qiymat boshqa taskdan ko’chirilgan edi. Qayerga saqlansin?</span>
          <Button type="button" size="sm" variant="outline" className="h-6 rounded-md px-2 text-[10px]" onClick={() => { editTransferredFieldValue(instance.id, field.id, pendingValue as FieldValue); setPendingValue(null); }}>Faqat bu task</Button>
          <Button type="button" size="sm" className="h-6 rounded-md bg-blue-700 px-2 text-[10px] hover:bg-blue-800" onClick={() => { editTransferredFieldValue(instance.id, field.id, pendingValue as FieldValue, { sourceTaskId: provenance.sourceTaskId, sourceFieldId: provenance.sourceFieldId }); setPendingValue(null); }}>Manba taskni ham yangilash</Button>
        </div>
      )}
      {isCustom && onSuggest && (
        <button type="button" onClick={() => onSuggest(field)} className="text-[10px] font-medium text-blue-700 underline-offset-2 hover:underline">Shablon uchun taklif qilish</button>
      )}
      {error && <p className="flex items-center gap-1 text-[11px] font-medium text-red-600"><AlertTriangle className="size-3" /> {error}</p>}
    </div>
  );
}

function AddCustomField({ onAdd }: { onAdd: (field: FieldDefinition) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [required, setRequired] = useState(false);

  if (!open) {
    return <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Custom maydon</Button>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Maydon nomi" className="h-8 min-w-[160px] flex-1 bg-white text-xs" />
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-3.5 accent-blue-700" /> Majburiy</label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 rounded-lg bg-blue-700 text-xs hover:bg-blue-800"
          disabled={!label.trim()}
          onClick={() => { onAdd({ id: `custom-${Math.random().toString(36).slice(2, 9)}`, label: label.trim(), type, required }); setLabel(""); setType("TEXT"); setRequired(false); setOpen(false); }}
        >
          Qo’shish
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-slate-500" onClick={() => setOpen(false)}>Bekor qilish</Button>
      </div>
    </div>
  );
}

function AddLink({ allowedLabels, onAdd }: { allowedLabels: readonly string[]; onAdd: (label: string, url: string) => void }) {
  const [label, setLabel] = useState(allowedLabels[0] ?? "");
  const [customLabel, setCustomLabel] = useState("");
  const [url, setUrl] = useState("");
  const effectiveLabel = label === "__custom__" ? customLabel : label;
  const errors = validateTaskLink({ label: effectiveLabel, url });

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <div className="space-y-1">
        <select value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          {allowedLabels.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="__custom__">Boshqa...</option>
        </select>
      </div>
      {label === "__custom__" && <Input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Label nomi" className="h-8 w-28 bg-white text-xs" />}
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="h-8 min-w-[200px] flex-1 bg-white text-xs" />
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-lg bg-blue-700 text-xs hover:bg-blue-800"
        disabled={errors.length > 0}
        onClick={() => { onAdd(effectiveLabel, url); setUrl(""); }}
      >
        <Plus className="size-3.5" /> Link
      </Button>
    </div>
  );
}

/** Section 7-9: shows existing Destinations for the task's ProblemCategory
 * FIRST, before any "create new" option -- reuse is always the default
 * path, never a forced new asset. Writes `create-new` /
 * `chosen-destination-id` / `destination-type` directly onto the task's
 * own fieldValues; no separate state. */
function DestinationDecisionBlock({ instance }: { instance: TaskInstance }) {
  const { setFieldValue } = useTaskRuntimeStore();
  const { state: contentEntityState } = useContentEntityStore();

  const node = instance.contentRef?.entityType === "KNOWLEDGE_NODE" ? contentEntityState.knowledgeNodes.find((n) => n.id === instance.contentRef?.entityId) : null;
  const problemPart = node ? contentEntityState.problemParts.find((p) => p.id === node.problemPartId) : null;
  const existingDestinations: readonly Destination[] = problemPart ? destinationsForProblemCategory(contentEntityState, problemPart.problemCategoryId) : [];

  const createNew = instance.fieldValues["create-new"] === true;
  const chosenDestinationId = typeof instance.fieldValues["chosen-destination-id"] === "string" ? instance.fieldValues["chosen-destination-id"] : "";
  const destinationType = typeof instance.fieldValues["destination-type"] === "string" ? instance.fieldValues["destination-type"] : "";

  function chooseExisting(destinationId: string) {
    setFieldValue(instance.id, "create-new", false);
    setFieldValue(instance.id, "chosen-destination-id", destinationId);
  }

  if (!problemPart) {
    return <p className="text-xs text-amber-600">Content entity aniqlanmadi — “Working on” bloki Knowledge Node’ga bog’liq bo’lishi kerak.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Mavjud destination’lar ({existingDestinations.length})</p>
      <div className="space-y-2">
        {existingDestinations.map((destination) => {
          const selected = !createNew && chosenDestinationId === destination.id;
          return (
            <div key={destination.id} className={`flex items-center gap-2 rounded-lg border p-2.5 ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{destination.name}</p>
                <p className="text-[11px] text-slate-500">{destination.type} · {destination.status}</p>
              </div>
              <Button type="button" size="sm" variant={selected ? "default" : "outline"} className="h-7 shrink-0 rounded-lg text-xs" onClick={() => chooseExisting(destination.id)}>
                {selected ? "Tanlandi" : "Shu destination’ni tanlash"}
              </Button>
            </div>
          );
        })}
        {!existingDestinations.length && <p className="text-[11px] text-slate-400">Bu Problem Category uchun hali destination yo’q.</p>}
      </div>

      <div className={`rounded-lg border p-2.5 ${createNew ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <input type="checkbox" className="size-4 accent-blue-700" checked={createNew} onChange={(e) => { setFieldValue(instance.id, "create-new", e.target.checked); if (e.target.checked) setFieldValue(instance.id, "chosen-destination-id", ""); }} />
          Yangi destination yaratish
        </label>
        {createNew && (
          <label className="mt-2 block text-[11px] font-semibold text-slate-600">Destination Type
            <select value={destinationType} onChange={(e) => setFieldValue(instance.id, "destination-type", e.target.value)} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
              <option value="">Tanlang...</option>
              {DESTINATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        )}
      </div>

      {!createNew && !chosenDestinationId && <p className="text-[11px] font-medium text-amber-600">Mavjud destination tanlang yoki “Yangi destination yaratish”ni belgilang.</p>}
      {createNew && !destinationType && <p className="text-[11px] font-medium text-amber-600">Destination Type tanlanishi shart.</p>}
    </div>
  );
}

/** Section 12-14: the employee builds AtomicIdea drafts directly here --
 * this IS the "preview/review" surface for them (unlike Problem
 * Split/Knowledge Discovery's candidates, which are reviewed in a
 * separate Generated Preview after Complete). */
function RepurposeMapBlock({ instance }: { instance: TaskInstance }) {
  const { addAtomicIdeaDraft, updateAtomicIdeaDraft, removeAtomicIdeaDraft } = useTaskRuntimeStore();
  const { state: contentEntityState } = useContentEntityStore();
  const node = instance.contentRef?.entityType === "KNOWLEDGE_NODE" ? contentEntityState.knowledgeNodes.find((n) => n.id === instance.contentRef?.entityId) : null;
  const availableAngles = node ? anglesForKnowledgeNode(contentEntityState, node.id) : [];
  const coverageErrors = validateAtomicIdeaCoverage(instance.atomicIdeaDrafts);

  function toggleFormat(draft: AtomicIdeaDraft, format: MaterialFormat, checked: boolean) {
    const next = checked ? [...draft.selectedFormats, format] : draft.selectedFormats.filter((f) => f !== format);
    updateAtomicIdeaDraft(instance.id, draft.id, { selectedFormats: next });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Atomic Ideas ({instance.atomicIdeaDrafts.length})</p>
        <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => addAtomicIdeaDraft(instance.id, emptyAtomicIdeaDraft())}><Plus className="size-3.5" /> Atomic Idea</Button>
      </div>

      {instance.atomicIdeaDrafts.map((draft) => (
        <div key={draft.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-2">
            <Textarea value={draft.text} onChange={(e) => updateAtomicIdeaDraft(instance.id, draft.id, { text: e.target.value })} className="min-h-14 flex-1 bg-white text-xs" placeholder="Atomic idea matni" />
            <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-slate-400 hover:text-red-600" onClick={() => removeAtomicIdeaDraft(instance.id, draft.id)} aria-label="O’chirish"><Trash2 className="size-3.5" /></Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="text-[11px] font-semibold text-slate-600">Coverage
              <select value={draft.coverageType} onChange={(e) => updateAtomicIdeaDraft(instance.id, draft.id, { coverageType: e.target.value as AtomicIdeaDraft["coverageType"] })} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                {ATOMIC_IDEA_COVERAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-slate-600">Decision
              <select value={draft.decision} onChange={(e) => updateAtomicIdeaDraft(instance.id, draft.id, { decision: e.target.value as AtomicIdeaDraft["decision"] })} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                {ATOMIC_IDEA_DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-slate-600">Angle (ixtiyoriy)
              <select value={draft.angleId ?? ""} onChange={(e) => updateAtomicIdeaDraft(instance.id, draft.id, { angleId: e.target.value || null })} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                <option value="">Yo’q</option>
                {availableAngles.map((angle) => <option key={angle.id} value={angle.id}>{angle.title}</option>)}
              </select>
            </label>
          </div>
          {draft.decision === "CREATE_CONTENT" && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5">
                {MATERIAL_FORMATS.map((format) => {
                  const checked = draft.selectedFormats.includes(format);
                  return (
                    <label key={format} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${checked ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-500"}`}>
                      <input type="checkbox" className="size-3 accent-blue-700" checked={checked} onChange={(e) => toggleFormat(draft, format, e.target.checked)} />
                      {format}
                    </label>
                  );
                })}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <input type="checkbox" className="size-3.5 accent-blue-700" checked={draft.destinationNeeded} onChange={(e) => updateAtomicIdeaDraft(instance.id, draft.id, { destinationNeeded: e.target.checked })} />
                Destination kerak (aniq CTA keyinroq tanlanadi)
              </label>
            </div>
          )}
        </div>
      ))}
      {!instance.atomicIdeaDrafts.length && <p className="text-[11px] text-slate-400">Hali Atomic Idea yo’q. Blog’ni qayta o’qib, “Atomic Idea” tugmasi bilan qo’shing.</p>}

      {coverageErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-amber-800"><AlertTriangle className="size-4" /> Coverage to’liq emas</p>
          <ul className="mt-1.5 space-y-1 text-[11px] text-amber-700">{coverageErrors.map((error, index) => <li key={index}>• {error.message}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function TaskDetail({
  instanceId,
  onClose,
  onComplete,
  onOpenInstance,
}: {
  instanceId: string;
  onClose: () => void;
  onComplete: (instance: TaskInstance) => void;
  onOpenInstance: (instanceId: string) => void;
}) {
  const { state: contentOsState } = useContentOsStore();
  const { state: runtimeState, setStatus, addCustomField, removeCustomField, addLink, removeLink, skip, addSuggestion } = useTaskRuntimeStore();
  const { state: contentEntityState } = useContentEntityStore();
  const [skipReason, setSkipReason] = useState("");
  const [skipping, setSkipping] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const instance = runtimeState.instances.find((item) => item.id === instanceId) ?? null;
  const taskType = instance ? contentOsState.taskTypes.find((t) => t.id === instance.taskTypeId) ?? null : null;
  const template = instance?.workflowTemplateId ? contentOsState.workflowTemplates.find((t) => t.id === instance.workflowTemplateId) ?? null : null;
  const step = template && instance?.workflowStepId ? template.steps.find((s) => s.id === instance.workflowStepId) ?? null : null;
  const sourceInstance = instance?.sourceTaskId ? runtimeState.instances.find((item) => item.id === instance.sourceTaskId) ?? null : null;

  const requiredFields = useMemo(() => {
    if (!taskType) return [];
    return step ? effectiveRequiredFields(taskType.requiredFields, step) : taskType.requiredFields;
  }, [taskType, step]);

  const taskSpecificErrors: readonly CompletionValidationError[] = useMemo(() => {
    if (!instance || !taskType) return [];
    if (taskType.name === "Angle") return validateMinimumCandidateLines(instance.fieldValues["angles"] ?? null, 5, "Angles");
    if (taskType.name === "Repurpose Map") return validateAtomicIdeaCoverage(instance.atomicIdeaDrafts);
    if (taskType.name === "Destination Decision") {
      const createNew = instance.fieldValues["create-new"] === true;
      const chosen = typeof instance.fieldValues["chosen-destination-id"] === "string" ? instance.fieldValues["chosen-destination-id"] : "";
      if (!createNew && !chosen) return [{ code: "MISSING_REQUIRED_FIELD", message: "Mavjud destination tanlang yoki yangi yaratishni belgilang." }];
      if (createNew && !instance.fieldValues["destination-type"]) return [{ code: "MISSING_REQUIRED_FIELD", message: "Destination Type tanlanishi shart." }];
    }
    return [];
  }, [instance, taskType]);

  const completionErrors = useMemo(() => (instance ? [...validateTaskInstanceForCompletion(instance, requiredFields), ...taskSpecificErrors] : []), [instance, requiredFields, taskSpecificErrors]);
  const errorByFieldId = useMemo(() => new Map(completionErrors.filter((e) => e.fieldId).map((e) => [e.fieldId as string, e.message])), [completionErrors]);
  const canComplete = instance ? canCompleteTaskInstance(instance, requiredFields) && taskSpecificErrors.length === 0 : false;
  const workingOnLabel = useMemo(() => {
    if (!instance?.contentRef) return null;
    const name = labelForRef(contentEntityState, instance.contentRef);
    return name ? `${entityTypeLabelUz(instance.contentRef.entityType)}: ${name}` : null;
  }, [instance, contentEntityState]);

  if (!instance || !taskType) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Task topilmadi.</div>;
  }

  function copyPrompt() {
    if (!taskType?.defaultPrompt) return;
    void navigator.clipboard?.writeText(taskType.defaultPrompt).then(
      () => setCopyNotice("Prompt nusxalandi (INPUT bo'limi bo'sh)."),
      () => setCopyNotice("Nusxalashda xato -- promptni qo'lda ko'chiring."),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Orqaga"><ArrowLeft className="size-4" /></Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-slate-950">{instance.title}</h2>
          <p className="text-[11px] text-slate-500">{taskType.name}</p>
        </div>
        <Badge variant="outline" className={instance.status === "DONE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : instance.status === "CANCELLED" ? "border-slate-300 bg-slate-100 text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}>{instance.status}{instance.outcome === "SKIPPED" ? " · SKIPPED" : ""}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {workingOnLabel && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[.06em] text-slate-400">Working on</p>
              <p className="text-sm font-semibold text-slate-900">{workingOnLabel}</p>
            </div>
          )}

          {sourceInstance && (
            <button type="button" onClick={() => onOpenInstance(sourceInstance.id)} className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline">
              ← Manba task: {sourceInstance.title}
            </button>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-700">Status
              <select value={instance.status} onChange={(e) => setStatus(instance.id, e.target.value as typeof instance.status)} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs">
                {(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-700">Assignee
              <Input value={instance.assignee ?? "Tanlanmagan"} readOnly disabled className="mt-1 h-9 rounded-xl bg-slate-100" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-700">Deadline
              <Input type="date" value={instance.deadline ?? ""} readOnly disabled className="mt-1 h-9 rounded-xl bg-slate-100" />
              {!instance.deadline && <span className="text-[10px] font-normal text-amber-600">Preview bosqichida belgilanadi.</span>}
            </label>
          </div>

          {taskType.defaultPrompt && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[.06em] text-blue-800">Default prompt · {taskType.promptVersion}</p>
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={copyPrompt}><Copy className="size-3.5" /> Copy Prompt</Button>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{taskType.defaultPrompt}</pre>
              {copyNotice && <p className="mt-1 text-[10px] text-blue-700">{copyNotice}</p>}
            </div>
          )}

          {requiredFields.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Majburiy maydonlar</p>
              {requiredFields.map((field) => <FieldRow key={field.id} instance={instance} field={field} error={errorByFieldId.get(field.id)} />)}
            </div>
          )}

          {(() => {
            const visibleOptionalFields = taskType.name === "Destination Decision"
              ? taskType.optionalFields.filter((field) => !DESTINATION_DECISION_HIDDEN_FIELD_IDS.has(field.id))
              : taskType.optionalFields;
            return visibleOptionalFields.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Ixtiyoriy maydonlar</p>
                {visibleOptionalFields.map((field) => <FieldRow key={field.id} instance={instance} field={field} error={errorByFieldId.get(field.id)} />)}
              </div>
            );
          })()}

          {taskType.name === "Destination Decision" && <DestinationDecisionBlock instance={instance} />}
          {taskType.name === "Repurpose Map" && <RepurposeMapBlock instance={instance} />}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Custom maydonlar (faqat shu task uchun)</p>
              <AddCustomField onAdd={(field) => addCustomField(instance.id, field)} />
            </div>
            {instance.customFields.map((field) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1"><FieldRow instance={instance} field={field} error={errorByFieldId.get(field.id)} isCustom onSuggest={(f) => addSuggestion(instance.id, taskType.id, f, `"${f.label}" maydoni har bir "${taskType.name}" uchun foydali bo'lishi mumkin.`)} /></div>
                <Button type="button" variant="ghost" size="icon" className="mt-5 size-7 text-slate-400 hover:text-red-600" onClick={() => removeCustomField(instance.id, field.id)} aria-label="Custom maydonni o'chirish"><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.06em] text-slate-500"><Link2 className="size-3.5" /> Linklar</p>
            {instance.links.map((link) => (
              <div key={link.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
                <Badge variant="outline" className="shrink-0">{link.label}</Badge>
                <a href={link.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-blue-700 underline-offset-2 hover:underline">{link.url}</a>
                <Button type="button" variant="ghost" size="icon" className="size-6 text-slate-400 hover:text-red-600" onClick={() => removeLink(instance.id, link.id)} aria-label="Linkni o'chirish"><Trash2 className="size-3" /></Button>
              </div>
            ))}
            <AddLink allowedLabels={taskType.allowedLinkLabels.length ? taskType.allowedLinkLabels : ["Reference"]} onAdd={(label, url) => addLink(instance.id, { label, url })} />
          </div>

          {completionErrors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="flex items-center gap-2 text-xs font-bold text-red-800"><AlertTriangle className="size-4" /> Complete uchun {completionErrors.length} muammo bor</p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-red-700">{completionErrors.map((error, index) => <li key={index}>• {error.message}</li>)}</ul>
            </div>
          )}

          {skipping ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <label className="block text-xs font-semibold text-amber-900">Skip sababi (majburiy)
                <Textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} className="mt-1 min-h-16 bg-white text-xs" />
              </label>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" className="h-8 rounded-lg bg-amber-600 text-xs hover:bg-amber-700" disabled={!skipReason.trim()} onClick={() => { skip(instance.id, skipReason.trim()); setSkipping(false); }}>Skip tasdiqlash</Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-slate-500" onClick={() => setSkipping(false)}>Bekor qilish</Button>
              </div>
            </div>
          ) : instance.status !== "DONE" && instance.status !== "CANCELLED" ? (
            <div className="flex gap-2 pb-4">
              <Button type="button" className="rounded-xl bg-blue-700 hover:bg-blue-800" disabled={!canComplete} onClick={() => onComplete(instance)}><Check className="size-4" /> Complete</Button>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setSkipping(true)}><SkipForward className="size-4" /> Skip</Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
