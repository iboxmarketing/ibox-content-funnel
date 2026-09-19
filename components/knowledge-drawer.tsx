"use client";

import { ArrowRight, CircleAlert, GitBranch, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CanonicalProblem, KnowledgeGraph, KnowledgeProblem, KnowledgeProcess } from "@/lib/knowledge-types";

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="grid gap-1.5 border-b border-slate-100 py-3.5 last:border-0 sm:grid-cols-[160px_1fr] sm:gap-5">
      <dt className="text-[12px] font-bold uppercase tracking-[0.055em] text-slate-500">{label}</dt>
      <dd className={`break-words text-[14px] leading-6 text-slate-900 ${mono ? "font-mono font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

function PriorityBadge({ value }: { value: string }) {
  if (!value) return null;
  const normalized = value.toLocaleLowerCase("uz");
  const high = /(yuqori|high|critical|kritik)/.test(normalized);
  const medium = /(o'rta|o‘rta|medium|normal)/.test(normalized);
  return (
    <Badge className={high ? "border-red-200 bg-red-50 text-red-700" : medium ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"} variant="outline">
      {value}
    </Badge>
  );
}

function ProcessDetails({ process, graph, onProblemSelect }: { process: KnowledgeProcess; graph: KnowledgeGraph; onProblemSelect: (id: string) => void }) {
  const related = process.problemIds.map((id) => graph.problems.find((problem) => problem.id === id)).filter(Boolean) as KnowledgeProblem[];
  const area = graph.areas.find((item) => item.id === process.areaId);
  return (
    <>
      <SheetHeader className="border-b border-slate-200 bg-white px-6 pb-5 pt-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className="font-mono" style={{ borderColor: `${area?.color}55`, color: area?.color }}>{process.jarayonId}</Badge>
          <Badge variant="secondary">Jarayon</Badge>
        </div>
        <SheetTitle className="break-words pr-10 text-xl leading-7 text-slate-950">{process.kichikJarayon || "Nomsiz jarayon"}</SheetTitle>
        <SheetDescription className="text-slate-600">{area?.name} · {process.bosqich || process.jarayonGuruhi}</SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-500"><Layers3 className="size-4" /> Jarayon tafsilotlari</h3>
          <dl>
            <Field label="Jarayon_ID" value={process.jarayonId} mono />
            <Field label="Biznes bo‘limi" value={process.biznesBolimi} />
            <Field label="Bosqich" value={process.bosqich} />
            <Field label="Jarayon guruhi" value={process.jarayonGuruhi} />
            <Field label="Kichik jarayon" value={process.kichikJarayon} />
            <Field label="Asosiy savol" value={process.asosiySavol} />
            <Field label="Kiruvchi ma’lumot" value={process.kiruvchiMalumot} />
            <Field label="Asosiy harakat" value={process.asosiyHarakat} />
            <Field label="Natija" value={process.natija} />
            <Field label="Mas’ul" value={process.masul} />
            <Field label="Mos biznes turi" value={process.mosBiznesTuri} />
            <Field label="Segment urg‘usi" value={process.segmentUrgusi} />
            <Field label="Oldingi Jarayon_ID" value={process.oldingiJarayonId} mono />
            <Field label="Keyingi Jarayon_ID" value={process.keyingiJarayonId} mono />
          </dl>

          <div className="mt-7 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-500"><CircleAlert className="size-4" /> Bog‘langan muammolar</h3>
            <Badge variant="secondary">{related.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {related.length ? related.map((problem) => (
              <button key={problem.id} type="button" onClick={() => onProblemSelect(problem.id)} className="group flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-mono text-[11px] font-bold text-slate-500">{problem.muammoId}</span><PriorityBadge value={problem.ustuvorlik} /></div>
                  <p className="mt-1.5 text-[14px] font-medium leading-5 text-slate-800">{problem.muammo}</p>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-slate-300 transition group-hover:text-blue-600" />
              </button>
            )) : <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Bu jarayonga bog‘langan muammo topilmadi.</p>}
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

function CanonicalDetails({ canonical }: { canonical: CanonicalProblem }) {
  const entries = Object.entries(canonical.record).filter(([, value]) => value);
  return (
    <section className="mt-7 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="size-4 text-blue-700" />
        <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-blue-800">Canonical muammo</h3>
      </div>
      <p className="font-mono text-[12px] font-bold text-blue-700">{canonical.id}</p>
      {canonical.title && <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900">{canonical.title}</p>}
      <dl className="mt-3 border-t border-blue-100">
        {entries.filter(([key]) => !/canonical.problem.id/i.test(key.replace(/_/g, "."))).map(([key, value]) => (
          <Field key={key} label={key.replace(/_/g, " ")} value={value} />
        ))}
      </dl>
    </section>
  );
}

function ProblemDetails({ problem, graph, onProcessSelect }: { problem: KnowledgeProblem; graph: KnowledgeGraph; onProcessSelect: (id: string) => void }) {
  const area = graph.areas.find((item) => item.id === problem.areaId);
  const process = graph.processes.find((item) => item.id === problem.jarayonId);
  const canonical = graph.canonicalProblems.find((item) => item.id === problem.canonicalProblemId);
  return (
    <>
      <SheetHeader className="border-b border-slate-200 bg-white px-6 pb-5 pt-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className="font-mono" style={{ borderColor: `${area?.color}55`, color: area?.color }}>{problem.muammoId}</Badge>
          <PriorityBadge value={problem.ustuvorlik} />
        </div>
        <SheetTitle className="break-words pr-10 text-xl leading-7 text-slate-950">{problem.muammo || "Nomsiz muammo"}</SheetTitle>
        <SheetDescription className="text-slate-600">{area?.name}{process ? ` · ${process.kichikJarayon}` : ""}</SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5">
          {process && (
            <Button variant="outline" className="mb-5 h-auto min-h-10 w-full justify-between whitespace-normal border-blue-200 bg-blue-50 px-3 py-2.5 text-left text-blue-800 shadow-none hover:border-blue-300 hover:bg-blue-100 hover:text-blue-900" onClick={() => onProcessSelect(process.id)}>
              <span className="truncate">Jarayon: {process.jarayonId} · {process.kichikJarayon}</span><ArrowRight className="size-4" />
            </Button>
          )}
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-500"><CircleAlert className="size-4" /> Muammo tafsilotlari</h3>
          <dl>
            <Field label="Muammo_ID" value={problem.muammoId} mono />
            <Field label="Jarayon_ID" value={problem.jarayonId} mono />
            <Field label="Muammo" value={problem.muammo} />
            <Field label="Belgilar" value={problem.belgilar} />
            <Field label="Asosiy sabab" value={problem.asosiySabab} />
            <Field label="Qo‘shimcha sabablar" value={problem.qoshimchaSabablar} />
            <Field label="Operatsion oqibat" value={problem.operatsionOqibat} />
            <Field label="Moliyaviy oqibat" value={problem.moliyaviyOqibat} />
            <Field label="Mijozga ta’sir" value={problem.mijozgaTasir} />
            <Field label="Uzoq muddatli xavf" value={problem.uzoqMuddatliXavf} />
            <Field label="Kerakli natija" value={problem.kerakliNatija} />
            <Field label="Mos biznes turi" value={problem.mosBiznesTuri} />
            <Field label="Segment urg‘usi" value={problem.segmentUrgusi} />
            <Field label="Ustuvorlik" value={problem.ustuvorlik} />
            <Field label="Kontent potensiali" value={problem.kontentPotensiali} />
            <Field label="Canonical Problem ID" value={problem.canonicalProblemId} mono />
            <Field label="Manba_ID" value={problem.manbaId} mono />
          </dl>
          {canonical && <CanonicalDetails canonical={canonical} />}
        </div>
      </ScrollArea>
    </>
  );
}

export function KnowledgeDrawer({
  graph,
  selection,
  onClose,
  onProcessSelect,
  onProblemSelect,
}: {
  graph: KnowledgeGraph;
  selection: { type: "process" | "problem"; id: string } | null;
  onClose: () => void;
  onProcessSelect: (id: string) => void;
  onProblemSelect: (id: string) => void;
}) {
  const process = selection?.type === "process" ? graph.processes.find((item) => item.id === selection.id) : null;
  const problem = selection?.type === "problem" ? graph.problems.find((item) => item.id === selection.id) : null;
  return (
    <Sheet open={Boolean(selection)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full max-w-full gap-0 overflow-hidden border-slate-200 bg-white p-0 sm:max-w-[600px]">
        {process && <ProcessDetails process={process} graph={graph} onProblemSelect={onProblemSelect} />}
        {problem && <ProblemDetails problem={problem} graph={graph} onProcessSelect={onProcessSelect} />}
      </SheetContent>
    </Sheet>
  );
}
