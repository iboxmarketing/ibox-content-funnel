"use client";

/**
 * Extra Task Detail panels for Task Types whose runtime handler names a
 * `uiBlock` (lib/task-runtime-handlers.ts). TaskDetail looks a panel up by
 * that key here -- it never inspects a Task Type name itself. Adding a
 * new special panel means one component + one entry in TASK_UI_BLOCKS.
 */
import type { ComponentType } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import { useContentEntityStore } from "@/components/content-entity-store-provider";
import { anglesForKnowledgeNode, destinationsForProblemCategory, problemCategoryIdForMaterial } from "@/lib/content-entity-store";
import { ATOMIC_IDEA_COVERAGE_TYPES, ATOMIC_IDEA_DECISIONS, DESTINATION_TYPES, MATERIAL_FORMATS, type Destination, type MaterialFormat } from "@/lib/content-entity";
import { emptyAtomicIdeaDraft, validateAtomicIdeaCoverage, type AtomicIdeaDraft, type TaskInstance } from "@/lib/task-instance";
import { isExactDestinationRequired } from "@/lib/material-production";
import { CTA_TYPES, type CtaType } from "@/lib/content-entity";
import type { TaskUiBlockKey } from "@/lib/task-runtime-handlers";

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


/** Sprint 5 sections 4-5: exact Destination selection for an authoring
 * task's Material, from the SAME ProblemCategory's Destination Library.
 * PLANNED / IN_PROGRESS / READY are all selectable -- destination creation
 * runs in parallel and the READY gate belongs to a future Publish rule.
 * The CTA type/text themselves are ordinary Task Type fields. */
function MaterialCtaBlock({ instance }: { instance: TaskInstance }) {
  const { setFieldValue } = useTaskRuntimeStore();
  const { state } = useContentEntityStore();
  const material = instance.contentRef?.entityType === "MATERIAL" ? state.materials.find((m) => m.id === instance.contentRef?.entityId) ?? null : null;
  if (!material) return null;
  const categoryId = problemCategoryIdForMaterial(state, material);
  const destinations: readonly Destination[] = categoryId ? destinationsForProblemCategory(state, categoryId) : [];
  const ctaType = typeof instance.fieldValues["cta-type"] === "string" && instance.fieldValues["cta-type"] ? (instance.fieldValues["cta-type"] as CtaType) : null;
  const chosen = typeof instance.fieldValues["cta-destination-id"] === "string" ? instance.fieldValues["cta-destination-id"] : "";
  const required = isExactDestinationRequired(material.destinationNeeded, ctaType);

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">CTA Destination</p>
      {!material.destinationNeeded ? (
        <p className="text-[11px] text-slate-500">Bu Material uchun Destination kerak emas (Repurpose Map’da belgilangan). Ixtiyoriy tanlash mumkin.</p>
      ) : (
        <p className="text-[11px] text-slate-500">{required ? "Bu CTA turi uchun aniq Destination majburiy." : "Bu CTA turi uchun Destination majburiy emas."}</p>
      )}
      <select value={chosen} onChange={(e) => setFieldValue(instance.id, "cta-destination-id", e.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
        <option value="">Destination yo’q</option>
        {destinations.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.status}</option>)}
      </select>
      {chosen && (() => {
        const selected = destinations.find((d) => d.id === chosen);
        return selected ? <Badge variant="outline" className="text-[10px]">Destination holati: {selected.status}</Badge> : null;
      })()}
      <p className="text-[10px] text-slate-400">CTA turlari: {CTA_TYPES.join(", ")}</p>
    </div>
  );
}

export const TASK_UI_BLOCKS: Readonly<Record<TaskUiBlockKey, ComponentType<{ instance: TaskInstance }>>> = {
  DESTINATION_DECISION: DestinationDecisionBlock,
  REPURPOSE_MAP: RepurposeMapBlock,
  MATERIAL_CTA: MaterialCtaBlock,
};
