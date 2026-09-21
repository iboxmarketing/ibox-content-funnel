"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Clipboard,
  ClipboardCheck,
  ExternalLink,
  FileWarning,
  GitMerge,
  Link2Off,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildPromptAndContext,
  buildAssistantContextEnvelope,
  compareResultContext,
  createManualAssistantResult,
  mergeManualAssistantResults,
  resolveHelperLink,
  reviseManualAssistantResult,
  serializeAssistantContext,
  type AssistantMode,
  type ManualAssistantResult,
} from "@/lib/assistant-context";
import type { AssistantContextPreviewFixture } from "@/lib/assistant-context-fixtures";
import { CTA_ACTIONS, type CtaAction } from "@/lib/cta-destination";
import type { MaterialDraftSeed } from "@/lib/material-workplan";

type Props = {
  preview: AssistantContextPreviewFixture;
  onTakeToMaterial?: (seed: MaterialDraftSeed) => void;
};

const MODES: Array<{ id: AssistantMode; label: string; hint: string }> = [
  { id: "CREATE", label: "Yaratish", hint: "Draft/variant" },
  { id: "REVIEW", label: "Tekshirish", hint: "Maslahat, approval emas" },
  { id: "IDEATE", label: "Ijodiy taklif", hint: "Tanlanmagan g‘oya" },
];

function instructionTone(state: string) {
  if (state === "APPROVED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function sourceTone(state: string) {
  if (state === "CURRENT") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "STALE_RECHECK") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function AssistantWorkspace({ preview, onTakeToMaterial }: Props) {
  const [assistantId, setAssistantId] = useState("AI-05");
  const [scenarioId, setScenarioId] = useState("FULL");
  const [mode, setMode] = useState<AssistantMode>("CREATE");
  const [showContext, setShowContext] = useState(true);
  const [manualText, setManualText] = useState("");
  const [results, setResults] = useState<ManualAssistantResult[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "context" | "prompt" | "fallback">("idle");
  const [fallbackText, setFallbackText] = useState("");
  const sequence = useRef(1);
  const assistant = preview.registry.find((item) => item.assistantId === assistantId) ?? preview.registry[0];
  const scenario = preview.scenarios.find((item) => item.scenarioId === scenarioId) ?? preview.scenarios[0];
  const envelope = useMemo(() => buildAssistantContextEnvelope({ ...scenario.input, assistantId: assistant.assistantId, instructionVersion: assistant.instructionVersion, mode }), [assistant.assistantId, assistant.instructionVersion, mode, scenario.input]);
  const link = useMemo(() => resolveHelperLink(assistant), [assistant]);
  const contextText = useMemo(() => serializeAssistantContext(envelope), [envelope]);
  const promptText = useMemo(() => buildPromptAndContext(assistant, envelope, preview.commonPrompt), [assistant, envelope, preview.commonPrompt]);
  const currentResults = results.filter((item) => item.contextFingerprint === envelope.contextFingerprint);
  const selectedCurrentCount = currentResults.filter((item) => item.selected).length;

  async function copyText(text: string, success: "context" | "prompt") {
    setFallbackText("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API mavjud emas");
      await navigator.clipboard.writeText(text);
      setCopyState(success);
    } catch {
      setFallbackText(text);
      setCopyState("fallback");
    }
  }

  function addResult() {
    const result = createManualAssistantResult({ resultId: `LOCAL-RESULT-${sequence.current}`, envelope, text: manualText });
    if (!result) return;
    sequence.current += 1;
    setResults((current) => [...current, result]);
    setManualText("");
  }

  function updateResult(resultId: string, text: string, selected?: boolean) {
    setResults((current) => current.map((item) => item.resultId === resultId ? reviseManualAssistantResult(item, text, selected ?? item.selected) : item));
  }

  function mergeSelected() {
    const merged = mergeManualAssistantResults({ resultId: `LOCAL-RESULT-${sequence.current}`, results, envelope });
    if (!merged) return;
    sequence.current += 1;
    setResults((current) => [...current, merged]);
  }

  function openHelper() {
    if (!link.openable || !link.url) return;
    window.open(link.url, "_blank", "noopener,noreferrer");
  }

  function takeToMaterial(item: ManualAssistantResult) {
    if (!onTakeToMaterial) return;
    const primaryCta = CTA_ACTIONS.includes(envelope.exportProjection.cta.primaryAction as CtaAction)
      ? envelope.exportProjection.cta.primaryAction as CtaAction
      : null;
    const formatCode = assistant.assistantId === "AI-02" ? "ARTICLE"
      : assistant.assistantId === "AI-03" ? "LONG_VIDEO"
        : assistant.assistantId === "AI-04" ? "SHORT_VIDEO"
          : assistant.assistantId === "AI-05" ? "CAROUSEL"
            : assistant.assistantId === "AI-07" ? "TOOL"
              : "TEXT_POST";
    const firstLine = item.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Assistantdan olingan qoralama";
    const mode = primaryCta && ["READ_ARTICLE", "WATCH_VIDEO", "USE_TOOL", "GET_TEMPLATE"].includes(primaryCta) ? "RESOURCE" : primaryCta ? "NATIVE" : null;
    onTakeToMaterial({
      seedId: `assistant:${item.resultId}:${item.contextFingerprint}`,
      origin: "CO_S5_PROPOSAL",
      packageRef: "DEMO-PKG-CP070",
      angleRef: envelope.exportProjection.business.angleRef ?? "UNMAPPED_ANGLE",
      assistantResultRef: item.resultId,
      contextFingerprint: item.contextFingerprint,
      titleUz: firstLine.slice(0, 140),
      questionUz: envelope.exportProjection.business.questionUz,
      outcomeUz: envelope.exportProjection.business.outcomeUz,
      formatCode,
      structureUz: item.text,
      sourceEntityId: envelope.exportProjection.source.sourceEntityId,
      sourceVersion: envelope.exportProjection.source.pinnedVersion,
      primaryCta,
      ctaMode: mode,
      ctaCopyUz: envelope.exportProjection.cta.copyUz ?? "",
      destinationId: mode === "RESOURCE" ? envelope.exportProjection.destination.destinationId : null,
      destinationDefinitionVersion: mode === "RESOURCE" ? envelope.exportProjection.destination.definitionVersion : null,
      nativeTarget: mode === "NATIVE" ? envelope.exportProjection.destination.nativeTarget : null,
      publicationIntents: [],
      authorIds: [],
      selected: true,
    });
  }

  return <div className="space-y-4">
    <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_330px]">
      <aside className="space-y-2">
        <div className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2"><Bot className="size-5 text-blue-700" /><strong className="text-sm text-blue-950">8 yordamchi registry</strong></div>
          <p className="mt-2 text-xs leading-5 text-blue-900/75">7 draft prompt + AI-06 existing-helper bridge. Real GPT/account yaratilmagan.</p>
        </div>
        {preview.registry.map((item) => <button
          key={item.assistantId}
          type="button"
          onClick={() => { setAssistantId(item.assistantId); setCopyState("idle"); setFallbackText(""); }}
          className={`w-full rounded-2xl border p-4 text-left transition ${item.assistantId === assistant.assistantId ? "border-blue-300 bg-blue-50 shadow-[0_8px_20px_rgba(37,99,235,.08)]" : "border-slate-200 bg-white hover:border-blue-200"}`}
          aria-pressed={item.assistantId === assistant.assistantId}
        >
          <div className="flex items-center gap-2"><span className="font-mono text-[10px] font-bold text-blue-700">{item.assistantId}</span><Badge variant="outline" className="ml-auto text-[9px]">{item.ownerRole}</Badge></div>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">{item.nameUz}</p>
          <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-slate-500">{item.goalUz}</p>
          <div className="mt-3 flex items-center gap-2"><span className="size-2 rounded-full bg-amber-500" /><span className="text-[10px] font-semibold text-amber-800">{item.methodStatus}</span></div>
        </button>)}
      </aside>

      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-5 text-blue-700" />
            <Badge className="bg-blue-700 text-white">{assistant.assistantId}</Badge>
            <Badge variant="outline" className={instructionTone(assistant.instructionState)}>{assistant.instructionState}</Badge>
            <span className="ml-auto font-mono text-[10px] text-slate-400">{assistant.instructionVersion}</span>
          </div>
          <h2 className="mt-3 text-xl font-bold tracking-[-0.025em] text-slate-950">{assistant.nameUz}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{assistant.goalUz}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {assistant.stepsUz.map((step, index) => <div key={step} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><span className="font-mono text-[10px] font-bold text-blue-700">0{index + 1}</span><p className="mt-1 text-[11px] font-medium leading-4 text-slate-700">{step}</p></div>)}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900"><strong>Mos misol</strong><p className="mt-1">{assistant.examples.goodUz}</p></div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900"><strong>Kamchilikli misol</strong><p className="mt-1">{assistant.examples.badUz}</p></div>
          </div>
          <div className="mt-4"><p className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">O‘zini tekshirish</p><div className="mt-2 grid gap-2 md:grid-cols-3">{assistant.selfCheckUz.map((item) => <div key={item} className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-700"><Check className="mt-0.5 size-3.5 shrink-0 text-blue-700" />{item}</div>)}</div></div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3"><div><h3 className="font-semibold text-slate-950">Rejim va kontekst</h3><p className="mt-1 text-xs text-slate-500">Mode yoki pinned input o‘zgarsa yangi fingerprint hosil bo‘ladi.</p></div><Badge variant="outline" className="ml-auto font-mono text-[9px]">{envelope.contextFingerprint}</Badge></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="grid gap-2 sm:grid-cols-3">{MODES.map((item) => <button key={item.id} type="button" onClick={() => { setMode(item.id); setCopyState("idle"); }} aria-pressed={mode === item.id} className={`rounded-xl border px-3 py-3 text-left ${mode === item.id ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200"}`}><span className="block text-xs font-bold">{item.label}</span><span className="mt-1 block text-[10px] opacity-70">{item.hint}</span></button>)}</div>
            <label className="space-y-1.5 text-xs font-semibold text-slate-700"><span>Source/gate ssenariysi</span><Select value={scenarioId} onValueChange={(value) => { setScenarioId(value ?? "FULL"); setCopyState("idle"); }}><SelectTrigger className="h-11 w-full rounded-xl shadow-none"><SelectValue /></SelectTrigger><SelectContent>{preview.scenarios.map((item) => <SelectItem key={item.scenarioId} value={item.scenarioId}>{item.labelUz}</SelectItem>)}</SelectContent></Select></label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setShowContext((value) => !value)}><FileWarning className="size-4" /> {showContext ? "Kontekstni yopish" : "Kontekstni ko‘rish"}</Button>
            <Button type="button" className="rounded-xl bg-blue-700 hover:bg-blue-800" onClick={() => void copyText(promptText, "prompt")}><Clipboard className="size-4" /> Yo‘riqnoma + kontekst</Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => void copyText(contextText, "context")}><Clipboard className="size-4" /> Faqat kontekst</Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={openHelper} disabled={!link.openable}><ExternalLink className="size-4" /> Yordamchini ochish</Button>
          </div>
          {copyState === "prompt" && <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700"><ClipboardCheck className="size-4" /> Yo‘riqnoma va filtered context nusxalandi.</p>}
          {copyState === "context" && <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700"><ClipboardCheck className="size-4" /> Filtered context nusxalandi.</p>}
          {copyState === "fallback" && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Clipboard ruxsati olinmadi. Quyidagi matnni qo‘lda nusxalang.</p><Textarea readOnly value={fallbackText} onFocus={(event) => event.currentTarget.select()} className="mt-2 min-h-28 bg-white font-mono text-[10px]" aria-label="Qo‘lda nusxalash matni" /></div>}

          {showContext && <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-slate-100"><div className="flex items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-[.07em] text-slate-400">Filtered export preview</span><Badge variant="outline" className="ml-auto border-slate-700 text-[9px] text-slate-300">{envelope.sourceCoverage}</Badge></div><pre className="mt-3 max-h-[370px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-slate-300">{contextText}</pre></div>
            <aside className="space-y-2"><div className={`rounded-xl border p-3 ${sourceTone(envelope.freshness)}`}><p className="text-[10px] font-bold uppercase tracking-[.06em]">Source freshness</p><p className="mt-1 text-sm font-bold">{envelope.freshness}</p><p className="mt-1 text-[11px]">Pinned: {envelope.exportProjection.source.pinnedVersion ?? "UNKNOWN"}</p></div>{envelope.diagnostics.map((item) => <div key={item.code} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="font-mono text-[9px] font-bold text-slate-500">{item.code}</p><p className="mt-1 text-[11px] leading-4 text-slate-700">{item.reasonUz}</p></div>)}</aside>
          </div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start gap-3"><div><h3 className="font-semibold text-slate-950">Natijani qo‘lda kiritish</h3><p className="mt-1 text-xs leading-5 text-slate-500">Oddiy untrusted matn. HTML/script bajarilmaydi; status yoki approval yozilmaydi.</p></div><Badge variant="outline" className="ml-auto border-violet-200 bg-violet-50 text-violet-700">MANUAL_PASTE</Badge></div>
          <Textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="Tashqi yordamchi natijasini shu yerga qo‘ying…" className="mt-4 min-h-28 rounded-xl shadow-none" />
          <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" onClick={addResult} disabled={!manualText.trim()} className="rounded-xl bg-blue-700 hover:bg-blue-800"><Plus className="size-4" /> Lokal variant qo‘shish</Button><Button type="button" variant="outline" onClick={mergeSelected} disabled={selectedCurrentCount < 2} className="rounded-xl"><GitMerge className="size-4" /> Tanlanganlarni birlashtirish</Button><span className="text-[11px] text-slate-400">Faqat shu brauzer sessiyasi · real material/task 0</span></div>
          <div className="mt-4 space-y-3">{results.map((item) => {
            const comparison = compareResultContext(item, envelope);
            return <article key={item.resultId} className={`rounded-xl border p-4 ${comparison.state === "CURRENT" ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex flex-wrap items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={item.selected} onChange={(event) => updateResult(item.resultId, item.text, event.target.checked)} className="size-4 rounded border-slate-300 accent-blue-700" /> Tanlash</label><Badge variant="outline" className="font-mono text-[9px]">{item.resultId}</Badge><Badge variant="outline" className="text-[9px]">{item.mode}</Badge>{comparison.state !== "CURRENT" && <Badge className="ml-auto bg-amber-600 text-white">Eski context · qayta ko‘rib chiqing</Badge>}</div>
              <Textarea value={item.text} onChange={(event) => updateResult(item.resultId, event.target.value)} className="mt-3 min-h-24 bg-white text-sm shadow-none" aria-label={`${item.resultId} matni`} />
              {onTakeToMaterial && <Button type="button" variant="outline" onClick={() => takeToMaterial(item)} disabled={!item.selected || comparison.state !== "CURRENT"} className="mt-3 rounded-xl border-violet-200 text-violet-700 hover:bg-violet-50"><FileWarning className="size-4" /> Material qoralamasiga olish</Button>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-slate-400"><span>{item.contextFingerprint}</span><span>{item.instructionVersion}</span><span>{item.origin}</span><span>sheet:false · backend:false</span></div>
            </article>;
          })}{!results.length && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">Hali lokal variant yo‘q. Bo‘sh natija “completed” qilinmaydi.</div>}</div>
        </section>
      </div>

      <aside className="space-y-3 lg:col-span-2 2xl:col-span-1">
        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
          <ShieldCheck className="size-5 text-blue-300" />
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">Origin va boundary</p>
          <p className="mt-1 font-mono text-xs text-blue-200">{preview.origin}</p>
          <div className="mt-4 space-y-2 text-xs leading-5 text-slate-300"><p>Execution allowed: <strong className="text-white">FALSE</strong></p><p>Backend real task: <strong className="text-white">Noma’lum</strong></p><p>External helper run: <strong className="text-white">NOT_RUN</strong></p><p>Training: <strong className="text-white">HUMAN_REVIEW_PENDING</strong></p></div>
          <p className="mt-4 font-mono text-[9px] text-slate-500">{preview.contractVersion} · {preview.commonVersion}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${link.state === "MISSING" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`}>
          <div className="flex items-center gap-2">{link.openable ? <ExternalLink className="size-4" /> : <Link2Off className="size-4" />}<h3 className="font-semibold">Helper havolasi</h3></div>
          <p className="mt-2 text-sm font-bold">{link.state}</p>
          <p className="mt-1 text-xs leading-5">{link.state === "MISSING" ? "Haqiqiy link berilmagan. Yo‘riqnoma va context copy ishlashda davom etadi." : link.connected ? "Access dalili mavjud; context baribir avtomatik uzatilmaydi." : "URL ochilishi mumkin, ammo permission va ishlashi tasdiqlanmagan."}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><PencilLine className="size-4 text-blue-700" /><h3 className="font-semibold text-slate-950">Output chegarasi</h3></div><p className="mt-2 text-xs leading-5 text-slate-600">{assistant.outputUz}</p><div className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-600"><strong>Quality evidence:</strong> {assistant.qualityEvidence}<br /><strong>Example authority:</strong> {assistant.examples.authority}</div></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><div className="flex items-center gap-2"><AlertTriangle className="size-4" /><strong>User kalibrlashi ochiq</strong></div><p className="mt-2">Prompt va training sample texnik fixture. Mazmun sifati, helper permissioni va xodim usuliga mosligi bu preview bilan PASS bo‘lmaydi.</p></div>
      </aside>
    </section>
  </div>;
}
