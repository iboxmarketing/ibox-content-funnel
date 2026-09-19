"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, GitBranch, Layers3, Lock, RefreshCw, SlidersHorizontal, Users, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductionDrawer } from "@/components/production-drawer";
import { dateKey, formatDisplayDate } from "@/lib/scheduling-engine";
import type { ProductionDataset, ProductionPlan, ScheduleResult } from "@/lib/production-types";

type ViewMode = "month" | "week" | "agenda" | "platform" | "team" | "language";
type LayerMode = "publishing" | "deadlines" | "both";

function startOfWeek(date: Date) {
  const copy = new Date(date); copy.setHours(0, 0, 0, 0); copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); return copy;
}
function addDays(date: Date, days: number) { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; }
function keyForDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function sameMonth(left: Date, right: Date) { return left.getMonth() === right.getMonth() && left.getFullYear() === right.getFullYear(); }
function unique(values: string[]) { return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "uz")); }
function priorityTone(value: string) { return value === "P0" ? "bg-red-600" : value === "P1" ? "bg-orange-500" : value === "P2" ? "bg-amber-500" : "bg-slate-500"; }

function CalendarItem({ plan, onClick, compact = false }: { plan: ProductionPlan; onClick: () => void; compact?: boolean }) {
  const item = plan.item;
  return <button type="button" onClick={onClick} className={`group w-full rounded-lg border bg-white text-left transition hover:border-blue-300 hover:shadow-sm ${compact ? "px-2 py-1.5" : "p-2.5"} ${plan.scheduleRisk === "late" ? "border-red-200" : plan.scheduleRisk === "at_risk" ? "border-amber-200" : "border-slate-200"}`}>
    <div className="flex items-center gap-1.5"><span className={`size-1.5 shrink-0 rounded-full ${priorityTone(item.priorityBand)}`} /><span className="truncate text-[10px] font-bold text-slate-500">{item.language} · {item.primaryPlatform}</span>{item.scheduleLocked && <Lock className="ml-auto size-3 text-amber-600" />}</div>
    <p className={`mt-1 font-semibold text-slate-800 ${compact ? "line-clamp-1 text-[11px]" : "line-clamp-2 text-[12px] leading-4"}`}>{item.workingTitle}</p>
    {!compact && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500"><Badge variant="secondary" className="h-4 px-1 text-[9px]">{item.primaryContentType}</Badge>{item.toolId && <span className="flex items-center gap-1 font-semibold text-blue-700"><Wrench className="size-3" /> Tool · {item.toolId}</span>}{item.sourceArticleNodeId && <span className="flex items-center gap-1 text-violet-600"><GitBranch className="size-3" /> derivative</span>}</div>}
  </button>;
}

function DeadlineMarker({ plan, stageName, date, onClick }: { plan: ProductionPlan; stageName: string; date: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-left text-[10px] text-blue-800 hover:bg-blue-100"><span className="size-1.5 rounded-full bg-blue-500" /><span className="truncate">{stageName}: {plan.item.workingTitle}</span><span className="ml-auto font-mono text-[9px]">{formatDisplayDate(date)}</span></button>;
}

function MonthView({ schedule, cursor, layer, onSelect }: { schedule: ScheduleResult; cursor: Date; layer: LayerMode; onSelect: (plan: ProductionPlan) => void }) {
  const start = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const plansByDay = new Map<string, ProductionPlan[]>();
  const deadlinesByDay = new Map<string, Array<{ plan: ProductionPlan; name: string; date: string }>>();
  for (const plan of schedule.plans) {
    const publish = dateKey(plan.scheduledPublishDate);
    if (publish) plansByDay.set(publish, [...(plansByDay.get(publish) ?? []), plan]);
    for (const stage of plan.stages) if (stage.endDate) deadlinesByDay.set(stage.endDate, [...(deadlinesByDay.get(stage.endDate) ?? []), { plan, name: stage.stageName, date: stage.endDate }]);
  }
  return <div className="grid h-full min-w-[980px] grid-cols-7 grid-rows-[32px_repeat(6,minmax(118px,1fr))] overflow-hidden rounded-2xl border border-slate-200 bg-white">
    {["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"].map((day) => <div key={day} className="flex items-center justify-center border-b border-r border-slate-200 text-[11px] font-bold uppercase text-slate-400 last:border-r-0">{day}</div>)}
    {days.map((day) => {
      const key = keyForDate(day); const items = plansByDay.get(key) ?? []; const deadlines = deadlinesByDay.get(key) ?? [];
      return <div key={key} className={`min-h-0 overflow-y-auto border-b border-r border-slate-100 p-1.5 ${sameMonth(day, cursor) ? "bg-white" : "bg-slate-50/70"}`}><div className="mb-1.5 flex items-center justify-between"><span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ${key === keyForDate(new Date()) ? "bg-blue-600 text-white" : sameMonth(day, cursor) ? "text-slate-700" : "text-slate-300"}`}>{day.getDate()}</span>{items.length > 0 && <span className="text-[9px] text-slate-400">{items.length} post</span>}</div>
        {(layer === "publishing" || layer === "both") && <div className="space-y-1">{items.slice(0, 3).map((plan) => <CalendarItem key={plan.item.productionId} plan={plan} onClick={() => onSelect(plan)} compact />)}{items.length > 3 && <p className="px-1 text-[9px] font-semibold text-blue-600">+{items.length - 3} yana</p>}</div>}
        {(layer === "deadlines" || layer === "both") && <div className="mt-1 space-y-1">{deadlines.slice(0, layer === "both" ? 1 : 3).map((entry) => <DeadlineMarker key={`${entry.plan.item.productionId}-${entry.name}`} plan={entry.plan} stageName={entry.name} date={entry.date} onClick={() => onSelect(entry.plan)} />)}{deadlines.length > (layer === "both" ? 1 : 3) && <p className="px-1 text-[9px] text-slate-400">+{deadlines.length - (layer === "both" ? 1 : 3)} deadline</p>}</div>}
      </div>;
    })}
  </div>;
}

function WeekView({ schedule, cursor, layer, onSelect }: { schedule: ScheduleResult; cursor: Date; layer: LayerMode; onSelect: (plan: ProductionPlan) => void }) {
  const start = startOfWeek(cursor); const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return <div className="grid h-full min-w-[980px] grid-cols-7 gap-2">{days.map((day) => { const key = keyForDate(day); const plans = schedule.plans.filter((plan) => dateKey(plan.scheduledPublishDate) === key); const deadlines = schedule.plans.flatMap((plan) => plan.stages.filter((stage) => stage.endDate === key).map((stage) => ({ plan, stage })));
    return <section key={key} className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70"><header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-bold uppercase text-slate-400">{new Intl.DateTimeFormat("uz-UZ", { weekday: "short" }).format(day)}</p><p className="text-lg font-bold text-slate-900">{day.getDate()}</p></header><div className="space-y-2 p-2">
      {(layer === "publishing" || layer === "both") && plans.map((plan) => <CalendarItem key={plan.item.productionId} plan={plan} onClick={() => onSelect(plan)} />)}
      {(layer === "deadlines" || layer === "both") && deadlines.map(({ plan, stage }) => <DeadlineMarker key={`${plan.item.productionId}-${stage.stageId}`} plan={plan} stageName={stage.stageName} date={stage.endDate} onClick={() => onSelect(plan)} />)}
      {!plans.length && !deadlines.length && <p className="py-6 text-center text-[11px] text-slate-400">Reja yo‘q</p>}
    </div></section>; })}</div>;
}

function AgendaView({ schedule, onSelect }: { schedule: ScheduleResult; onSelect: (plan: ProductionPlan) => void }) {
  const groups = new Map<string, ProductionPlan[]>();
  schedule.plans.filter((plan) => plan.scheduledPublishDate).sort((a, b) => a.scheduledPublishDate.localeCompare(b.scheduledPublishDate)).forEach((plan) => { const key = dateKey(plan.scheduledPublishDate); groups.set(key, [...(groups.get(key) ?? []), plan]); });
  return <div className="mx-auto max-w-5xl space-y-4">{Array.from(groups.entries()).slice(0, 40).map(([day, plans]) => <section key={day} className="rounded-2xl border border-slate-200 bg-white"><header className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h3 className="text-[13px] font-bold text-slate-800">{formatDisplayDate(day)}</h3><Badge variant="secondary">{plans.length}</Badge></header><div className="grid gap-2 p-3 md:grid-cols-2">{plans.map((plan) => <CalendarItem key={plan.item.productionId} plan={plan} onClick={() => onSelect(plan)} />)}</div></section>)}</div>;
}

function GroupView({ schedule, mode, onSelect }: { schedule: ScheduleResult; mode: "platform" | "team" | "language"; onSelect: (plan: ProductionPlan) => void }) {
  const keyOf = (plan: ProductionPlan) => mode === "platform" ? plan.item.primaryPlatform : mode === "team" ? plan.currentOwner : plan.item.language;
  const groups = unique(schedule.plans.filter((plan) => plan.scheduledPublishDate).map(keyOf));
  return <div className="flex h-full min-w-max gap-3">{groups.map((group) => { const plans = schedule.plans.filter((plan) => plan.scheduledPublishDate && keyOf(plan) === group).sort((a, b) => a.scheduledPublishDate.localeCompare(b.scheduledPublishDate)); return <section key={group} className="flex h-full w-[320px] flex-col rounded-2xl border border-slate-200 bg-slate-100/70"><header className="flex h-12 items-center justify-between border-b border-slate-200 px-3.5"><h3 className="truncate text-[12px] font-bold text-slate-700">{group}</h3><Badge variant="secondary">{plans.length}</Badge></header><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">{plans.map((plan) => <div key={plan.item.productionId}><p className="mb-1 px-1 text-[10px] font-semibold text-slate-400">{formatDisplayDate(plan.scheduledPublishDate, true)}</p><CalendarItem plan={plan} onClick={() => onSelect(plan)} /></div>)}</div></section>; })}</div>;
}

export function ContentCalendar({ dataset, baseSchedule, onRefresh, refreshing, lastSynced, onSettings }: { onSettings: () => void; dataset: ProductionDataset; baseSchedule: ScheduleResult; onRefresh: () => void; refreshing: boolean; lastSynced: string }) {
  const [view, setView] = useState<ViewMode>("month");
  const [layer, setLayer] = useState<LayerMode>("publishing");
  const [cursor, setCursor] = useState(() => new Date(`${dataset.settings.find((s) => s.active && s.key === "PLANNING_START_DATE")?.value || keyForDate(new Date())}T12:00:00`));
  const [selection, setSelection] = useState<ProductionPlan | null>(null);
  const schedule = baseSchedule;
  const weekStart = startOfWeek(new Date()); const weekEnd = addDays(weekStart, 7);
  const inWeek = (value: string) => { const key = dateKey(value); return key >= keyForDate(weekStart) && key < keyForDate(weekEnd); };
  const plannedWeek = schedule.plans.filter((plan) => plan.scheduledPublishDate && inWeek(plan.scheduledPublishDate)).length;
  const targetWeek = dataset.publishingRules.filter((rule) => rule.active).reduce((sum, rule) => sum + rule.postsPerWeek, 0);
  const ready = schedule.plans.filter((plan) => /ready|scheduled/i.test(plan.item.productionStatus)).length;
  const atRisk = schedule.plans.filter((plan) => plan.scheduleRisk !== "on_track").length;
  const unscheduledPriority = schedule.plans.filter((plan) => !plan.scheduledPublishDate && /P0|P1/.test(plan.item.priorityBand)).length;
  const unscheduled = schedule.plans.filter((plan) => !plan.scheduledPublishDate && !/published/i.test(plan.item.productionStatus));
  const shiftCursor = (direction: number) => setCursor((current) => view === "month" ? new Date(current.getFullYear(), current.getMonth() + direction, 1) : addDays(current, direction * 7));
  const title = view === "month" ? new Intl.DateTimeFormat("uz-UZ", { month: "long", year: "numeric" }).format(cursor) : `${formatDisplayDate(keyForDate(startOfWeek(cursor)))} — ${formatDisplayDate(keyForDate(addDays(startOfWeek(cursor), 6)))}`;

  return <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 lg:px-5"><div className="mr-3"><h1 className="text-[17px] font-bold text-slate-950">Content Calendar</h1><p className="text-[11px] text-slate-500">Publishing + production planning</p></div>
      <div className="flex rounded-lg bg-slate-100 p-1">{(["month", "week", "agenda", "platform", "team", "language"] as ViewMode[]).map((mode) => <button key={mode} type="button" onClick={() => setView(mode)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold capitalize ${view === mode ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>{mode}</button>)}</div>
      <div className="ml-auto flex items-center gap-1"><Button size="icon" variant="outline" className="size-8" onClick={() => shiftCursor(-1)}><ArrowLeft className="size-4" /></Button><Button variant="outline" size="sm" className="h-8 min-w-[150px]" onClick={() => setCursor(new Date())}>{title}</Button><Button size="icon" variant="outline" className="size-8" onClick={() => shiftCursor(1)}><ArrowRight className="size-4" /></Button></div>
      <Button variant="outline" size="sm" className="h-8" onClick={onSettings}><SlidersHorizontal className="size-4" /> What if?</Button>
      <Button size="sm" className="h-8 bg-blue-700 hover:bg-blue-800" onClick={onRefresh} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Recalculate schedule</Button>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:px-5"><div className="flex rounded-lg border border-slate-200 p-0.5">{(["publishing", "deadlines", "both"] as LayerMode[]).map((mode) => <button key={mode} onClick={() => setLayer(mode)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${layer === mode ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>{mode === "publishing" ? "Publishing Calendar" : mode === "deadlines" ? "Production Deadlines" : "Both"}</button>)}</div><span className="ml-auto text-[11px] text-slate-400">Last synced: {formatDisplayDate(lastSynced, true)}</span></div>

    <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6 lg:px-5">{[
      ["Planned this week", plannedWeek, "text-blue-700"], ["Target this week", targetWeek, "text-slate-900"], ["Ready content", ready, "text-emerald-700"], ["At-risk content", atRisk, "text-amber-700"], ["Unscheduled P0/P1", unscheduledPriority, "text-red-700"], ["Cadence health", `${plannedWeek}/${targetWeek}`, plannedWeek >= targetWeek ? "text-emerald-700" : "text-amber-700"],
    ].map(([label, value, tone]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold text-slate-500">{label}</p><p className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</p></div>)}</div>


    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:p-4"><main className="min-w-0 flex-1 overflow-auto">{view === "month" ? <MonthView schedule={schedule} cursor={cursor} layer={layer} onSelect={setSelection} /> : view === "week" ? <WeekView schedule={schedule} cursor={cursor} layer={layer} onSelect={setSelection} /> : view === "agenda" ? <AgendaView schedule={schedule} onSelect={setSelection} /> : <GroupView schedule={schedule} mode={view} onSelect={setSelection} />}</main>
      <aside className="hidden w-[290px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white xl:flex"><header className="border-b border-slate-200 px-4 py-3"><div className="flex items-center justify-between"><h2 className="text-[13px] font-bold text-slate-900">Unscheduled Content</h2><Badge variant="secondary">{unscheduled.length}</Badge></div><p className="mt-1 text-[10px] text-slate-500">Nega schedule’ga kirmaganini ko‘ring</p></header><div className="min-h-0 flex-1 overflow-y-auto p-2.5">{["P0", "P1", "P2", "P3"].map((priority) => { const items = unscheduled.filter((plan) => plan.item.priorityBand === priority).sort((a, b) => b.item.priorityScore - a.item.priorityScore); if (!items.length) return null; return <section key={priority} className="mb-4"><div className="mb-2 flex items-center gap-2 px-1"><span className={`size-2 rounded-full ${priorityTone(priority)}`} /><h3 className="text-[11px] font-bold text-slate-600">{priority}</h3><span className="ml-auto text-[10px] text-slate-400">{items.length}</span></div><div className="space-y-2">{items.slice(0, 20).map((plan) => <button key={plan.item.productionId} onClick={() => setSelection(plan)} className="w-full rounded-xl border border-slate-200 p-2.5 text-left hover:border-blue-300"><p className="line-clamp-2 text-[11px] font-semibold leading-4 text-slate-800">{plan.item.workingTitle}</p><p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-700"><AlertTriangle className="size-3" /> {plan.unscheduledReason || "Waiting for production readiness"}</p></button>)}</div></section>; })}</div></aside>
    </div>
    <div className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"><CalendarDays className="size-4" /><Layers3 className="size-4" /><Users className="size-4" /></div>
    <ProductionDrawer plan={schedule.plans.find((p) => p.item.productionId === selection?.item.productionId) ?? null} dataset={dataset} onClose={() => setSelection(null)} />
  </div>;
}
