"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Beaker, Blocks, BookOpenCheck, CheckCircle2,
  CircleDashed, DatabaseZap, GitBranch, Link2, RefreshCw, Route, Save, Search,
  ShieldCheck, Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssistantWorkspace } from "@/components/assistant-workspace";
import { MaterialWorkspace } from "@/components/material-workspace";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssistantContextPreviewFixture } from "@/lib/assistant-context-fixtures";
import type { MaterialWorkplanPreviewFixture } from "@/lib/material-workplan-fixtures";
import type { TrackingPreviewFixture } from "@/lib/tracking-preview-fixtures";
import type { MaterialDraftSeed } from "@/lib/material-workplan";
import type { CatalogDiagnostic, CatalogPackageItem, CatalogPreview } from "@/lib/catalog-adapter";
import type { DemoCp070Catalog, DemoMaterial } from "@/lib/catalog-fixtures";
import type { CtaDestinationPreviewFixture, DemoCtaMaterial } from "@/lib/cta-destination-fixtures";
import { CTA_ACTIONS, evaluateCtaDestination, type CtaAction, type CtaMode } from "@/lib/cta-destination";
import { formatDisplayDate } from "@/lib/scheduling-engine";

type Props = {
  preview: CatalogPreview;
  demo: DemoCp070Catalog;
  ctaPreview: CtaDestinationPreviewFixture;
  assistantPreview: AssistantContextPreviewFixture;
  materialWorkplanPreview: MaterialWorkplanPreviewFixture;
  trackingPreview: TrackingPreviewFixture;
  snapshotOrigin: "LOCAL_REGRESSION_FIXTURE" | "CONNECTOR_LIVE_READ";
  onRefresh: () => void;
  refreshing: boolean;
  lastSynced: string;
};

function normalize(value: string) {
  return value.toLocaleLowerCase("uz").replace(/[’‘`ʻʼ]/g, "'").trim();
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PLAN_APPROVED: "Reja tasdiqlangan",
    PROPOSED: "Taklif",
    ITEM_PROPOSED: "Taklif materiali",
    DRAFT: "Draft config",
    CONFIGURED: "Configured",
    UNKNOWN: "Mapping kerak",
  };
  return labels[status] ?? status;
}

function statusTone(status: string) {
  if (status === "PLAN_APPROVED") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "ITEM_PROPOSED" || status === "PROPOSED") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "DRAFT") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function diagnosticTone(item: CatalogDiagnostic) {
  if (item.severity === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  if (item.severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function MaterialCard({ item }: { item: CatalogPackageItem }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,.035)]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={statusTone(item.approvalStatus)}>{statusLabel(item.approvalStatus)}</Badge>
        <Badge variant="outline">{item.formatCode || "Format noma’lum"}</Badge>
        <span className="ml-auto font-mono text-[11px] text-slate-400">{item.packageItemId}</span>
      </div>
      <h4 className="mt-3 text-[15px] font-semibold leading-5 text-slate-950">{item.workingTitleUz}</h4>
      <div className="mt-3 grid gap-2 text-[12px] text-slate-600 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="font-semibold text-slate-900">Material:</span> {item.materialRefKind === "RUNTIME_REFERENCE" ? "Runtime reference" : "Preview reference"}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="font-semibold text-slate-900">Source:</span> {item.sourceRelation.status === "UNKNOWN_VERSION" ? "Versiya noma’lum" : "Berilmagan"}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="font-semibold text-slate-900">CTA:</span> {item.cta.state === "MAPPING_REQUIRED" ? "Mapping kerak" : item.cta.primaryType}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="font-semibold text-slate-900">Assignee:</span> {item.identityState === "UNASSIGNED" ? "Biriktirilmagan" : "Identity tekshirilmagan"}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold text-slate-500">Kanal niyatlari:</span>
        {item.publicationIntents.length ? item.publicationIntents.map((intent) => <Badge key={intent.publicationIntentId} variant="secondary">{intent.channelAccountId}</Badge>) : <span className="text-[11px] text-slate-400">yo‘q</span>}
      </div>
      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">{item.publicationIntents.length} publication intent · research/shoot/main edit kanal soniga ko‘paytirilmaydi</p>
    </article>
  );
}

function DemoMaterialCard({ item }: { item: DemoMaterial }) {
  const blocked = item.publishEligibility === "BLOCKED_TOOL_NOT_READY";
  return (
    <article className={`rounded-2xl border p-4 ${blocked ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.formatCode}</Badge><span className="font-mono text-[10px] text-slate-400">{item.materialId}</span>{blocked && <Badge className="ml-auto bg-rose-600 text-white">Destination blok</Badge>}</div>
      <h4 className="mt-2 text-sm font-semibold text-slate-950">{item.titleUz}</h4>
      <div className="mt-3 flex flex-wrap gap-1.5">{item.publicationIntents.map((intent) => <Badge key={intent.intentId} variant="secondary">{intent.channelAccountId}</Badge>)}</div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
        <p><strong className="text-slate-900">Primary CTA:</strong> {item.cta.primaryType ?? "Mapping kerak"}</p>
        <p><strong className="text-slate-900">Destination:</strong> {item.destination.destinationId ?? item.destination.destinationType}</p>
        <p><strong className="text-slate-900">Source:</strong> {item.sourceRelation.sourceEntityId ?? "Berilmagan"}</p>
        <p><strong className="text-slate-900">Source version:</strong> {item.sourceRelation.sourceVersion ?? "UNKNOWN"}</p>
      </div>
      {blocked && <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[12px] font-medium text-rose-800">TL-024 Backlog: faqat shu destinationga yo‘naltiruvchi material bloklandi. Paketdagi save CTAli karusel bloklanmadi.</p>}
    </article>
  );
}

function ctaMode(action: CtaAction | null): CtaMode | null {
  if (!action) return null;
  return ["READ_ARTICLE", "WATCH_VIDEO", "USE_TOOL", "GET_TEMPLATE"].includes(action) ? "RESOURCE" : "NATIVE";
}

function ctaLabel(action: CtaAction) {
  return action.replaceAll("_", " ");
}

function evaluationTone(gate: string) {
  if (gate === "PASS") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (gate === "BLOCKED") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function CtaWorkspace({ preview }: { preview: CtaDestinationPreviewFixture }) {
  const first = preview.materials[0];
  const [selectedMaterialId, setSelectedMaterialId] = useState(first?.materialId ?? "");
  const [action, setAction] = useState<CtaAction | null>(first?.variant.primaryAction ?? null);
  const [copyUz, setCopyUz] = useState(first?.variant.copyUz ?? "");
  const [destinationId, setDestinationId] = useState(first?.variant.destinationId ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const material = preview.materials.find((item) => item.materialId === selectedMaterialId) ?? first;
  const destination = preview.destinations.find((item) => item.destinationId === destinationId) ?? null;
  const mode = ctaMode(action);
  const variant = useMemo(() => ({
    ...material.variant,
    primaryAction: action,
    actionMode: mode,
    copyUz,
    destinationId: mode === "RESOURCE" ? destinationId || null : null,
    destinationDefinitionVersion: mode === "RESOURCE" ? destination?.definitionVersion ?? null : null,
    nativeTarget: mode === "NATIVE" ? material.variant.nativeTarget ?? material.channelId : null,
    observations: action ? [{ placement: "CAPTION" as const, action, copyUz }] : [],
  }), [action, copyUz, destination?.definitionVersion, destinationId, material, mode]);
  const evidence = preview.materials.find((item) => Boolean(
    item.readinessEvidence
    && destination
    && item.readinessEvidence.destinationId === destination.destinationId
    && item.readinessEvidence.definitionVersion === destination.definitionVersion,
  ))?.readinessEvidence ?? null;
  const capability = material.nativeCapability?.action === action ? material.nativeCapability : null;
  const evaluation = useMemo(() => evaluateCtaDestination({
    variant,
    destination,
    readinessEvidence: evidence,
    nativeCapability: capability,
  }), [capability, destination, evidence, variant]);

  function chooseMaterial(item: DemoCtaMaterial) {
    setSelectedMaterialId(item.materialId);
    setAction(item.variant.primaryAction);
    setCopyUz(item.variant.copyUz);
    setDestinationId(item.variant.destinationId ?? "");
    setSavedAt(null);
  }

  function chooseAction(next: CtaAction | null) {
    setAction(next);
    const nextMode = ctaMode(next);
    if (nextMode === "NATIVE") setDestinationId("");
    if (next === "READ_ARTICLE") setDestinationId("DEMO-ARTICLE-CP070-A");
    if (next === "USE_TOOL") setDestinationId("TL-024");
    setSavedAt(null);
  }

  return <div className="space-y-4">
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
        <div className="flex flex-wrap items-center gap-2"><Target className="size-5 text-blue-700" /><Badge className="bg-blue-700 text-white">Paket goal / route</Badge><span className="ml-auto font-mono text-[10px] text-blue-700">{preview.packageRoute.configVersion}</span></div>
        <h2 className="mt-4 text-lg font-bold tracking-[-0.02em] text-slate-950">{preview.packageRoute.coreQuestionUz}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600"><strong>Foydali natija:</strong> {preview.packageRoute.usefulOutcomeUz}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-100 bg-white px-3 py-3 text-xs"><span className="font-semibold text-slate-900">Asosiy yo‘l</span><p className="mt-1 text-blue-700">{preview.packageRoute.primaryRoute.destinationId}</p><span className="text-slate-400">Taklif · materiallarga avtomatik ko‘chmaydi</span></div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs"><span className="font-semibold text-slate-900">Muqobil yo‘l</span><p className="mt-1 text-violet-700">{preview.packageRoute.alternativeRoutes.map((item) => item.destinationId).join(", ")}</p><span className="text-slate-400">Taklif · tool readiness alohida</span></div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
        <ShieldCheck className="size-5 text-blue-300" />
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[.08em] text-slate-400">Origin va xavfsizlik</p>
        <p className="mt-1 font-mono text-xs text-blue-200">{preview.origin}</p>
        <p className="mt-3 text-sm leading-6 text-slate-300">Lokal fixture. Sheet, backend, task, schedule va publication yozuvlari: <strong className="text-white">0</strong>.</p>
        <p className="mt-3 font-mono text-[10px] text-slate-500">{preview.contractVersion}</p>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
      <aside className="space-y-2">
        <div className="mb-3"><h3 className="font-semibold text-slate-950">Material / test versiyasi</h3><p className="mt-1 text-xs text-slate-500">Bitta asset ko‘p CTA variantida qayta ishlatilishi mumkin.</p></div>
        {preview.materials.map((item) => <button key={item.materialId} type="button" onClick={() => chooseMaterial(item)} className={`w-full rounded-2xl border p-4 text-left transition ${item.materialId === material.materialId ? "border-blue-300 bg-blue-50 shadow-[0_8px_20px_rgba(37,99,235,.08)]" : "border-slate-200 bg-white hover:border-blue-200"}`}>
          <div className="flex items-center gap-2"><Badge variant="outline">{item.formatCode}</Badge><Badge variant="secondary">{item.channelId}</Badge></div>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">{item.titleUz}</p>
          <p className="mt-2 font-mono text-[10px] text-slate-400">{item.baseAssetId}</p>
          <div className="mt-3 flex items-center gap-2 text-[11px]"><span className={`size-2 rounded-full ${item.evaluation.ctaDestinationGate === "PASS" ? "bg-emerald-500" : item.evaluation.ctaDestinationGate === "BLOCKED" ? "bg-rose-500" : "bg-amber-500"}`} /><span className="font-semibold text-slate-600">{item.evaluation.ctaDestinationGate}</span><span className="text-slate-400">{item.variant.primaryAction}</span></div>
        </button>)}
      </aside>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2"><Route className="size-5 text-blue-700" /><h3 className="font-semibold text-slate-950">Primary CTA selector</h3><Badge variant="outline" className="ml-auto font-mono text-[10px]">{variant.ctaVariantId} · {variant.version}</Badge></div>
        <p className="mt-2 text-xs leading-5 text-slate-500">Bu tahrir faqat brauzer sessiyasida. “Saqlash” Sheet yoki backendga yozmaydi.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-xs font-semibold text-slate-700"><span>Primary action</span>
            <Select value={action ?? "EMPTY"} onValueChange={(value) => chooseAction(value === "EMPTY" ? null : value as CtaAction)}><SelectTrigger className="h-10 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EMPTY">Tanlanmagan — draft</SelectItem>{CTA_ACTIONS.map((item) => <SelectItem key={item} value={item}>{ctaLabel(item)}</SelectItem>)}</SelectContent></Select>
          </label>
          <div className="space-y-2 text-xs font-semibold text-slate-700"><span>Yo‘l turi</span><div className="flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] text-slate-600">{mode ?? "UNKNOWN"}</div></div>
          <label className="space-y-2 text-xs font-semibold text-slate-700 sm:col-span-2"><span>CTA iborasi</span><Input value={copyUz} onChange={(event) => { setCopyUz(event.target.value); setSavedAt(null); }} placeholder="Bitta asosiy chaqiriq…" className="h-10 rounded-xl shadow-none" /></label>
          {mode === "RESOURCE" ? <label className="space-y-2 text-xs font-semibold text-slate-700 sm:col-span-2"><span>Destination + pinned definition</span><Select value={destinationId || "NONE"} onValueChange={(value) => { setDestinationId(value === "NONE" ? "" : value ?? ""); setSavedAt(null); }}><SelectTrigger className="h-10 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Manzil tanlanmagan</SelectItem>{preview.destinations.map((item) => <SelectItem key={item.destinationId} value={item.destinationId}>{item.destinationId} · {item.definitionVersion} · {item.type}</SelectItem>)}</SelectContent></Select></label> : <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 sm:col-span-2"><strong>Native target:</strong> {variant.nativeTarget ?? "Ko‘rsatilmagan"}<br /><span className="text-slate-400">External URL talab qilinmaydi; kanal/format imkoniyati alohida tekshiriladi.</span></div>}
        </div>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
          <div className="grid gap-2 sm:grid-cols-2"><p><strong className="text-slate-900">Material:</strong> {material.materialId} @ {variant.materialVersion ?? "UNKNOWN"}</p><p><strong className="text-slate-900">Intent:</strong> {material.binding.publicationIntentId}</p><p><strong className="text-slate-900">Binding:</strong> {material.binding.bindingRevisionId}</p><p><strong className="text-slate-900">Base asset:</strong> {material.baseAssetId}</p></div>
        </div>
        <Button type="button" onClick={() => setSavedAt(new Date().toISOString())} className="mt-4 rounded-xl bg-blue-700 hover:bg-blue-800"><Save className="size-4" /> Lokal draftni saqlash</Button>
        {savedAt && <p className="mt-2 text-xs font-medium text-blue-700">Lokal sessiyada saqlandi · Sheet/backend o‘zgarmadi.</p>}
      </div>

      <aside className="space-y-3">
        <div className={`rounded-2xl border p-4 ${evaluationTone(evaluation.ctaDestinationGate)}`}>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] opacity-70">CTA / destination gate</p>
          <p className="mt-2 text-xl font-bold">{evaluation.ctaDestinationGate === "PASS" ? "CTA/manzil sharti o‘tdi" : evaluation.ctaDestinationGate === "BLOCKED" ? "Bloklangan" : "Ma’lumot yetishmaydi"}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-lg bg-white/70 px-2 py-2"><span className="block opacity-60">Contract</span><strong>{evaluation.contractValidation}</strong></div><div className="rounded-lg bg-white/70 px-2 py-2"><span className="block opacity-60">Readiness</span><strong>{evaluation.destinationReadiness}</strong></div><div className="rounded-lg bg-white/70 px-2 py-2"><span className="block opacity-60">Boshqa checks</span><strong>{evaluation.otherChecks}</strong></div><div className="rounded-lg bg-white/70 px-2 py-2"><span className="block opacity-60">Execution</span><strong>FALSE</strong></div></div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-slate-950">Diagnostika</h4><div className="mt-3 space-y-2">{evaluation.diagnostics.map((item) => <div key={item.code} className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-mono text-[10px] font-bold text-slate-500">{item.code}</p><p className="mt-1 text-xs leading-5 text-slate-700">{item.reasonUz}</p></div>)}</div>{!evaluation.diagnostics.length && <p className="mt-3 text-xs text-slate-400">Diagnostika yo‘q.</p>}</div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>Chegara:</strong> gate PASS bo‘lsa ham creative approval, source, workflow, identity va release shartlari baholandi degani emas.</div>
      </aside>
    </section>
  </div>;
}

export function TopicPackages({ preview, demo, ctaPreview, assistantPreview, materialWorkplanPreview, trackingPreview, snapshotOrigin, onRefresh, refreshing, lastSynced }: Props) {
  const [mode, setMode] = useState<"snapshot" | "catalog" | "cta" | "assistant" | "workplan">("workplan");
  const [incomingMaterialSeed, setIncomingMaterialSeed] = useState<MaterialDraftSeed | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("TP-202610-02");
  const [selectedDemoAngle, setSelectedDemoAngle] = useState(demo.angles[0]?.angleId ?? "");
  const packageItemsByPlan = useMemo(() => {
    const map = new Map<string, CatalogPackageItem[]>();
    for (const item of preview.packageItems) map.set(item.packagePlanId, [...(map.get(item.packagePlanId) ?? []), item]);
    return map;
  }, [preview.packageItems]);
  const visiblePackages = useMemo(() => preview.packagePlans.filter((plan) => {
    if (!query.trim()) return true;
    const itemText = (packageItemsByPlan.get(plan.packagePlanId) ?? []).map((item) => `${item.packageItemId} ${item.workingTitleUz} ${item.formatCode}`).join(" ");
    return normalize(`${plan.packagePlanId} ${plan.topicUz} ${plan.clusterId} ${plan.mainNodeId} ${itemText}`).includes(normalize(query));
  }), [packageItemsByPlan, preview.packagePlans, query]);
  const selectedPackage = preview.packagePlans.find((item) => item.packagePlanId === selectedPackageId) ?? visiblePackages[0] ?? preview.packagePlans[0];
  const selectedItems = selectedPackage ? (packageItemsByPlan.get(selectedPackage.packagePlanId) ?? []).toSorted((a, b) => (a.itemOrder ?? 999) - (b.itemOrder ?? 999)) : [];
  const selectedWorkflowIds = new Set(selectedItems.map((item) => item.workflowId));
  const selectedWorkflows = preview.workflowPreviews.filter((workflow) => selectedWorkflowIds.has(workflow.workflowId));
  const selectedAngle = demo.angles.find((angle) => angle.angleId === selectedDemoAngle) ?? demo.angles[0];
  const demoMaterials = demo.materials.filter((item) => item.angleId === selectedAngle?.angleId);
  const diagnosticSummary = useMemo(() => Object.entries(preview.diagnostics.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {})), [preview.diagnostics]);
  const metricCards: Array<{ label: string; value: string | number; hint: string; Icon: LucideIcon }> = [
    { label: "Tasdiqlangan reja", value: preview.metrics.approvedPackagePlans, hint: "material approval emas", Icon: BookOpenCheck },
    { label: "Taklif reja", value: preview.metrics.proposedPackagePlans, hint: "faol ishlab chiqarish emas", Icon: CircleDashed },
    { label: "Tanlangan material", value: preview.metrics.activeSelectedMaterials, hint: `${preview.packageItems.length} ta o‘qildi`, Icon: Blocks },
    { label: "Kanal niyati", value: preview.metrics.publicationIntentCount, hint: "haqiqiy nashr emas", Icon: Link2 },
    { label: "Real task nomzodi", value: preview.metrics.runtimeTaskCandidateCount, hint: "CO-S2 safety mode", Icon: ShieldCheck },
    { label: "Backend real task", value: preview.metrics.backendRealTaskCount ?? "Noma’lum", hint: preview.metrics.backendState === "UNAVAILABLE" ? "ulanmagan" : "projection", Icon: DatabaseZap },
  ];

  return <div className="h-full overflow-y-auto bg-[#F7F9FC]">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
        <div className="mr-auto"><div className="flex items-center gap-2"><h1 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">Mavzu katalogi</h1><Badge className="bg-blue-700 text-white">CO-S6 preview</Badge></div><p className="mt-0.5 text-[12px] text-slate-500">Katalog → CTA → yordamchi → material → workplan → o‘lchash · production yozuvi o‘chiq</p></div>
        <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" onClick={() => setMode("workplan")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "workplan" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Material & reja</button>
          <button type="button" onClick={() => setMode("assistant")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "assistant" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Yordamchilar</button>
          <button type="button" onClick={() => setMode("cta")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "cta" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>CTA lab</button>
          <button type="button" onClick={() => setMode("catalog")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "catalog" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Angle katalog</button>
          <button type="button" onClick={() => setMode("snapshot")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "snapshot" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Sheet snapshot</button>
        </div>
        <div className="relative min-w-[240px] max-w-[390px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Paket, material, ID yoki sarlavha…" className="h-10 rounded-xl bg-slate-50 pl-9 shadow-none" /></div>
        <Button variant="outline" className="h-10 rounded-xl" onClick={onRefresh} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Yangilash</Button>
        <span className="text-[11px] text-slate-400">{formatDisplayDate(lastSynced, true)}</span>
      </div>
    </header>

    <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map(({ label, value, hint, Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4"><Icon className="size-4 text-blue-700" /><p className="mt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</p><p className="mt-1 text-xl font-bold tracking-[-0.03em] text-slate-950">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>)}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-950">
        <ShieldCheck className="size-5 text-blue-700" /><strong>Server-side no-write:</strong><span>task, migration, notification, schedule, publish va ads writerlari ulanmagan.</span>
        <Badge variant="outline" className="ml-auto border-blue-200 bg-white font-mono text-[10px] text-blue-700">{mode === "snapshot" ? snapshotOrigin : mode === "catalog" ? "DEMO_CP070" : mode === "assistant" ? assistantPreview.origin : mode === "workplan" ? materialWorkplanPreview.origin : ctaPreview.origin}</Badge>
        <span className="font-mono text-[10px] text-blue-700">{preview.adapterVersion} · {preview.sourceSnapshot.hash} · {preview.configManifest.hash}</span>
      </section>

      <div className={mode === "workplan" ? "block" : "hidden"}><MaterialWorkspace preview={materialWorkplanPreview} ctaPreview={ctaPreview} trackingPreview={trackingPreview} incomingSeed={incomingMaterialSeed} onIncomingConsumed={() => setIncomingMaterialSeed(null)} /></div>
      <div className={mode === "assistant" ? "block" : "hidden"}><AssistantWorkspace preview={assistantPreview} onTakeToMaterial={(seed) => { setIncomingMaterialSeed(seed); setMode("workplan"); }} /></div>
      {mode === "snapshot" ? <section className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)_360px]">
        <aside className="space-y-2">
          <div className="mb-3"><h2 className="font-semibold text-slate-950">Paket rejalari</h2><p className="mt-1 text-sm text-slate-500">Status domen bo‘yicha normalizatsiya qilindi.</p></div>
          {visiblePackages.map((plan) => <button key={plan.packagePlanId} type="button" onClick={() => setSelectedPackageId(plan.packagePlanId)} className={`w-full rounded-2xl border p-4 text-left transition ${selectedPackage?.packagePlanId === plan.packagePlanId ? "border-blue-300 bg-blue-50 shadow-[0_8px_24px_rgba(37,99,235,.08)]" : "border-slate-200 bg-white hover:border-blue-200"}`}>
            <div className="flex items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-400">{plan.packagePlanId}</span><Badge variant="outline" className={`ml-auto ${statusTone(plan.planningStatus)}`}>{statusLabel(plan.planningStatus)}</Badge></div>
            <h3 className="mt-2 text-sm font-semibold leading-5 text-slate-950">{plan.topicUz}</h3>
            <p className="mt-2 text-[11px] text-slate-500">{packageItemsByPlan.get(plan.packagePlanId)?.length ?? 0} material · {plan.clusterId} · {plan.mainNodeId}</p>
          </button>)}
        </aside>

        <div className="min-w-0 space-y-4">
          {selectedPackage && <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={statusTone(selectedPackage.planningStatus)}>{statusLabel(selectedPackage.planningStatus)}</Badge><Badge variant="outline">{selectedPackage.primaryArea}</Badge><span className="ml-auto font-mono text-[11px] text-slate-400">{selectedPackage.provenance.sourceRange}</span></div>
            <h2 className="mt-3 text-xl font-bold tracking-[-0.025em] text-slate-950">{selectedPackage.topicUz}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{selectedPackage.packageObjectiveUz}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><Badge variant="secondary">Reja tasdig‘i</Badge><ArrowRight className="size-4 text-slate-300" /><Badge variant="outline">Material tanlovi alohida</Badge><ArrowRight className="size-4 text-slate-300" /><Badge variant="outline">Creative approval alohida</Badge></div>
          </div>}
          <div><div className="mb-3 flex items-end justify-between"><div><h3 className="font-semibold text-slate-950">Materiallar</h3><p className="mt-1 text-sm text-slate-500">Material va kanal nashri bir xil entity emas.</p></div><Badge variant="secondary">{selectedItems.length}</Badge></div><div className="grid gap-3 2xl:grid-cols-2">{selectedItems.map((item) => <MaterialCard key={item.packageItemId} item={item} />)}</div></div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><GitBranch className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Workflow preview</h3></div><p className="mt-1 text-[12px] text-slate-500">Employee task emas; Draft config runtimega qo‘llanmaydi.</p><div className="mt-3 space-y-3">{selectedWorkflows.map((workflow) => <div key={workflow.workflowId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2"><strong className="text-xs text-slate-900">{workflow.workflowId}</strong><Badge variant="outline" className="ml-auto border-amber-200 bg-amber-50 text-amber-700">{workflow.releaseBlocked ? "Release blok" : "Preview"}</Badge></div><p className="mt-2 text-[11px] text-slate-600">{workflow.steps.length} qadam · executable: yo‘q</p></div>)}</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" /><h3 className="font-semibold text-slate-950">Diagnostika</h3></div><div className="mt-3 flex flex-wrap gap-2">{diagnosticSummary.map(([category, count]) => <Badge key={category} variant="outline">{category.replaceAll("_", " ")} · {count}</Badge>)}</div><div className="mt-3 max-h-[430px] space-y-2 overflow-y-auto pr-1">{preview.diagnostics.filter((item) => item.entityId === selectedPackage?.packagePlanId || selectedItems.some((material) => material.packageItemId === item.entityId) || ["CONFIG_RELEASE_BLOCK", "RUNTIME_UNAVAILABLE", "SAFETY_MODE"].includes(item.category)).slice(0, 18).map((item, index) => <div key={`${item.code}-${item.entityId}-${index}`} className={`rounded-xl border px-3 py-2 ${diagnosticTone(item)}`}><p className="text-[10px] font-bold uppercase tracking-[.05em]">{item.code}</p><p className="mt-1 text-[11px] leading-4">{item.reasonUz}</p><p className="mt-1 font-mono text-[9px] opacity-70">{item.sourceRange}</p></div>)}</div></div>
        </aside>
      </section> : mode === "catalog" ? <section className="space-y-4">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950"><div className="flex items-center gap-2"><Beaker className="size-5 text-violet-700" /><strong>DEMO fixture — productionga yozilmaydi</strong><Badge variant="outline" className="ml-auto border-violet-200 bg-white text-violet-700">CP-070 · CL-024</Badge></div><p className="mt-2 text-sm leading-6 text-violet-900/80">{demo.canonicalProblem.titleUz}. {demo.canonicalProblem.evidenceBoundaryUz}</p></div>
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-3"><h2 className="font-semibold text-slate-950">Mustaqil anglelar</h2>{demo.angles.map((angle) => <button key={angle.angleId} type="button" onClick={() => setSelectedDemoAngle(angle.angleId)} className={`w-full rounded-2xl border p-4 text-left ${selectedAngle?.angleId === angle.angleId ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white"}`}><span className="font-mono text-[10px] text-slate-400">{angle.angleId}</span><h3 className="mt-2 text-sm font-semibold text-slate-950">{angle.questionUz}</h3><p className="mt-2 text-[12px] leading-5 text-slate-600">{angle.outcomeUz}</p><div className="mt-3 flex flex-wrap gap-1">{angle.candidateNodeIds.map((id) => <Badge key={id} variant="outline">{id}</Badge>)}</div></button>)}</aside>
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">Learning order</p><p className="mt-2 font-mono text-sm text-blue-700">{demo.learningOrder.join(" → ")}</p><p className="mt-2 text-[11px] text-slate-500">Tavsiya etilgan o‘rganish ketma-ketligi.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">Publication order fixture</p><p className="mt-2 font-mono text-sm text-violet-700">{demo.publicationOrder.join(" → ")}</p><p className="mt-2 text-[11px] text-slate-500">B oldin chiqsa ham learning A → B saqlanadi.</p></div></div>
            {selectedAngle && <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{selectedAngle.angleId}</Badge><Badge variant="secondary">YouTube: {demo.youtubeDecisions.find((item) => item.angleId === selectedAngle.angleId)?.decision}</Badge></div><h2 className="mt-3 text-lg font-bold text-slate-950">{selectedAngle.questionUz}</h2><p className="mt-2 text-sm text-slate-600"><strong>Chegara:</strong> {selectedAngle.boundaryUz}</p><p className="mt-2 text-sm text-slate-600"><strong>Natija:</strong> {selectedAngle.outcomeUz}</p></div>}
            <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-slate-950">Materiallar va kanal niyatlari</h3><p className="mt-1 text-sm text-slate-500">Bir short · uch kanal · bitta ishlab chiqarish materiali.</p></div><Badge variant="secondary">{demoMaterials.length}</Badge></div><div className="grid gap-3 2xl:grid-cols-2">{demoMaterials.map((item) => <DemoMaterialCard key={item.materialId} item={item} />)}</div></div>
          </div>
        </div>
      </section> : mode === "cta" ? <CtaWorkspace preview={ctaPreview} /> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><CheckCircle2 className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Alohida status domenlari</h3><p className="mt-1 text-sm leading-6 text-slate-600">Reja tasdig‘i material tanlovi, creative approval yoki Published emas.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><GitBranch className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Alohida relationlar</h3><p className="mt-1 text-sm leading-6 text-slate-600">Learning, related, source va production dependency bir-biriga avtomatik aylantirilmaydi.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><ShieldCheck className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Xavfsiz preview</h3><p className="mt-1 text-sm leading-6 text-slate-600">Draft/inactive/proposed konfiguratsiya ko‘rinadi, lekin real task va nashr yaratmaydi.</p></div>
      </section>
    </main>
  </div>;
}
