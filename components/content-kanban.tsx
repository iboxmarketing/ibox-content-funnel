"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, CircleDot, Filter, GripVertical, Link2, Loader2, RefreshCw, Search, Settings2, UserRound, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductionDrawer } from "@/components/production-drawer";
import { dateKey, formatDisplayDate } from "@/lib/scheduling-engine";
import type { ProductionDataset, ProductionPlan, ProductionTaskStatus, ScheduleResult, ScheduledStage, TeamMember } from "@/lib/production-types";

const COLUMNS = ["Backlog", "Research", "Writing", "Review", "Ready", "Scheduled", "Published", "Paused"];
const TASK_COLUMNS: Array<{ id: ProductionTaskStatus; label: string; description: string }> = [
  { id: "pending", label: "Kutilmoqda", description: "Dependency yoki boshlanishini kutmoqda" },
  { id: "in_progress", label: "Jarayonda", description: "Hozir bajarilayotgan ishlar" },
  { id: "blocked", label: "Bloklangan", description: "To‘siq yoki tuzatish talab qiladi" },
  { id: "done", label: "Bajarildi", description: "Yakunlangan workflow tasklari" },
];

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

function KanbanCard({ plan, toolName, onClick }: { plan: ProductionPlan; toolName?: string; onClick: () => void }) {
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
        {item.toolId && <Badge variant="outline" title={toolName || `Tool: ${item.toolId}`} className="h-5 gap-1 border-blue-200 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-700"><Wrench className="size-3" /> Tool · {item.toolId}</Badge>}
        {item.mofBridgeId && <Badge variant="outline" title={`MOF: ${item.mofBridgeId}`} className="h-5 gap-1 border-violet-200 bg-violet-50 px-1.5 text-[9px] font-semibold text-violet-700"><Link2 className="size-3" /> MOF · {item.mofBridgeId}</Badge>}
      </div>
    </button>
  );
}

function TaskCard({
  plan,
  stage,
  status,
  assigneeId,
  team,
  saving,
  onOpen,
  onAssigneeChange,
}: {
  plan: ProductionPlan;
  stage: ScheduledStage;
  status: ProductionTaskStatus;
  assigneeId: string;
  team: TeamMember[];
  saving: boolean;
  onOpen: () => void;
  onAssigneeChange: (assigneeId: string) => void;
}) {
  const item = plan.item;
  const overdue = Boolean(stage.endDate && dateKey(stage.endDate) < dateKey(new Date().toISOString()) && status !== "done");
  return (
    <article
      draggable={!saving && !stage.locked}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-ibox-task", JSON.stringify({ taskId: stage.taskId, productionId: item.productionId, stageId: stage.stageId }));
      }}
      className={`group rounded-xl border bg-white p-3 shadow-[0_2px_8px_rgba(16,24,40,.04)] transition hover:border-blue-300 hover:shadow-[0_8px_20px_rgba(16,24,40,.08)] ${saving ? "cursor-wait opacity-70" : stage.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${overdue ? "border-red-200" : "border-slate-200"}`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-2">
          <GripVertical className="size-4 shrink-0 text-slate-400 transition group-hover:text-blue-600" />
          <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${priorityTone(item.priorityBand)}`}>{item.priorityBand}</Badge>
          <Badge variant="outline" className="h-5 max-w-[125px] truncate border-blue-200 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">{stage.stageName}</Badge>
          {saving && <Loader2 className="ml-auto size-3.5 animate-spin text-blue-600" />}
        </div>
        <h3 className="mt-2 line-clamp-2 text-[13px] font-semibold leading-[18px] text-slate-900">{item.workingTitle}</h3>
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-500"><span className="truncate">{stage.taskId}</span><span className="shrink-0">{item.nodeId}</span></div>
      </button>

      <div className="mt-3 border-t border-slate-100 pt-2.5">
        <label className="block text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400">Assignee</label>
        <select
          value={assigneeId}
          disabled={saving || stage.locked}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onAssigneeChange(event.target.value)}
          className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-400"
        >
          <option value="">Tayinlanmagan · {stage.ownerRole}</option>
          {team.map((member) => <option key={member.employeeId} value={member.employeeId}>{member.employeeName}{norm(member.employeeName) === norm(member.role) ? "" : ` · ${member.role}`}</option>)}
        </select>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><CalendarClock className="size-3.5" /><span>{formatDisplayDate(stage.startDate)} → <strong className={overdue ? "text-red-700" : "text-slate-700"}>{formatDisplayDate(stage.endDate)}</strong></span></div>
        <p className="mt-1.5 text-[10px] text-slate-400">{stage.durationWorkdays} ish kuni · {stage.ownerRole}</p>
        {stage.dependencyStageIds.length > 0 && <p className="mt-1.5 line-clamp-1 text-[10px] text-slate-400">Bog‘liq: {stage.dependencyStageIds.join(" + ")}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {overdue && <Badge variant="outline" className="h-5 border-red-200 bg-red-50 px-1.5 text-[9px] text-red-700">OVERDUE</Badge>}
          {item.toolId && <Badge variant="outline" className="h-5 gap-1 border-blue-200 bg-blue-50 px-1.5 text-[9px] text-blue-700"><Wrench className="size-3" /> Tool · {item.toolId}</Badge>}
          {stage.locked && <Badge variant="outline" className="h-5 border-amber-200 bg-amber-50 px-1.5 text-[9px] text-amber-700">LOCKED</Badge>}
        </div>
      </div>
    </article>
  );
}

export function ContentKanban({ dataset, schedule, onRefresh, refreshing, lastSynced }: { dataset: ProductionDataset; schedule: ScheduleResult; onRefresh: () => void; refreshing: boolean; lastSynced: string }) {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("priority");
  const [selection, setSelection] = useState<ProductionPlan | null>(null);
  const [boardMode, setBoardMode] = useState<"tasks" | "content">("tasks");
  const [taskStatusOverrides, setTaskStatusOverrides] = useState<Record<string, ProductionTaskStatus>>({});
  const [taskAssigneeOverrides, setTaskAssigneeOverrides] = useState<Record<string, string>>({});
  const [savingTasks, setSavingTasks] = useState<Set<string>>(new Set());
  const [taskError, setTaskError] = useState("");
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.map((column) => [column, 60])));
  const options = useMemo(() => ({
    priorities: unique(dataset.items.map((item) => item.priorityBand)), employees: unique(schedule.plans.flatMap((plan) => plan.stages.map((stage) => stage.ownerName))),
    roles: unique(schedule.plans.flatMap((plan) => plan.stages.map((stage) => stage.ownerRole))), statuses: unique(dataset.items.map((item) => item.productionStatus)),
    publishability: unique(dataset.items.map((item) => item.publishability)), contentTypes: unique(dataset.items.map((item) => item.primaryContentType)),
    platforms: unique(dataset.items.map((item) => item.primaryPlatform)), languages: unique(dataset.items.map((item) => item.language)),
    funnels: unique(dataset.items.map((item) => item.funnelStage)), segments: unique(dataset.items.map((item) => item.primarySegment)),
    clusters: unique(dataset.items.map((item) => item.clusterId)), nodeRoles: unique(dataset.items.map((item) => item.nodeRole)),
  }), [dataset.items, schedule.plans]);
  const toolById = useMemo(() => new Map(dataset.tools.map((tool) => [tool.toolId, tool])), [dataset.tools]);
  const activeTeam = useMemo(() => dataset.team.filter((member) => member.active), [dataset.team]);

  const persistTask = async (plan: ProductionPlan, stage: ScheduledStage, patch: { status?: ProductionTaskStatus; assigneeId?: string }) => {
    const previousStatus = taskStatusOverrides[stage.taskId];
    const previousAssignee = taskAssigneeOverrides[stage.taskId];
    if (patch.status) setTaskStatusOverrides((current) => ({ ...current, [stage.taskId]: patch.status! }));
    if (patch.assigneeId !== undefined) setTaskAssigneeOverrides((current) => ({ ...current, [stage.taskId]: patch.assigneeId! }));
    setSavingTasks((current) => new Set(current).add(stage.taskId));
    setTaskError("");
    try {
      const response = await fetch("/api/production/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: stage.taskId, productionId: plan.item.productionId, stageId: stage.stageId, ...patch }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Task saqlanmadi");
      window.setTimeout(() => onRefresh(), 150);
    } catch (error) {
      if (patch.status) setTaskStatusOverrides((current) => { const next = { ...current }; if (previousStatus) next[stage.taskId] = previousStatus; else delete next[stage.taskId]; return next; });
      if (patch.assigneeId !== undefined) setTaskAssigneeOverrides((current) => { const next = { ...current }; if (previousAssignee !== undefined) next[stage.taskId] = previousAssignee; else delete next[stage.taskId]; return next; });
      setTaskError(error instanceof Error ? error.message : "Task saqlanmadi");
    } finally {
      setSavingTasks((current) => { const next = new Set(current); next.delete(stage.taskId); return next; });
    }
  };

  const filtered = useMemo(() => {
    const matches = schedule.plans.filter((plan) => {
      const item = plan.item;
      if (!filters.showInternal && /internal architecture/i.test(item.publishability)) return false;
      const q = norm(query);
      if (q && !norm([item.productionId, item.nodeId, item.workingTitle, item.clusterId, item.primarySegment].join(" ")).includes(q)) return false;
      if (filters.priorityBand !== "all" && item.priorityBand !== filters.priorityBand) return false;
      if (filters.employee !== "all" && !plan.stages.some((stage) => stage.ownerName === filters.employee)) return false;
      if (filters.role !== "all" && !plan.stages.some((stage) => stage.ownerRole === filters.role)) return false;
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
  const taskEntries = useMemo(() => filtered.flatMap((plan) => plan.stages.map((stage) => ({ plan, stage }))), [filtered]);
  const taskCardsByStatus = useMemo(() => {
    const columns = new Map<ProductionTaskStatus, Array<{ plan: ProductionPlan; stage: ScheduledStage }>>(TASK_COLUMNS.map((column) => [column.id, []]));
    for (const entry of taskEntries) columns.get(taskStatusOverrides[entry.stage.taskId] ?? entry.stage.status)?.push(entry);
    for (const entries of columns.values()) entries.sort((a, b) => a.stage.endDate.localeCompare(b.stage.endDate) || b.plan.item.priorityScore - a.plan.item.priorityScore);
    return columns;
  }, [taskEntries, taskStatusOverrides]);

  const handleTaskDrop = (event: React.DragEvent<HTMLElement>, status: ProductionTaskStatus) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-ibox-task")) as { taskId?: string; productionId?: string; stageId?: string };
      const entry = taskEntries.find(({ stage }) => stage.taskId === payload.taskId);
      if (!entry || (taskStatusOverrides[entry.stage.taskId] ?? entry.stage.status) === status) return;
      if (entry.stage.locked) {
        setTaskError("Locked taskni ko‘chirish mumkin emas");
        return;
      }
      if ((status === "in_progress" || status === "done") && entry.stage.dependencyStageIds.some((dependencyId) => {
        const dependency = entry.plan.stages.find((stage) => stage.stageId === dependencyId);
        return dependency && (taskStatusOverrides[dependency.taskId] ?? dependency.status) !== "done";
      })) {
        setTaskError(`Avval bog‘liq tasklarni yakunlang: ${entry.stage.dependencyStageIds.join(", ")}`);
        return;
      }
      void persistTask(entry.plan, entry.stage, { status });
    } catch {
      setTaskError("Taskni ko‘chirish ma’lumoti o‘qilmadi");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Content Kanban</h1><p className="text-[11px] text-slate-500">Google Sheet · workflow tasklari va kontent pipeline</p></div>
        <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" onClick={() => setBoardMode("tasks")} className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition ${boardMode === "tasks" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Ish tasklari</button>
          <button type="button" onClick={() => setBoardMode("content")} className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition ${boardMode === "content" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Kontent pipeline</button>
        </div>
        <div className="relative ml-auto min-w-[240px] max-w-[420px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kontent, Node_ID yoki cluster…" className="h-9 bg-slate-50 pl-9 shadow-none" /></div>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700"><option value="priority">Priority first</option><option value="publish">Publish date first</option><option value="overdue">Overdue first</option><option value="risk">Workload risk first</option></select>
        <Button variant="outline" size="sm" className="h-9" onClick={onRefresh} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh</Button>
        <span className="text-[11px] text-slate-400">{formatDisplayDate(lastSynced, true)}</span>
      </div>

      {taskError && <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] font-medium text-amber-800"><AlertTriangle className="size-4" /> {taskError}<button type="button" onClick={() => setTaskError("")} className="ml-auto font-semibold hover:text-amber-950">Yopish</button></div>}

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
        {boardMode === "tasks" ? (
          <div className="flex h-full min-w-max gap-3">
            {TASK_COLUMNS.map((column) => {
              const cards = taskCardsByStatus.get(column.id) ?? [];
              const visibleCards = cards.slice(0, columnLimits[`task-${column.id}`] ?? 60);
              return <section key={column.id} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => handleTaskDrop(event, column.id)} className="flex h-full w-[310px] shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-100/70 transition-colors hover:bg-slate-100">
                <header className="shrink-0 border-b border-slate-200 px-3.5 py-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2">{column.id === "done" ? <CheckCircle2 className="size-4 text-emerald-600" /> : column.id === "blocked" ? <AlertTriangle className="size-4 text-red-600" /> : <CircleDot className={`size-4 ${column.id === "in_progress" ? "text-blue-600" : "text-slate-400"}`} />}<h2 className="text-[12px] font-bold tracking-[0.04em] text-slate-700">{column.label.toUpperCase()}</h2></div><Badge variant="secondary">{cards.length}</Badge></div><p className="mt-1 text-[10px] text-slate-400">{column.description}</p></header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 scrollbar-thin">
                  {visibleCards.map(({ plan, stage }) => <TaskCard key={stage.taskId} plan={plan} stage={stage} status={taskStatusOverrides[stage.taskId] ?? stage.status} assigneeId={taskAssigneeOverrides[stage.taskId] ?? stage.ownerId} team={activeTeam} saving={savingTasks.has(stage.taskId)} onOpen={() => setSelection(plan)} onAssigneeChange={(assigneeId) => void persistTask(plan, stage, { assigneeId })} />)}
                  {visibleCards.length < cards.length && <Button variant="outline" size="sm" className="w-full bg-white" onClick={() => setColumnLimits((current) => ({ ...current, [`task-${column.id}`]: (current[`task-${column.id}`] ?? 60) + 60 }))}>Yana {Math.min(60, cards.length - visibleCards.length)} ta ko‘rsatish</Button>}
                  {!cards.length && <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-center text-[12px] text-slate-400">Taskni shu yerga olib keling</div>}
                </div>
              </section>;
            })}
          </div>
        ) : (
          <div className="flex h-full min-w-max gap-3">
            {COLUMNS.map((column) => {
              const cards = filtered.filter((plan) => norm(plan.item.productionStatus) === norm(column));
              const visibleCards = cards.slice(0, columnLimits[column] ?? 60);
              return <section key={column} className="flex h-full w-[286px] shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-100/70">
                <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-3.5"><h2 className="text-[12px] font-bold tracking-[0.05em] text-slate-700">{column.toUpperCase()}</h2><Badge variant="secondary">{cards.length}</Badge></header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 scrollbar-thin">{visibleCards.map((plan) => <KanbanCard key={plan.item.productionId} plan={plan} toolName={toolById.get(plan.item.toolId)?.toolName} onClick={() => setSelection(plan)} />)}{visibleCards.length < cards.length && <Button variant="outline" size="sm" className="w-full bg-white" onClick={() => setColumnLimits((current) => ({ ...current, [column]: (current[column] ?? 60) + 60 }))}>Yana {Math.min(60, cards.length - visibleCards.length)} ta ko‘rsatish</Button>}{!cards.length && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-[12px] text-slate-400">Bu ustunda kontent yo‘q</div>}</div>
              </section>;
            })}
          </div>
        )}
      </div>
      <ProductionDrawer plan={selection} dataset={dataset} onClose={() => setSelection(null)} />
    </div>
  );
}
