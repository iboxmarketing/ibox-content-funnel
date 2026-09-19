"use client";

import { AlertTriangle, CheckCircle2, CircleDot, Clock3, GitBranch, Link2, Lock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDisplayDate } from "@/lib/scheduling-engine";
import type { ProductionDataset, ProductionPlan } from "@/lib/production-types";

function Field({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[148px_1fr] sm:gap-4">
      <dt className="text-[12px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</dt>
      <dd className={`text-[14px] leading-6 text-slate-800 ${mono ? "font-mono font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

function stageTone(status: string) {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function ProductionDrawer({ plan, dataset, onClose }: { plan: ProductionPlan | null; dataset: ProductionDataset; onClose: () => void }) {
  if (!plan) return null;
  const item = plan.item;
  const canonical = item.canonicalProblemIds.map((id) => dataset.canonicalProblems.find((problem) => problem.id === id)).filter(Boolean);
  const source = item.sourceArticleNodeId ? dataset.contentNodes.find((node) => node.nodeId === item.sourceArticleNodeId) : null;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full gap-0 border-slate-200 bg-white p-0 sm:max-w-[660px]">
        <SheetHeader className="border-b border-slate-200 px-6 pb-5 pt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">{item.productionId}</Badge>
            <Badge className="bg-blue-50 text-blue-700" variant="secondary">{item.priorityBand}</Badge>
            <Badge variant="outline">{item.productionStatus}</Badge>
            {item.scheduleLocked && <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700"><Lock className="size-3" /> Locked</Badge>}
          </div>
          <SheetTitle className="pr-8 text-xl leading-7 text-slate-950">{item.workingTitle}</SheetTitle>
          <SheetDescription>{item.primaryContentType} · {item.primaryPlatform} · {item.language}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 py-5">
            <div className="mb-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-bold uppercase text-slate-400">Keyingi deadline</p><p className="mt-1 text-[13px] font-semibold text-slate-900">{formatDisplayDate(plan.nextDeadline)}</p></div>
              <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-bold uppercase text-slate-400">Publish</p><p className="mt-1 text-[13px] font-semibold text-slate-900">{formatDisplayDate(plan.scheduledPublishDate, true)}</p></div>
              <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-bold uppercase text-slate-400">Risk</p><p className={`mt-1 text-[13px] font-semibold ${plan.scheduleRisk === "on_track" ? "text-emerald-700" : plan.scheduleRisk === "late" ? "text-red-700" : "text-amber-700"}`}>{plan.scheduleRisk === "on_track" ? "On track" : plan.scheduleRisk === "late" ? "Late" : "At risk"}</p></div>
            </div>

            <h3 className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-500">Kontent ma’lumotlari</h3>
            <dl>
              <Field label="Production_ID" value={item.productionId} mono />
              <Field label="Node_ID" value={item.nodeId} mono />
              <Field label="Cluster" value={item.clusterId} mono />
              <Field label="Canonical Problems" value={item.canonicalProblemIds.join(" · ")} mono />
              <Field label="Working Title" value={item.workingTitle} />
              <Field label="Main Question" value={item.mainQuestion} />
              <Field label="Priority Score" value={item.priorityScore} />
              <Field label="Priority Band" value={item.priorityBand} />
              <Field label="Publishability" value={item.publishability} />
              <Field label="Node Role" value={item.nodeRole} />
              <Field label="Funnel Stage" value={item.funnelStage} />
              <Field label="Segment" value={item.primarySegment} />
              <Field label="Business Type" value={item.businessType} />
              {source && <Field label="Source Article" value={`${source.nodeId} · ${source.workingTitle}`} />}
            </dl>

            {canonical.length > 0 && (
              <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-blue-800"><GitBranch className="size-4" /> Canonical muammolar</h3>
                <div className="mt-3 space-y-2">{canonical.map((problem) => problem && <div key={problem.id} className="rounded-lg bg-white/80 px-3 py-2"><span className="font-mono text-[11px] font-bold text-blue-700">{problem.id}</span><p className="mt-1 text-[13px] text-slate-700">{problem.title}</p></div>)}</div>
              </section>
            )}

            <div className="mt-7 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-500"><GitBranch className="size-4" /> Production workflow</h3>
              <Badge variant="secondary">{plan.stages.length} bosqich</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {plan.stages.map((stage, index) => (
                <div key={stage.stageId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${stageTone(stage.status)}`}>{stage.status === "done" ? <CheckCircle2 className="size-4" /> : stage.status === "blocked" ? <AlertTriangle className="size-4" /> : <CircleDot className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-slate-900">{index + 1}. {stage.stageName}</h4><Badge variant="outline" className={stageTone(stage.status)}>{stage.status.replace("_", " ")}</Badge></div>
                      <div className="mt-3 grid gap-2 text-[12px] text-slate-600 sm:grid-cols-2">
                        <p className="flex items-center gap-1.5"><Users className="size-3.5 text-slate-400" /> {stage.ownerName} · {stage.ownerRole}</p>
                        <p className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-slate-400" /> {formatDisplayDate(stage.startDate)} → {formatDisplayDate(stage.endDate)}</p>
                        <p>{stage.durationWorkdays} workday · {stage.estimatedHours} soat</p>
                        <p className="flex items-center gap-1.5"><Link2 className="size-3.5 text-slate-400" /> {stage.dependencyStageIds.length ? stage.dependencyStageIds.join(" + ") : "Dependency yo‘q"}</p>
                      </div>
                      {stage.capacityWarning && <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800"><AlertTriangle className="size-4" /> {stage.capacityWarning}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
