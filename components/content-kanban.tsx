"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, Filter, Link2, RefreshCw, Search, Settings2, UserRound, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductionDrawer } from "@/components/production-drawer";
import { dateKey, formatDisplayDate } from "@/lib/scheduling-engine";
import type { ProductionDataset, ProductionPlan, ScheduleResult } from "@/lib/production-types";

const COLUMNS = ["Backlog", "Research", "Writing", "Review", "Ready", "Scheduled", "Published", "Paused"];

type Filters = {
  priorityBand: string; employee: string; role: string; status: string; publishability: string;
  contentType: string; platform: string; language: string; funnelStage: string; segment: string;
  cluster: string; nodeRole: string; dateFrom: string; dateTo: string; overdueOnly: boolean;
  atRiskOnly: boolean; showInternal: boolean;
};

const INITIAL_FILTERS: Filters = {
  priorityBand: "all", employee: "all", role: "all", status: "all", publishability: "all", contentType: "all",
  platform: "all", language: "all", funnelStage: "all", segment: "all", cluster: "all", nodeRole: "all",
  dateFrom: "", dateTo: "", overdueOnly: false, atRiskOnly: false, showInternal: false,
};

function norm(value: string) { return value.toLocaleLowerCase("uz").trim(); }

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "uz"));
}

function priorityTone(value: string) {
  if (value === "P0") return "border-red-200 bg-red-50 text-red-700";
  if (value === "P1") return "border-orange-200 bg-orange-50 text-orange-700";
  if (value === "P2") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function riskTone(plan: ProductionPlan) {
  if (plan.scheduleRisk === "late" || plan.overdue) return "border-red-200 bg-red-50 text-red-700";
  if (plan.scheduleRisk === "at_risk") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5"><span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-blue-500"><option value="all">Barchasi</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Counter({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "red" | "amber" | "blue" | "emerald" }) {
  const tones = { slate: "text-slate-900", red: "text-red-700", amber: "text-amber-700", blue: "text-blue-700", emerald: "text-emerald-700" };
  return <div className="min-w-[132px] rounded-xl border border-slate-200 bg-white px-3.5 py-3"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold tracking-[-0.03em] ${tones[tone]}`}>{value}</p></div>;
}

function KanbanCard({ plan, onClick }: { plan: ProductionPlan; onClick: () => void }) {
  const item = plan.item;
  return (
    <button type="button" onClick={onClick} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_2px_8px_rgba(16,24,40,.04)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_8px_20px_rgba(16,24,40,.08)]">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${priorityTone(item.priorityBand)}`}>{item.priorityBand}</Badge>
        <span className="font-mono text-[10px] text-slate-400">{item.productionId}</span>
      </div>
      <h3 className="mt-2 line-clamp-3 text-[13px] font-semibold leading-[18px] text-slate-900">{item.workingTitle}</h3>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {item.primarySegment && <Badge variant="secondary" className="h-5 max-w-full truncate px-1.5 text-[9px]">{item.primarySegment}</Badge>}
        {item.nodeRole && <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{item.nodeRole}</Badge>}
        {item.funnelStage && <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{item.funnelStage}</Badge>}
      </div>
      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        <p className="flex items-center gap-1.5"><UserRound className="size-3.5 shrink-0" /><span className="truncate">{plan.currentOwner}</span></p>
        <p className="flex items-center gap-1.5"><CalendarClock className="size-3.5 shrink-0" /><span>{formatDisplayDate(plan.nextDeadline)}</span></p>
        <p className="flex items-center gap-1.5"><span className="size-3.5 shrink-0 rounded bg-slate-100 text-center text-[9px] font-bold leading-[14px]">{item.language}</span><span className="truncate">{item.primaryPlatform} · {item.primaryContentType}</span></p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {(plan.overdue || plan.scheduleRisk !== "on_track") && <Badge variant="outline" className={`h-5 px-1.5 text-[9px] ${riskTone(plan)}`}>{plan.overdue ? "OVERDUE" : plan.scheduleRisk === "late" ? "LATE" : "AT RISK"}</Badge>}
        {plan.blocked && <Badge variant="outline" className="h-5 border-red-200 bg-red-50 px-1.5 text-[9px] text-red-700">BLOCKED</Badge>}
        {item.toolId && <span title={`Tool: ${item.toolId}`} className="text-blue-700"><Wrench className="size-3.5" /></span>}
        {item.mofBridgeId && <span title={`MOF: ${item.mofBridgeId}`} className="text-violet-700"><Link2 className="size-3.5" /></span>}
      </div>
    </button>
  );
}

export function ContentKanban({ dataset, schedule, onRefresh, refreshing, lastSynced }: { dataset: ProductionDataset; schedule: ScheduleResult; onRefresh: () => void; refreshing: boolean; lastSynced: string }) {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("priority");
  const [selection, setSelection] = useState<ProductionPlan | null>(null);
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.map((column) => [column, 60])));
  const options = useMemo(() => ({
    priorities: unique(dataset.items.map((item) => item.priorityBand)), employees: unique(schedule.plans.map((plan) => plan.currentOwner)),
    roles: unique(schedule.plans.map((plan) => plan.currentRole)), statuses: unique(dataset.items.map((item) => item.productionStatus)),
    publishability: unique(dataset.items.map((item) => item.publishability)), contentTypes: unique(dataset.items.map((item) => item.primaryContentType)),
    platforms: unique(dataset.items.map((item) => item.primaryPlatform)), languages: unique(dataset.items.map((item) => item.language)),
    funnels: unique(dataset.items.map((item) => item.funnelStage)), segments: unique(dataset.items.map((item) => item.primarySegment)),
    clusters: unique(dataset.items.map((item) => item.clusterId)), nodeRoles: unique(dataset.items.map((item) => item.nodeRole)),
  }), [dataset.items, schedule.plans]);

  const filtered = useMemo(() => {
    const matches = schedule.plans.filter((plan) => {
      const item = plan.item;
      if (!filters.showInternal && /internal architecture/i.test(item.publishability)) return false;
      const q = norm(query);
      if (q && !norm([item.productionId, item.nodeId, item.workingTitle, item.clusterId, item.primarySegment].join(" ")).includes(q)) return false;
      if (filters.priorityBand !== "all" && item.priorityBand !== filters.priorityBand) return false;
      if (filters.employee !== "all" && plan.currentOwner !== filters.employee) return false;
      if (filters.role !== "all" && plan.currentRole !== filters.role) return false;
      if (filters.status !== "all" && item.productionStatus !== filters.status) return false;
      if (filters.publishability !== "all" && item.publishability !== filters.publishability) return false;
      if (filters.contentType !== "all" && item.primaryContentType !== filters.contentType) return false;
      if (filters.platform !== "all" && item.primaryPlatform !== filters.platform) return false;
      if (filters.language !== "all" && item.language !== filters.language) return false;
      if (filters.funnelStage !== "all" && item.funnelStage !== filters.funnelStage) return false;
      if (filters.segment !== "all" && item.primarySegment !== filters.segment) return false;
      if (filters.cluster !== "all" && item.clusterId !== filters.cluster) return false;
      if (filters.nodeRole !== "all" && item.nodeRole !== filters.nodeRole) return false;
      if (filters.overdueOnly && !plan.overdue) return false;
      if (filters.atRiskOnly && plan.scheduleRisk === "on_track") return false;
      const publish = dateKey(plan.scheduledPublishDate || item.targetPublishDate);
      if (filters.dateFrom && publish && publish < filters.dateFrom) return false;
      if (filters.dateTo && publish && publish > filters.dateTo) return false;
      return true;
    });
    return matches.sort((a, b) => {
      if (sortBy === "publish") return (dateKey(a.scheduledPublishDate) || "9999").localeCompare(dateKey(b.scheduledPublishDate) || "9999");
      if (sortBy === "overdue") return Number(b.overdue) - Number(a.overdue) || a.nextDeadline.localeCompare(b.nextDeadline);
      if (sortBy === "risk") return Number(b.scheduleRisk !== "on_track") - Number(a.scheduleRisk !== "on_track") || b.capacityWarnings.length - a.capacityWarnings.length;
      const rank = (value: string) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[value] ?? 4);
      return rank(a.item.priorityBand) - rank(b.item.priorityBand) || b.item.priorityScore - a.item.priorityScore;
    });
  }, [filters, query, schedule.plans, sortBy]);

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  const inThisWeek = (value: string) => { const date = new Date(value); return !Number.isNaN(date.getTime()) && date >= weekStart && date < weekEnd; };
  const active = schedule.plans.filter((plan) => !/published|paused/i.test(plan.item.productionStatus)).length;
  const overdue = schedule.plans.filter((plan) => plan.overdue).length;
  const atRisk = schedule.plans.filter((plan) => plan.scheduleRisk !== "on_track").length;
  const ready = schedule.plans.filter((plan) => norm(plan.item.productionStatus) === "ready").length;
  const scheduledWeek = schedule.plans.filter((plan) => norm(plan.item.productionStatus) === "scheduled" && inThisWeek(plan.scheduledPublishDate)).length;
  const publishedWeek = schedule.plans.filter((plan) => norm(plan.item.productionStatus) === "published" && inThisWeek(plan.item.publishDate)).length;
  const p0Backlog = schedule.plans.filter((plan) => plan.item.priorityBand === "P0" && norm(plan.item.productionStatus) === "backlog").length;
  const currentCapacity = schedule.capacity.filter((entry) => entry.week === dateKey(weekStart.toISOString()));
  const capacityAverage = currentCapacity.length ? Math.round(currentCapacity.reduce((sum, entry) => sum + entry.utilization, 0) / currentCapacity.length) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Content Kanban</h1><p className="text-[11px] text-slate-500">Google Sheet production database · read-only</p></div>
        <div className="relative ml-auto min-w-[240px] max-w-[420px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kontent, Node_ID yoki cluster…" className="h-9 bg-slate-50 pl-9 shadow-none" /></div>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700"><option value="priority">Priority first</option><option value="publish">Publish date first</option><option value="overdue">Overdue first</option><option value="risk">Workload risk first</option></select>
        <Button variant="outline" size="sm" className="h-9" onClick={onRefresh} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh</Button>
        <span className="text-[11px] text-slate-400">{formatDisplayDate(lastSynced, true)}</span>
      </div>

      <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-3 lg:px-5"><div className="flex min-w-max gap-2"><Counter label="Active content" value={active} /><Counter label="Overdue" value={overdue} tone="red" /><Counter label="At risk" value={atRisk} tone="amber" /><Counter label="Ready" value={ready} tone="emerald" /><Counter label="Scheduled this week" value={scheduledWeek} tone="blue" /><Counter label="Published this week" value={publishedWeek} /><Counter label="P0 backlog" value={p0Backlog} tone="red" /><Counter label="Team capacity avg" value={`${capacityAverage}%`} tone={capacityAverage > 100 ? "red" : capacityAverage >= 80 ? "amber" : "emerald"} /></div></div>

      <details className="group shrink-0 border-b border-slate-200 bg-white">
        <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold text-slate-600 lg:px-5"><Filter className="size-4" /> Kengaytirilgan filtrlar <Badge variant="secondary">{filtered.length}</Badge><ChevronDown className="ml-auto size-4 transition group-open:rotate-180" /></summary>
        <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <SelectField label="Priority Band" value={filters.priorityBand} options={options.priorities} onChange={(value) => setFilters((f) => ({ ...f, priorityBand: value }))} />
          <SelectField label="Employee" value={filters.employee} options={options.employees} onChange={(value) => setFilters((f) => ({ ...f, employee: value }))} />
          <SelectField label="Role" value={filters.role} options={options.roles} onChange={(value) => setFilters((f) => ({ ...f, role: value }))} />
          <SelectField label="Status" value={filters.status} options={options.statuses} onChange={(value) => setFilters((f) => ({ ...f, status: value }))} />
          <SelectField label="Publishability" value={filters.publishability} options={options.publishability} onChange={(value) => setFilters((f) => ({ ...f, publishability: value }))} />
          <SelectField label="Content Type" value={filters.contentType} options={options.contentTypes} onChange={(value) => setFilters((f) => ({ ...f, contentType: value }))} />
          <SelectField label="Platform" value={filters.platform} options={options.platforms} onChange={(value) => setFilters((f) => ({ ...f, platform: value }))} />
          <SelectField label="Language" value={filters.language} options={options.languages} onChange={(value) => setFilters((f) => ({ ...f, language: value }))} />
          <SelectField label="Funnel Stage" value={filters.funnelStage} options={options.funnels} onChange={(value) => setFilters((f) => ({ ...f, funnelStage: value }))} />
          <SelectField label="Primary Segment" value={filters.segment} options={options.segments} onChange={(value) => setFilters((f) => ({ ...f, segment: value }))} />
          <SelectField label="Cluster" value={filters.cluster} options={options.clusters} onChange={(value) => setFilters((f) => ({ ...f, cluster: value }))} />
          <SelectField label="Node Role" value={filters.nodeRole} options={options.nodeRoles} onChange={(value) => setFilters((f) => ({ ...f, nodeRole: value }))} />
          <label className="grid gap-1.5"><span className="text-[11px] font-bold uppercase text-slate-400">Date from</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((f) => ({ ...f, dateFrom: event.target.value }))} className="h-9 rounded-lg border border-slate-200 px-2 text-[13px]" /></label>
          <label className="grid gap-1.5"><span className="text-[11px] font-bold uppercase text-slate-400">Date to</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((f) => ({ ...f, dateTo: event.target.value }))} className="h-9 rounded-lg border border-slate-200 px-2 text-[13px]" /></label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" checked={filters.overdueOnly} onChange={(event) => setFilters((f) => ({ ...f, overdueOnly: event.target.checked }))} /> Overdue only</label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" checked={filters.atRiskOnly} onChange={(event) => setFilters((f) => ({ ...f, atRiskOnly: event.target.checked }))} /> At-risk only</label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" checked={filters.showInternal} onChange={(event) => setFilters((f) => ({ ...f, showInternal: event.target.checked }))} /> Internal architecture</label>
          <Button variant="outline" size="sm" className="self-end" onClick={() => setFilters(INITIAL_FILTERS)}><Settings2 className="size-4" /> Filtrlarni tozalash</Button>
        </div>
      </details>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3 lg:p-4">
        <div className="flex h-full min-w-max gap-3">
          {COLUMNS.map((column) => {
            const cards = filtered.filter((plan) => norm(plan.item.productionStatus) === norm(column));
            const visibleCards = cards.slice(0, columnLimits[column] ?? 60);
            return <section key={column} className="flex h-full w-[286px] shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-100/70">
              <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-3.5"><h2 className="text-[12px] font-bold tracking-[0.05em] text-slate-700">{column.toUpperCase()}</h2><Badge variant="secondary">{cards.length}</Badge></header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 scrollbar-thin">{visibleCards.map((plan) => <KanbanCard key={plan.item.productionId} plan={plan} onClick={() => setSelection(plan)} />)}{visibleCards.length < cards.length && <Button variant="outline" size="sm" className="w-full bg-white" onClick={() => setColumnLimits((current) => ({ ...current, [column]: (current[column] ?? 60) + 60 }))}>Yana {Math.min(60, cards.length - visibleCards.length)} ta ko‘rsatish</Button>}{!cards.length && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-[12px] text-slate-400">Bu ustunda kontent yo‘q</div>}</div>
            </section>;
          })}
        </div>
      </div>
      <ProductionDrawer plan={selection} dataset={dataset} onClose={() => setSelection(null)} />
    </div>
  );
}
