"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clipboard, Copy, ExternalLink, Link2, Route, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MaterialDraftRevision } from "@/lib/material-workplan";
import type { AvailabilityState, PlacementState, StructuralState } from "@/lib/tracking-preview";
import type { TrackingPreviewFixture } from "@/lib/tracking-preview-fixtures";

type Props = {
  preview: TrackingPreviewFixture;
  currentMaterial: MaterialDraftRevision | null;
};

function stateTone(state: string) {
  if (["SYNTAX_VALID", "SUPPORTED", "PASS", "AVAILABLE"].includes(state)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["INVALID", "BLOCKED", "NON_CLICKABLE_PLACEMENT", "NO_PERMISSION"].includes(state)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (["PARTIAL", "DELAYED", "INCOMPLETE"].includes(state)) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function stateLabel(state: StructuralState | PlacementState | AvailabilityState | "PASS" | "BLOCKED" | "UNKNOWN") {
  const labels: Record<string, string> = {
    SYNTAX_VALID: "Tuzilma to‘g‘ri",
    INVALID: "Yaroqsiz",
    INCOMPLETE: "To‘liq emas",
    NOT_APPLICABLE: "Tatbiq etilmaydi",
    SUPPORTED: "Joylashuv mos",
    NON_CLICKABLE_PLACEMENT: "Bosilmaydigan joy",
    UNKNOWN: "Noma’lum",
    AVAILABLE: "Mavjud",
    NO_PERMISSION: "Ruxsat yo‘q",
    NOT_INSTRUMENTED: "O‘lchov o‘rnatilmagan",
    DELAYED: "Kechikmoqda",
    PARTIAL: "Qisman",
    PASS: "Shart o‘tgan",
    BLOCKED: "Bloklangan",
  };
  return labels[state] ?? state;
}

function percent(value: number | null) {
  return value === null ? "Noma’lum" : `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

export function TrackingWorkspace({ preview, currentMaterial }: Props) {
  const [scenarioId, setScenarioId] = useState(preview.links[0]?.scenarioId ?? "");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const urlRef = useRef<HTMLInputElement>(null);
  const scenario = useMemo(() => preview.links.find((item) => item.scenarioId === scenarioId) ?? preview.links[0], [preview.links, scenarioId]);

  async function copyUrl() {
    if (!scenario?.result.url) return;
    try {
      await navigator.clipboard.writeText(scenario.result.url);
      setCopyState("copied");
    } catch {
      urlRef.current?.focus();
      urlRef.current?.select();
      setCopyState("manual");
    }
  }

  if (!scenario) return null;
  const { result, binding, capability } = scenario;

  return <div className="space-y-4" data-testid="co-s6-tracking-workspace">
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
        <div className="flex flex-wrap items-center gap-2"><Link2 className="size-5 text-blue-700" /><Badge className="bg-blue-700 text-white">CO-S6 local preview</Badge><Badge variant="outline">SYNTHETIC</Badge><span className="ml-auto font-mono text-[10px] text-blue-700">{preview.contractVersion}</span></div>
        <h2 className="mt-3 text-lg font-bold text-slate-950">Havola va natija</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Material → kanal nashri → CTA → destination → kuzatilgan natija. Generator URLni ochmaydi, fetch qilmaydi va real analyticsga event yubormaydi.</p>
        <div className="mt-4 rounded-xl border border-blue-100 bg-white/80 p-3"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-slate-400">Joriy material konteksti</p><p className="mt-1 text-sm font-semibold text-slate-900">{currentMaterial?.titleUz || "Material tanlanmagan"}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{currentMaterial ? `${currentMaterial.draftSeriesId} · ${currentMaterial.draftRevisionId}` : "Session-only context"}</p></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white"><ShieldCheck className="size-5 text-blue-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">No-write / no-network</p><p className="mt-2 text-sm leading-6 text-slate-300">Writer, collector, redirect endpoint, analytics SDK va external URL fetch: <strong className="text-white">0</strong>.</p><p className="mt-3 font-mono text-[10px] text-slate-500">{preview.safetyMode} · execution=false</p></div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_330px]">
      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-900">Kanal va joylashuv</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Bitta materialning nashr bindinglari. Kanal o‘zgarsa research/shoot/main edit ko‘paymaydi.</p><Select value={scenario.scenarioId} onValueChange={(value) => { setScenarioId(value); setCopyState("idle"); }}><SelectTrigger className="mt-4 w-full rounded-xl shadow-none" aria-label="Tracking scenario"><SelectValue /></SelectTrigger><SelectContent>{preview.links.map((item) => <SelectItem key={item.scenarioId} value={item.scenarioId}>{item.labelUz}</SelectItem>)}</SelectContent></Select><div className="mt-4 grid gap-2 text-[11px] text-slate-600"><p><strong className="text-slate-900">Platform:</strong> {capability.platform}</p><p><strong className="text-slate-900">Format:</strong> {capability.formatCode}</p><p><strong className="text-slate-900">Placement:</strong> {capability.placement}</p><p><strong className="text-slate-900">Action:</strong> {capability.action}</p><p><strong className="text-slate-900">Attribution:</strong> {result.attributionScope}</p></div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-slate-400">Ish hajmi chegarasi</p><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold text-slate-950">{preview.materialBoundary.researchCountAfter}</p><p className="text-[9px] text-slate-500">Research</p></div><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold text-slate-950">{preview.materialBoundary.shootCountAfter}</p><p className="text-[9px] text-slate-500">Shoot</p></div><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold text-slate-950">{preview.materialBoundary.mainEditCountAfter}</p><p className="text-[9px] text-slate-500">Main edit</p></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">2 kanal niyati ishlab chiqarishni 2 marta sanamaydi.</p></div>
      </aside>

      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2"><ExternalLink className="size-5 text-blue-700" /><h3 className="font-semibold text-slate-950">Tayyor havola</h3><Badge variant="outline" className="ml-auto font-mono text-[9px]">{binding.bindingRevisionId}</Badge></div>
          {result.url ? <><div className="mt-4 flex gap-2"><Input ref={urlRef} readOnly value={result.url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 rounded-xl bg-slate-50 font-mono text-[11px] shadow-none" aria-label="Generated tracking URL" /><Button type="button" variant="outline" onClick={copyUrl} className="shrink-0 rounded-xl"><Copy className="size-4" /> Nusxalash</Button></div><p className={`mt-2 text-[11px] ${copyState === "manual" ? "text-amber-700" : copyState === "copied" ? "text-emerald-700" : "text-slate-500"}`}>{copyState === "copied" ? "Havola clipboardga nusxalandi." : copyState === "manual" ? "Clipboard ruxsati yo‘q. Matn tanlandi — Ctrl/Cmd+C bosing." : "Inert preview: bosilmaydi va avtomatik tekshirilmaydi."}</p></> : <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><Clipboard className="size-4 text-slate-500" /><p className="mt-2 text-sm font-semibold text-slate-900">{binding.ctaMode === "NATIVE" ? "Tashqi havola kerak emas" : "Havola yaratilmagan"}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{result.diagnostics[0]?.reasonUz}</p></div>}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[{ label: "Tuzilma", state: result.structuralState }, { label: "Joylashuv", state: result.placementState }, { label: "Destination", state: result.destinationState }, { label: "O‘lchov", state: result.measurementState }].map((item) => <div key={item.label} className={`rounded-xl border p-3 ${stateTone(item.state)}`}><p className="text-[9px] font-bold uppercase tracking-[.06em] opacity-70">{item.label}</p><p className="mt-1 text-[11px] font-semibold">{stateLabel(item.state)}</p></div>)}
          </div>
          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">Texnik detal va diagnostika</summary><div className="mt-3 grid gap-2 text-[10px] text-slate-600 sm:grid-cols-2"><p><strong>Token:</strong> {result.token ?? "—"}</p><p><strong>Policy:</strong> {binding.namingPolicyId}@{binding.namingPolicyVersion}</p><p><strong>Intent:</strong> {binding.publicationIntentId}</p><p><strong>Occurrence:</strong> {binding.occurrenceId}</p><p><strong>CTA:</strong> {binding.ctaVariantId}@{binding.ctaVariantVersion}</p><p><strong>Target fingerprint:</strong> {result.targetFingerprint ?? "—"}</p></div><div className="mt-3 space-y-2">{result.diagnostics.map((item) => <div key={item.code} className={`rounded-lg border px-3 py-2 ${stateTone(item.severity === "error" ? "INVALID" : item.severity === "warning" ? "PARTIAL" : "AVAILABLE")}`}><p className="font-mono text-[9px] font-bold">{item.code}</p><p className="mt-1 text-[11px]">{item.reasonUz}</p></div>)}</div></details>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5" data-testid="synthetic-route-result"><div className="flex flex-wrap items-center gap-2"><Route className="size-5 text-violet-700" /><h3 className="font-semibold text-violet-950">Namuna natijalari — real trafik emas</h3><Badge variant="outline" className="ml-auto border-violet-200 bg-white text-violet-700">OBSERVATIONAL</Badge></div><p className="mt-2 text-[12px] leading-5 text-violet-900/80">{preview.routeMetrics.plan.objectiveUz}</p><div className="mt-4 grid gap-3 md:grid-cols-2">{preview.routeMetrics.arms.map((arm) => <article key={arm.armId} className="rounded-xl border border-violet-200 bg-white p-4"><div className="flex items-center gap-2"><Badge variant="outline">{arm.armId}</Badge><strong className="text-xs text-slate-900">{arm.labelUz}</strong></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><p className="text-lg font-bold text-slate-950">{arm.visits}</p><p className="text-[9px] text-slate-500">Kirish</p></div><div><p className="text-lg font-bold text-slate-950">{arm.attempts}</p><p className="text-[9px] text-slate-500">Start</p></div><div><p className="text-lg font-bold text-slate-950">{arm.completes}</p><p className="text-[9px] text-slate-500">Natija</p></div></div><div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-600"><p>Foydali natija: <strong className="text-slate-950">{percent(arm.usefulOutcomeRate.rate)}</strong> ({arm.completes}/{arm.visits})</p><p>Attempt completion: <strong className="text-slate-950">{percent(arm.attemptCompletionRate.rate)}</strong> ({arm.completes}/{arm.attempts})</p><p>CTR: <strong>Noma’lum</strong> · Lead: <strong>Noma’lum</strong></p></div></article>)}</div><div className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-xs leading-5 text-violet-950"><strong>Xulosa:</strong> {preview.routeMetrics.experiment.conclusionUz}</div><p className="mt-3 font-mono text-[9px] text-violet-700">{preview.routeMetrics.plan.windowStart} → {preview.routeMetrics.plan.windowEnd} · {preview.routeMetrics.plan.timezone} · synthetic source</p></div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Nol va noma’lum</h3></div><p className="mt-1 text-[11px] leading-5 text-slate-500">Ruxsat, kechikish, o‘lchov yo‘qligi va haqiqiy 0 alohida.</p><div className="mt-3 space-y-2">{preview.availabilityExamples.map((item) => <div key={item.labelUz} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-900">{item.labelUz}</span><Badge variant="outline" className={`ml-auto text-[9px] ${stateTone(item.state)}`}>{stateLabel(item.state)}</Badge></div><p className="mt-1 text-[11px] text-slate-500">{item.value === null ? "Qiymat: Noma’lum" : `Qiymat: ${item.value}`} · {item.reasonUz}</p></div>)}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Dedupe fixture</h3></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold">{preview.eventDedupe.rawCount}</p><p className="text-[9px] text-slate-500">Raw</p></div><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold">{preview.eventDedupe.transportRetriesDropped + preview.eventDedupe.semanticDuplicatesDropped}</p><p className="text-[9px] text-slate-500">Dubl</p></div><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold">{preview.eventDedupe.uniqueCompletionCount}</p><p className="text-[9px] text-slate-500">Unique complete</p></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Lokal pure-array sinovi. Durable concurrency/idempotency dalili emas.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Vaqt va qayta import</h3></div><div className="mt-3 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold">{preview.snapshots.total}</p><p className="text-[9px] text-slate-500">Joriy snapshot</p></div><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-bold">{preview.snapshots.history.length}</p><p className="text-[9px] text-slate-500">Tarixiy revision</p></div></div><div className="mt-3 space-y-1 text-[11px] leading-5 text-slate-600"><p><strong>24h:</strong> {preview.checkpoints.available.at24h ?? "Noma’lum"}</p><p><strong>7d:</strong> {preview.checkpoints.available.at7d ?? "Noma’lum"}</p><p><strong>Actual publish yo‘q:</strong> {preview.checkpoints.unknown.status}</p></div><p className="mt-2 text-[10px] text-slate-500">10 + 10 retry + corrected 12 = 12; 22 emas.</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-700" /><h3 className="font-semibold text-amber-950">Ochiq production shartlari</h3></div><ul className="mt-3 space-y-2 text-[11px] leading-5 text-amber-900"><li>• Digital naming va analytics source tasdig‘i yo‘q.</li><li>• Actual destination/account/placement QA noma’lum.</li><li>• Collector, redirect va channel API ulanmagan.</li><li>• Real ikki kanal/CTA testi bajarilmagan.</li></ul></div>
      </aside>
    </section>
  </div>;
}
