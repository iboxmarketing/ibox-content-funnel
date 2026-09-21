"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Blocks,
  Bot,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePlus2,
  GitCompareArrows,
  GripVertical,
  History,
  LayoutDashboard,
  Save,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { TrackingWorkspace } from "@/components/tracking-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CtaDestinationPreviewFixture } from "@/lib/cta-destination-fixtures";
import { CTA_ACTIONS, type CtaAction, type YoutubeDecision } from "@/lib/cta-destination";
import type { MaterialWorkplanPreviewFixture } from "@/lib/material-workplan-fixtures";
import type { TrackingPreviewFixture } from "@/lib/tracking-preview-fixtures";
import {
  acceptDemoWorkItem,
  archiveMaterialDraft,
  calculateWorkPlan,
  calculateWorkPlanDelta,
  createMaterialDraft,
  reviseMaterialDraft,
  simulateWorkItemMove,
  type CompletionEvidence,
  type MaterialDraftRevision,
  type MaterialDraftSeed,
  type WorkColumn,
  type WorkItem,
} from "@/lib/material-workplan";

type Props = {
  preview: MaterialWorkplanPreviewFixture;
  ctaPreview: CtaDestinationPreviewFixture;
  trackingPreview: TrackingPreviewFixture;
  incomingSeed: MaterialDraftSeed | null;
  onIncomingConsumed: () => void;
};

type ViewMode = "builder" | "plan" | "board" | "tasks" | "tracking";

const FORMATS: MaterialDraftSeed["formatCode"][] = ["ARTICLE", "CAROUSEL", "TEXT_POST", "SHORT_VIDEO", "LONG_VIDEO", "STATIC", "TOOL"];
const COLUMNS: Array<{ id: WorkColumn; label: string; hint: string }> = [
  { id: "PLANNED", label: "Rejada", hint: "Boshlash mumkin yoki dependency kutmoqda" },
  { id: "IN_PROGRESS", label: "Bajarilmoqda", hint: "Demo persona qabul qilgan ish" },
  { id: "REVIEW", label: "Tekshiruvda", hint: "Versiyalangan review" },
  { id: "DONE", label: "Bajarilgan", hint: "Faqat lokal completion simulyatsiyasi" },
];

const PERSONAS = [
  { employeeId: "DEMO_CM_A", name: "Demo CM A", role: "Content marketer", origin: "DEMO_PERSONA" as const },
  { employeeId: "DEMO_CM_B", name: "Demo CM B", role: "Content marketer", origin: "DEMO_PERSONA" as const },
  { employeeId: "DEMO_OPERATOR", name: "Demo Operator", role: "Operator / Montajer", origin: "DEMO_PERSONA" as const },
  { employeeId: "DEMO_HEAD", name: "Demo Head", role: "Head", origin: "DEMO_PERSONA" as const },
];

function expectedMode(action: CtaAction | null) {
  if (!action) return null;
  return ["READ_ARTICLE", "WATCH_VIDEO", "USE_TOOL", "GET_TEMPLATE"].includes(action) ? "RESOURCE" as const : "NATIVE" as const;
}

function seedFromDraft(draft: MaterialDraftRevision): MaterialDraftSeed {
  return {
    seedId: draft.seedId,
    origin: draft.origin,
    packageRef: draft.packageRef,
    angleRef: draft.angleRef,
    assistantResultRef: draft.assistantResultRef,
    contextFingerprint: draft.contextFingerprint,
    titleUz: draft.titleUz,
    questionUz: draft.questionUz,
    outcomeUz: draft.outcomeUz,
    formatCode: draft.formatCode,
    structureUz: draft.structureUz,
    sourceEntityId: draft.sourceEntityId,
    sourceVersion: draft.sourceVersion,
    primaryCta: draft.primaryCta,
    ctaMode: draft.ctaMode,
    ctaCopyUz: draft.ctaCopyUz,
    destinationId: draft.destinationId,
    destinationDefinitionVersion: draft.destinationDefinitionVersion,
    nativeTarget: draft.nativeTarget,
    publicationIntents: draft.publicationIntents,
    authorIds: draft.authorIds,
    selected: draft.selected,
  };
}

function draftTone(draft: MaterialDraftRevision) {
  if (draft.state === "ARCHIVED_LOCAL") return "border-slate-200 bg-slate-50 text-slate-500";
  if (draft.state === "SELECTED_LOCAL") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function helperTone(state: WorkItem["helperState"]) {
  if (state === "MAPPED_PROPOSED") return "border-violet-200 bg-violet-50 text-violet-800";
  if (state === "EXISTING_BRIDGE") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function contextFor(seed: MaterialDraftSeed, ctaPreview: CtaDestinationPreviewFixture) {
  const destination = ctaPreview.destinations.find((item) => item.destinationId === seed.destinationId) ?? null;
  const readinessEvidence = ctaPreview.materials.find((item) => item.readinessEvidence?.destinationId === seed.destinationId)?.readinessEvidence ?? null;
  const observedCapability = ctaPreview.materials.find((item) => item.formatCode === seed.formatCode && item.variant.primaryAction === seed.primaryCta)?.nativeCapability ?? null;
  const nativeCapability = seed.ctaMode === "NATIVE" && seed.primaryCta ? observedCapability ?? {
    channelId: seed.publicationIntents[0]?.channelId ?? "CURRENT_PUBLICATION",
    formatCode: seed.formatCode,
    action: seed.primaryCta,
    supported: true,
    analyticsCount: null,
    evidenceOrigin: "FIXTURE" as const,
  } : null;
  return { destination, readinessEvidence, nativeCapability };
}

function WorkCard({ item, column, assignee, onSelect, onDragBegin, onDragFinish }: { item: WorkItem; column: WorkColumn; assignee: string | null; onSelect: () => void; onDragBegin: () => void; onDragFinish: () => void }) {
  const blocked = item.condition !== "TRUE";
  return <button
    type="button"
    draggable
    onDragStart={(event) => { event.dataTransfer.setData("text/plain", item.candidateKey); onDragBegin(); }}
    onDragEnd={onDragFinish}
    onPointerDown={onDragBegin}
    onClick={onSelect}
    className="group w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_2px_8px_rgba(15,23,42,.04)] transition hover:border-blue-300 hover:shadow-[0_8px_24px_rgba(37,99,235,.08)]"
    data-work-key={item.candidateKey}
  >
    <div className="flex items-start gap-2"><GripVertical className="mt-0.5 size-4 shrink-0 text-slate-300 group-hover:text-blue-500" /><p className="min-w-0 flex-1 text-xs font-semibold leading-5 text-slate-950">{item.titleUz}</p></div>
    <div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="outline" className="text-[9px]">{item.role}</Badge><Badge variant="outline" className={`text-[9px] ${blocked ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{blocked ? "Nimani kutmoqda" : column === "PLANNED" ? "Boshlash mumkin" : column}</Badge></div>
    <div className="mt-3 grid gap-1 text-[10px] text-slate-500"><span>{assignee ?? "Biriktirilmagan"}</span><span className="font-mono">{item.stepId} · {item.taskTemplateId ?? "NO-TT"}</span><span>{item.estimateMinutes === null ? "Estimate noma’lum" : `${item.estimateMinutes} daqiqa`}</span></div>
  </button>;
}

export function MaterialWorkspace({ preview, ctaPreview, trackingPreview, incomingSeed, onIncomingConsumed }: Props) {
  const [view, setView] = useState<ViewMode>("builder");
  const [drafts, setDrafts] = useState<MaterialDraftRevision[]>(() => structuredClone(preview.candidates));
  const [history, setHistory] = useState<MaterialDraftRevision[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState(preview.candidates[0]?.draftSeriesId ?? "");
  const [form, setForm] = useState<MaterialDraftSeed>(() => seedFromDraft(preview.candidates[0]));
  const [sessionFinished, setSessionFinished] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("Session-only preview · real material/task 0");
  const [youtubeDecision, setYoutubeDecision] = useState<YoutubeDecision>(preview.youtubeDecision);
  const [personaId, setPersonaId] = useState(PERSONAS[0].employeeId);
  const [columns, setColumns] = useState<Record<string, WorkColumn>>({});
  const [assignees, setAssignees] = useState<Record<string, string | null>>({});
  const [evidence, setEvidence] = useState<Record<string, CompletionEvidence>>({});
  const [selectedWorkKey, setSelectedWorkKey] = useState<string | null>(null);
  const [draggingWorkKey, setDraggingWorkKey] = useState<string | null>(null);
  const sequence = useRef(10);
  const selectedDraft = drafts.find((item) => item.draftSeriesId === selectedSeriesId) ?? drafts[0];
  const persona = PERSONAS.find((item) => item.employeeId === personaId) ?? PERSONAS[0];

  const workplan = useMemo(() => calculateWorkPlan({
    drafts,
    youtubeDecision,
    mappings: preview.mappings,
    sharedResearchScope: { scopeId: "DEMO-PKG-CP070@selection-r1", sourceEntityId: preview.package.sourceArticleId, sourceVersion: preview.package.sourceArticleVersion },
  }), [drafts, preview.mappings, preview.package.sourceArticleId, preview.package.sourceArticleVersion, youtubeDecision]);
  const delta = useMemo(() => calculateWorkPlanDelta(preview.initialWorkplan, workplan), [preview.initialWorkplan, workplan]);
  const selectedWork = workplan.items.find((item) => item.candidateKey === selectedWorkKey) ?? null;
  const currentEvidence = selectedWork ? evidence[selectedWork.candidateKey] ?? { outputPresent: false, requiredChecklistCompleted: false, condition: selectedWork.condition } : null;
  const selectedCount = drafts.filter((item) => item.selected && item.state !== "ARCHIVED_LOCAL").length;

  function chooseDraft(draft: MaterialDraftRevision) {
    setSelectedSeriesId(draft.draftSeriesId);
    setForm(seedFromDraft(draft));
  }

  function saveDraft() {
    if (!selectedDraft) return;
    const context = contextFor(form, ctaPreview);
    const revision = reviseMaterialDraft(selectedDraft, form, context);
    setHistory((current) => [...current, revision.previous]);
    setDrafts((current) => current.map((item) => item.draftSeriesId === revision.revised.draftSeriesId ? revision.revised : item));
    setForm(seedFromDraft(revision.revised));
    setSessionNotice("Shu sessiyadagi qoralama saqlandi · Sheet/backend o‘zgarmadi.");
  }

  function toggleSelected(draft: MaterialDraftRevision) {
    const seed = { ...seedFromDraft(draft), selected: !draft.selected };
    const revision = reviseMaterialDraft(draft, seed, contextFor(seed, ctaPreview));
    setHistory((current) => [...current, revision.previous]);
    setDrafts((current) => current.map((item) => item.draftSeriesId === draft.draftSeriesId ? revision.revised : item));
    if (draft.draftSeriesId === selectedSeriesId) setForm(seedFromDraft(revision.revised));
    setSessionFinished(false);
  }

  function addBlank() {
    const seed: MaterialDraftSeed = {
      seedId: `CO-S5-LOCAL-${sequence.current++}`,
      origin: "CO_S5_PROPOSAL",
      packageRef: preview.package.packageRef,
      angleRef: preview.package.angleRef,
      assistantResultRef: null,
      contextFingerprint: null,
      titleUz: "",
      questionUz: "",
      outcomeUz: "",
      formatCode: "CAROUSEL",
      structureUz: "",
      sourceEntityId: preview.package.sourceArticleId,
      sourceVersion: preview.package.sourceArticleVersion,
      primaryCta: null,
      ctaMode: null,
      ctaCopyUz: "",
      destinationId: null,
      destinationDefinitionVersion: null,
      nativeTarget: null,
      publicationIntents: [],
      authorIds: [persona.employeeId],
      selected: false,
    };
    const draft = createMaterialDraft(seed);
    setDrafts((current) => [...current, draft]);
    chooseDraft(draft);
    setSessionFinished(false);
  }

  function consumeIncoming() {
    if (!incomingSeed) return;
    const existing = drafts.find((item) => item.seedId === incomingSeed.seedId);
    if (existing) {
      chooseDraft(existing);
    } else {
      const draft = createMaterialDraft(incomingSeed, contextFor(incomingSeed, ctaPreview));
      setDrafts((current) => [...current, draft]);
      chooseDraft(draft);
    }
    onIncomingConsumed();
    setSessionNotice("Assistant natijasi material qoralamasiga olindi · approval/task yaratilmagan.");
  }

  function archiveSelected() {
    if (!selectedDraft) return;
    const revision = archiveMaterialDraft(selectedDraft);
    setHistory((current) => [...current, revision.previous]);
    setDrafts((current) => current.map((item) => item.draftSeriesId === selectedDraft.draftSeriesId ? revision.revised : item));
    setForm(seedFromDraft(revision.revised));
    setSessionNotice("Lokal variant arxivlandi; old revision va reference o‘qiladigan qoldi.");
  }

  function moveWorkItem(item: WorkItem, target: WorkColumn) {
    const proof = evidence[item.candidateKey] ?? { outputPresent: false, requiredChecklistCompleted: false, condition: item.condition };
    const result = simulateWorkItemMove({ ...item, column: columns[item.candidateKey] ?? item.column }, target, proof);
    if (result.allowed) setColumns((current) => ({ ...current, [item.candidateKey]: result.nextColumn }));
    setSessionNotice(result.allowed ? `${item.titleUz}: ${target} — faqat demo holati.` : `${item.titleUz}: ko‘chirish rad etildi — ${result.reasonUz}`);
  }

  function finishPointerDrag(target: WorkColumn) {
    if (!draggingWorkKey) return;
    const item = workplan.items.find((candidate) => candidate.candidateKey === draggingWorkKey);
    if (item && (columns[item.candidateKey] ?? item.column) !== target) moveWorkItem(item, target);
    setDraggingWorkKey(null);
  }

  function acceptSelectedWork() {
    if (!selectedWork) return;
    const result = acceptDemoWorkItem(selectedWork, persona);
    if (result.accepted) {
      setAssignees((current) => ({ ...current, [selectedWork.candidateKey]: result.employeeId }));
      setColumns((current) => ({ ...current, [selectedWork.candidateKey]: "IN_PROGRESS" }));
    }
    setSessionNotice(result.accepted ? `${persona.name} demo ishni qabul qildi · backend yozuvi 0.` : `Qabul qilinmadi: ${result.code}. Tasodifiy fallback yo‘q.`);
  }

  const visibleItems = view === "tasks" ? workplan.items.filter((item) => assignees[item.candidateKey] === persona.employeeId) : workplan.items;

  return <div className="space-y-4" data-testid="co-s5-workspace">
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
        <div className="flex flex-wrap items-center gap-2"><Blocks className="size-5 text-blue-700" /><Badge className="bg-blue-700 text-white">CO-S5 local proposal</Badge><Badge variant="outline">{preview.package.angleRef}</Badge><span className="ml-auto font-mono text-[10px] text-blue-700">{preview.contractVersion}</span></div>
        <h2 className="mt-3 text-lg font-bold text-slate-950">{preview.package.questionUz}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600"><strong>Foydali natija:</strong> {preview.package.outcomeUz}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><Badge variant="outline">Source: {preview.package.sourceArticleId}@{preview.package.sourceArticleVersion}</Badge><Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{preview.package.sourceStatus}</Badge><Badge variant="outline">Backend task: Noma’lum</Badge></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white"><ShieldCheck className="size-5 text-blue-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">No-write boundary</p><p className="mt-2 text-sm leading-6 text-slate-300">Session-only qoralama va simulyatsiya. Material, task, review, notification, schedule va publication writerlari: <strong className="text-white">0</strong>.</p><p className="mt-3 font-mono text-[10px] text-slate-500">{preview.safetyMode}</p></div>
    </section>

    {incomingSeed && <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950" data-testid="incoming-assistant-result"><Bot className="size-5 text-violet-700" /><div className="mr-auto"><strong>Assistant natijasi qoralamaga tayyor</strong><p className="mt-1 text-xs text-violet-800/80">{incomingSeed.assistantResultRef} · explicit user amalisiz task/approval yaratilmaydi.</p></div><Button type="button" onClick={consumeIncoming} className="rounded-xl bg-violet-700 hover:bg-violet-800"><FilePlus2 className="size-4" /> Material qoralamasiga olish</Button></section>}

    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-1">
        {([[
          "builder", "Material tanlash", FilePlus2,
        ], ["plan", "Ishlar rejasi", ClipboardList], ["board", "Demo Kanban", LayoutDashboard], ["tasks", "My Tasks demo", UserCheck], ["tracking", "Havola va natija", GitCompareArrows]] as Array<[ViewMode, string, typeof FilePlus2]>).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setView(id)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${view === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}><Icon className="size-4" />{label}</button>)}
      </div>
      <Badge variant="outline" className="ml-auto">Tanlangan: {selectedCount}</Badge><Badge variant="outline">Simulated work: {workplan.simulatedWorkItemCount}</Badge><Badge variant="outline">Real task: Noma’lum</Badge>
    </section>

    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-900" role="status">{sessionNotice}</div>

    {view === "builder" && <section className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)_330px]">
      <aside className="space-y-2"><div className="mb-3"><h3 className="font-semibold text-slate-950">Material nomzodlari</h3><p className="mt-1 text-xs leading-5 text-slate-500">Boshlang‘ich demo: 3 variantdan 2 tanlov. Yangi qoralama qo‘shilishi mumkin; qat’iy format yoki son kvotasi yo‘q.</p></div>{drafts.map((draft) => <article key={draft.draftSeriesId} className={`rounded-2xl border p-3 ${selectedSeriesId === draft.draftSeriesId ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}><button type="button" onClick={() => chooseDraft(draft)} className="w-full text-left"><div className="flex items-center gap-2"><Badge variant="outline" className={draftTone(draft)}>{draft.state}</Badge><span className="ml-auto font-mono text-[9px] text-slate-400">r{draft.revision}</span></div><p className="mt-2 text-sm font-semibold leading-5 text-slate-950">{draft.titleUz || "Nomsiz qoralama"}</p><p className="mt-2 text-[10px] text-slate-500">{draft.formatCode} · {draft.ctaContract} · {draft.ctaGate}</p></button><label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-200/70 pt-3 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.selected && draft.state !== "ARCHIVED_LOCAL"} disabled={draft.state === "ARCHIVED_LOCAL"} onChange={() => toggleSelected(draft)} className="size-4 accent-blue-700" /> Lokal scope’ga tanlash</label></article>)}</aside>

      {selectedDraft && <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center gap-2"><FilePlus2 className="size-5 text-blue-700" /><h3 className="font-semibold text-slate-950">Material qoralamasi</h3><Badge variant="outline" className="ml-auto font-mono text-[9px]">{selectedDraft.draftRevisionId}</Badge></div><p className="mt-2 text-xs text-slate-500">Tahrir oldingi revisionni hard-delete qilmaydi. Save production approval emas.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Sarlavha<Input value={form.titleUz} onChange={(event) => setForm((current) => ({ ...current, titleUz: event.target.value }))} className="mt-1.5 rounded-xl shadow-none" /></label><label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Mustaqil savol<Textarea value={form.questionUz} onChange={(event) => setForm((current) => ({ ...current, questionUz: event.target.value }))} className="mt-1.5 min-h-20 rounded-xl shadow-none" /></label><label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Va’da qilingan foyda<Textarea value={form.outcomeUz} onChange={(event) => setForm((current) => ({ ...current, outcomeUz: event.target.value }))} className="mt-1.5 min-h-20 rounded-xl shadow-none" /></label><label className="space-y-1.5 text-xs font-semibold text-slate-700">Format<Select value={form.formatCode} onValueChange={(value) => setForm((current) => ({ ...current, formatCode: value as MaterialDraftSeed["formatCode"] }))}><SelectTrigger className="mt-1.5 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent>{FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5 text-xs font-semibold text-slate-700">Primary CTA<Select value={form.primaryCta ?? "EMPTY"} onValueChange={(value) => { const action = value === "EMPTY" ? null : value as CtaAction; const mode = expectedMode(action); setForm((current) => ({ ...current, primaryCta: action, ctaMode: mode, destinationId: mode === "NATIVE" ? null : current.destinationId, destinationDefinitionVersion: mode === "NATIVE" ? null : current.destinationDefinitionVersion, nativeTarget: mode === "NATIVE" ? current.nativeTarget ?? "CURRENT_PUBLICATION" : null })); }}><SelectTrigger className="mt-1.5 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EMPTY">Tanlanmagan — draft</SelectItem>{CTA_ACTIONS.map((action) => <SelectItem key={action} value={action}>{action}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Format rejasi / structure<Textarea value={form.structureUz} onChange={(event) => setForm((current) => ({ ...current, structureUz: event.target.value }))} className="mt-1.5 min-h-24 rounded-xl shadow-none" /></label><label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">CTA iborasi<Input value={form.ctaCopyUz} onChange={(event) => setForm((current) => ({ ...current, ctaCopyUz: event.target.value }))} className="mt-1.5 rounded-xl shadow-none" /></label>{form.ctaMode === "RESOURCE" && <label className="space-y-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Destination<Select value={form.destinationId ?? "NONE"} onValueChange={(value) => { const destination = ctaPreview.destinations.find((item) => item.destinationId === value); setForm((current) => ({ ...current, destinationId: value === "NONE" ? null : value, destinationDefinitionVersion: destination?.definitionVersion ?? null })); }}><SelectTrigger className="mt-1.5 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Tanlanmagan</SelectItem>{ctaPreview.destinations.map((destination) => <SelectItem key={destination.destinationId} value={destination.destinationId}>{destination.destinationId} · {destination.lifecycleStatus}</SelectItem>)}</SelectContent></Select></label>}</div>
        <div className="mt-5 flex flex-wrap gap-2"><Button type="button" onClick={saveDraft} className="rounded-xl bg-blue-700 hover:bg-blue-800"><Save className="size-4" /> Qoralamani saqlash</Button><Button type="button" variant="outline" onClick={addBlank} className="rounded-xl"><FilePlus2 className="size-4" /> Yana qo‘shish</Button><Button type="button" variant="outline" onClick={archiveSelected} className="rounded-xl"><Archive className="size-4" /> Arxivlash</Button></div>
      </div>}

      <aside className="space-y-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><Eye className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Selection status</h3></div><div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-xl bg-blue-50 p-3"><strong className="block text-xl text-blue-700">{selectedCount}</strong>lokal tanlov</div><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-xl text-slate-700">0</strong>real task</div></div><Button type="button" onClick={() => { setSessionFinished(true); setSessionNotice("Tanlash tugatildi · qolgan variantlar avtomatik tanlanmadi."); }} className="mt-4 w-full rounded-xl bg-slate-950 hover:bg-slate-800">Tanlashni tugatish <ArrowRight className="size-4" /></Button>{sessionFinished && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Session scope belgilandi. Bu production scope approvali emas.</p>}</div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><History className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Revision tarixi</h3><Badge variant="outline" className="ml-auto">{history.length}</Badge></div><div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{history.slice().reverse().map((item) => <div key={item.draftRevisionId} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs font-semibold text-slate-800">{item.titleUz || "Nomsiz qoralama"}</p><p className="mt-1 font-mono text-[9px] text-slate-400">{item.draftRevisionId}</p></div>)}{!history.length && <p className="text-xs text-slate-400">Hali old revision yo‘q.</p>}</div></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-amber-800">YouTube qarori</p><Select value={youtubeDecision.decision} onValueChange={(value) => setYoutubeDecision((current) => ({ ...current, decision: value as YoutubeDecision["decision"], reasonUz: `Lokal demo qarori: ${value}` }))}><SelectTrigger className="mt-3 w-full rounded-xl bg-white shadow-none"><SelectValue /></SelectTrigger><SelectContent>{["PENDING", "YES", "NO"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-xs leading-5 text-amber-900">NO faqat long yo‘li. Short va YouTube Posts mustaqil.</p></div>
      </aside>
    </section>}

    {view === "tracking" && <TrackingWorkspace preview={trackingPreview} currentMaterial={selectedDraft ?? null} />}

    {view === "plan" && <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="space-y-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center gap-2"><ClipboardList className="size-5 text-blue-700" /><h3 className="font-semibold text-slate-950">Derived workplan</h3><Badge variant="outline" className="ml-auto font-mono text-[9px]">{workplan.projectionId}</Badge></div><p className="mt-2 text-xs text-slate-500">Raw v2 references saqlanadi; grouping real tasklarni o‘chirmaydi yoki workloadni kamaytirib ko‘rsatmaydi.</p></div>{workplan.items.map((item) => <article key={item.candidateKey} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.groupUz}</Badge><Badge variant="outline">{item.role}</Badge><Badge variant="outline" className={helperTone(item.helperState)}>{item.helperId ?? "UNMAPPED"}</Badge><span className="ml-auto font-mono text-[9px] text-slate-400">{item.stepId} · {item.taskTemplateId}</span></div><h4 className="mt-3 text-sm font-semibold text-slate-950">{item.titleUz}</h4><div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><p><strong>Output:</strong> {item.requiredOutputUz ?? "Berilmagan"}</p><p><strong>Estimate:</strong> {item.estimateMinutes ?? "Noma’lum"}</p><p><strong>Dependency:</strong> {item.dependencies.length || "yo‘q"}</p><p><strong>Executable:</strong> yo‘q · Draft config</p></div><p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{item.whyUz}</p></article>)}</div><aside className="space-y-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><GitCompareArrows className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Scope delta</h3></div><div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-xl bg-emerald-50 p-3"><strong className="block text-lg text-emerald-700">{delta.added.length}</strong>added</div><div className="rounded-xl bg-rose-50 p-3"><strong className="block text-lg text-rose-700">{delta.removedFromProposal.length}</strong>removed proposal</div><div className="rounded-xl bg-amber-50 p-3"><strong className="block text-lg text-amber-700">{delta.affected.length}</strong>affected</div><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-lg text-slate-700">{delta.unchanged.length}</strong>unchanged</div></div><p className="mt-3 text-xs text-slate-500">Existing runtime changed: 0. Completed/locked/published/history auto-change yo‘q.</p></div><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-amber-950">Mapping diagnostikasi</h3><div className="mt-3 space-y-2">{preview.mappingDiagnostics.map((item) => <div key={item.code} className="rounded-xl bg-white/70 px-3 py-2"><p className="font-mono text-[9px] font-bold text-amber-800">{item.code}</p><p className="mt-1 text-xs leading-5 text-amber-900">{item.reasonUz}</p></div>)}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600"><strong>Text policy:</strong><p className="mt-1">Effective: {preview.textPolicy.effective}</p><p className="mt-1 text-amber-700">Variant B: {preview.textPolicy.proposalB}; default emas.</p></div></aside></section>}

    {(view === "board" || view === "tasks") && <section className="space-y-4"><div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4"><LayoutDashboard className="size-5 text-violet-700" /><div className="mr-auto"><h3 className="font-semibold text-violet-950">Private demo · backend My Tasks emas</h3><p className="mt-1 text-xs text-violet-800/80">Board bitta workplan projectionidan. REAL task count: Noma’lum.</p></div><label className="min-w-56 text-xs font-semibold text-violet-900">Demo persona<Select value={personaId} onValueChange={(value) => setPersonaId(value ?? PERSONAS[0].employeeId)}><SelectTrigger className="mt-1.5 w-full rounded-xl bg-white shadow-none"><SelectValue /></SelectTrigger><SelectContent>{PERSONAS.map((item) => <SelectItem key={item.employeeId} value={item.employeeId}>{item.name} · {item.role}</SelectItem>)}</SelectContent></Select></label></div>
      {view === "tasks" && !visibleItems.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Bu demo personaga lokal qabul qilingan ish yo‘q. Real My Tasks ma’lumoti ulanmagan.</div>}
      {view === "board" ? <div className="grid min-w-[1040px] gap-3 overflow-x-auto xl:grid-cols-4">{COLUMNS.map((column) => <div key={column.id} onDragOver={(event) => event.preventDefault()} onPointerUp={() => finishPointerDrag(column.id)} onDrop={(event) => { const key = event.dataTransfer.getData("text/plain") || draggingWorkKey; const item = workplan.items.find((candidate) => candidate.candidateKey === key); if (item) moveWorkItem(item, column.id); setDraggingWorkKey(null); }} className="min-h-[420px] rounded-2xl border border-slate-200 bg-slate-100/70 p-3" data-column={column.id}><div className="mb-3"><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-950">{column.label}</h3><Badge variant="secondary" className="ml-auto">{workplan.items.filter((item) => (columns[item.candidateKey] ?? item.column) === column.id).length}</Badge></div><p className="mt-1 text-[10px] text-slate-500">{column.hint}</p></div><div className="space-y-2">{workplan.items.filter((item) => (columns[item.candidateKey] ?? item.column) === column.id).map((item) => <WorkCard key={item.candidateKey} item={item} column={column.id} assignee={assignees[item.candidateKey] ?? null} onSelect={() => setSelectedWorkKey(item.candidateKey)} onDragBegin={() => setDraggingWorkKey(item.candidateKey)} onDragFinish={() => setDraggingWorkKey(null)} />)}</div></div>)}</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleItems.map((item) => <WorkCard key={item.candidateKey} item={item} column={columns[item.candidateKey] ?? item.column} assignee={assignees[item.candidateKey] ?? null} onSelect={() => setSelectedWorkKey(item.candidateKey)} onDragBegin={() => setDraggingWorkKey(item.candidateKey)} onDragFinish={() => setDraggingWorkKey(null)} />)}</div>}
      {selectedWork && currentEvidence && <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 xl:grid-cols-[minmax(0,1fr)_330px]"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{selectedWork.role}</Badge><Badge variant="outline" className={helperTone(selectedWork.helperState)}>{selectedWork.helperId ?? "UNMAPPED"}</Badge><span className="font-mono text-[9px] text-slate-400">{selectedWork.candidateKey}</span></div><h3 className="mt-3 text-lg font-bold text-slate-950">{selectedWork.titleUz}</h3><p className="mt-2 text-sm text-slate-600">{selectedWork.whyUz}</p><div className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><strong>Required output</strong><p className="mt-1 text-slate-600">{selectedWork.requiredOutputUz ?? "yo‘q"}</p></div><div className="rounded-xl bg-slate-50 p-3"><strong>Checklist</strong><p className="mt-1 text-slate-600">{selectedWork.requiredChecklistIds.join(", ") || "yo‘q"}</p></div><div className="rounded-xl bg-slate-50 p-3"><strong>Deadline</strong><p className="mt-1 text-slate-600">Committed: {selectedWork.committedDeadline ?? "noma’lum"}</p></div><div className="rounded-xl bg-slate-50 p-3"><strong>Helper/usul</strong><p className="mt-1 text-slate-600">{selectedWork.helperId ?? "Exact mapping yo‘q"}</p></div></div></div><aside className="space-y-3"><div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-semibold text-slate-900">Completion dalili — demo</p><label className="mt-3 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={currentEvidence.outputPresent} onChange={(event) => setEvidence((current) => ({ ...current, [selectedWork.candidateKey]: { ...currentEvidence, outputPresent: event.target.checked } }))} className="size-4 accent-blue-700" /> Required output mavjud</label><label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={currentEvidence.requiredChecklistCompleted} onChange={(event) => setEvidence((current) => ({ ...current, [selectedWork.candidateKey]: { ...currentEvidence, requiredChecklistCompleted: event.target.checked } }))} className="size-4 accent-blue-700" /> Required checklist tugallangan</label></div><Button type="button" onClick={acceptSelectedWork} className="w-full rounded-xl bg-violet-700 hover:bg-violet-800"><UserCheck className="size-4" /> Demo qabul qilish</Button><Button type="button" variant="outline" onClick={() => moveWorkItem(selectedWork, "DONE")} className="w-full rounded-xl"><CheckCircle2 className="size-4" /> Bajarilgan’ga o‘tkazish</Button><p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Drag ham shu completion evaluatoridan o‘tadi. Done material Approved/Published degani emas.</p></aside></div>}
    </section>}

    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><ShieldCheck className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Authority ajratilgan</h3><p className="mt-1 text-sm leading-6 text-slate-600">Knowledge/config Sheetda; operational task/review kelajakdagi mavjud backendda.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><GitCompareArrows className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Stable candidate key</h3><p className="mt-1 text-sm leading-6 text-slate-600">Title/reorder task identity yaratmaydi; scope/step/revision namespace ishlatiladi.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><AlertTriangle className="size-5 text-amber-600" /><h3 className="mt-3 font-semibold text-slate-950">Hali production emas</h3><p className="mt-1 text-sm leading-6 text-slate-600">Durable draft, real identity, config release va Site–Mini App E2E ochiq qoladi.</p></div></section>
  </div>;
}
