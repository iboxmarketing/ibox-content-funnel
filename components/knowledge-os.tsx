"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Columns3,
  FileStack,
  FilterX,
  GitBranch,
  LayoutDashboard,
  Layers3,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  Settings2,
  Wrench,
} from "lucide-react";
import { KnowledgeCanvas } from "@/components/knowledge-canvas";
import { KnowledgeDrawer } from "@/components/knowledge-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatalogPreview } from "@/lib/catalog-adapter";
import type { DemoCp070Catalog } from "@/lib/catalog-fixtures";
import type { CtaDestinationPreviewFixture } from "@/lib/cta-destination-fixtures";
import type { AssistantContextPreviewFixture } from "@/lib/assistant-context-fixtures";
import type { MaterialWorkplanPreviewFixture } from "@/lib/material-workplan-fixtures";
import type { TrackingPreviewFixture } from "@/lib/tracking-preview-fixtures";
import type { KnowledgeApiResponse, KnowledgeGraph } from "@/lib/knowledge-types";
import { applyScheduleOverrides, recalculateSchedule, type ScheduleOverrides } from "@/lib/scheduling-engine";
import type { ProductionApiResponse, ProductionDataset } from "@/lib/production-types";

type Filters = {
  area: string;
  businessType: string;
  segment: string;
  priority: string;
  responsible: string;
};

type SearchResult = {
  key: string;
  nodeId: string;
  type: "Jarayon" | "Muammo" | "Bosqich" | "Canonical";
  title: string;
  subtitle: string;
  processId?: string;
};

const EMPTY_FILTERS: Filters = { area: "all", businessType: "all", segment: "all", priority: "all", responsible: "all" };

type MainView = "mindmap" | "packages" | "kanban" | "calendar" | "settings";

const ContentKanban = dynamic(() => import("@/components/content-kanban").then((module) => module.ContentKanban), { ssr: false });
const ContentCalendar = dynamic(() => import("@/components/content-calendar").then((module) => module.ContentCalendar), { ssr: false });
const TopicPackages = dynamic(() => import("@/components/topic-packages").then((module) => module.TopicPackages), { ssr: false });

const ProductionSettings = dynamic(() => import("@/components/production-settings").then((module) => module.ProductionSettings), { ssr: false });

const ACTIVE_VIEWS: Array<{ id: MainView; label: string; icon: typeof Network }> = [
  { id: "mindmap", label: "Mind Map", icon: Network },
  { id: "packages", label: "Mavzu paketlari", icon: Layers3 },
  { id: "kanban", label: "Content Kanban", icon: Columns3 },
  { id: "calendar", label: "Content Calendar", icon: CalendarDays },
  { id: "settings", label: "Sozlamalar", icon: Settings2 },
];

const FUTURE_VIEWS = [
  { label: "Content Nodes", icon: FileStack },
  { label: "Tools", icon: Wrench },
  { label: "Customer Journey / MOF", icon: GitBranch },
  { label: "Dashboard", icon: LayoutDashboard },
];

function localPreviewFixture(name: "MINDMAP_UI_REGRESSION" | "REAL_SNAPSHOT_REGRESSION") {
  return typeof window !== "undefined" && window.location.hostname === "terminal.local" ? name : null;
}

function normalized(value: string) {
  return value.toLocaleLowerCase("uz").replace(/[’‘`ʻʼ]/g, "'").trim();
}

function includes(value: string, query: string) {
  return normalized(value).includes(normalized(query));
}

function splitOptions(values: string[]) {
  const options = new Map<string, string>();
  for (const value of values) {
    value.split(/[,;|/\n]+/).map((part) => part.trim()).filter(Boolean).forEach((part) => options.set(normalized(part), part));
  }
  return Array.from(options.values()).sort((a, b) => a.localeCompare(b, "uz"));
}

function formatSyncedAt(value: string | null) {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
}

function FilterSelect({ value, onValueChange, label, options, className = "" }: { value: string; onValueChange: (value: string) => void; label: string; options: Array<string | { value: string; label: string }>; className?: string }) {
  const selected = options.map((option) => typeof option === "string" ? { value: option, label: option } : option).find((option) => option.value === value);
  const active = value !== "all";
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next ?? "all")}>
      <SelectTrigger size="sm" className={`h-10 min-w-[132px] cursor-pointer rounded-xl px-3 font-medium shadow-none transition-colors data-[state=open]:border-blue-300 data-[state=open]:ring-2 data-[state=open]:ring-blue-100 ${active ? "border-blue-200 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/50"} ${className}`} aria-label={label}>
        <SelectValue placeholder={label}><span className="flex min-w-0 items-center gap-2">{active && <span className="size-1.5 shrink-0 rounded-full bg-blue-600" />}<span className="truncate">{value === "all" ? label : selected?.label ?? value}</span></span></SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="all">Barchasi</SelectItem>
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

function SetupState({ missing, spreadsheetIdConfigured }: { missing: string[]; spreadsheetIdConfigured: boolean }) {
  const variables = [
    { key: "GOOGLE_SHEET_ID", description: "Google Sheet identifikatori", ready: spreadsheetIdConfigured },
    { key: "GOOGLE_SERVICE_ACCOUNT_EMAIL", description: "Viewer sifatida ulashiladigan service-account email", ready: !missing.includes("GOOGLE_SERVICE_ACCOUNT_EMAIL") },
    { key: "GOOGLE_PRIVATE_KEY", description: "Service account private key; secret sifatida saqlanadi", ready: !missing.includes("GOOGLE_PRIVATE_KEY") },
  ];
  return (
    <div className="relative flex h-full items-center justify-center overflow-auto bg-[#F7F9FC] p-5" style={{ backgroundImage: "radial-gradient(circle, #CBD5E1 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(16,24,40,.10)] sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Settings2 className="size-6" /></div>
        <Badge variant="outline" className="mt-5 border-amber-200 bg-amber-50 text-amber-700">Google Sheets ulanishi kutilmoqda</Badge>
        <h2 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-slate-950">Tizimni ishga tushirish uchun {missing.length} ta qiymat yetishmayapti</h2>
        <p className="mt-2 max-w-xl text-[15px] leading-6 text-slate-600">Google Sheet service-account email bilan <strong>Viewer</strong> sifatida ulashilgach, sayt eng so‘nggi ma’lumotlarni faqat serverda o‘qiydi. Real task va statuslar alohida task bot backendida saqlanadi; maxfiy kalit brauzerga yuborilmaydi.</p>
        <div className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {variables.map((variable) => (
            <div key={variable.key} className="flex items-start gap-3 p-4">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${variable.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {variable.ready ? <Check className="size-4" /> : <CircleDot className="size-4" />}
              </span>
              <div className="min-w-0"><code className="text-[13px] font-bold text-slate-900">{variable.key}</code><p className="mt-1 text-[13px] leading-5 text-slate-500">{variable.description}</p></div>
              <Badge variant="outline" className={`ml-auto shrink-0 ${variable.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>{variable.ready ? "Tayyor" : "Kiritilmagan"}</Badge>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-[13px] leading-5 text-slate-600"><strong>Keyingi qadam:</strong> service-account emailni Google Sheet’ga Viewer qilib qo‘shing va yuqoridagi qiymatlarni Site environment variables bo‘limiga kiriting. Ulanishdan keyin barcha viewlar avtomatik yangilanadi.</div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="relative h-full overflow-hidden bg-[#F7F9FC] p-12" style={{ backgroundImage: "radial-gradient(circle, #CBD5E1 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <div className="flex min-w-[980px] gap-20">
        {[0, 1, 2, 3].map((column) => <div key={column} className="space-y-7" style={{ width: column === 0 ? 240 : 280 }}>
          {Array.from({ length: column + 3 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-2xl bg-slate-200/80" />)}
        </div>)}
      </div>
      <div className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg"><RefreshCw className="mr-2 inline size-4 animate-spin text-blue-700" /> Google Sheet’dan bilimlar xaritasi olinmoqda…</div>
    </div>
  );
}

export function KnowledgeOS() {
  const [scheduleOverrides, setScheduleOverrides] = useState<ScheduleOverrides>({});
  const simulation = Object.keys(scheduleOverrides).length > 0;
  const [activeView, setActiveView] = useState<MainView>("mindmap");
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [production, setProduction] = useState<ProductionDataset | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null);
  const [catalogDemo, setCatalogDemo] = useState<DemoCp070Catalog | null>(null);
  const [ctaPreview, setCtaPreview] = useState<CtaDestinationPreviewFixture | null>(null);
  const [assistantPreview, setAssistantPreview] = useState<AssistantContextPreviewFixture | null>(null);
  const [materialWorkplanPreview, setMaterialWorkplanPreview] = useState<MaterialWorkplanPreviewFixture | null>(null);
  const [trackingPreview, setTrackingPreview] = useState<TrackingPreviewFixture | null>(null);
  const [catalogOrigin, setCatalogOrigin] = useState<"LOCAL_REGRESSION_FIXTURE" | "CONNECTOR_LIVE_READ">("LOCAL_REGRESSION_FIXTURE");
  const [setup, setSetup] = useState<{ missing: string[]; spreadsheetIdConfigured: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [productionSynced, setProductionSynced] = useState<string | null>(null);
  const [catalogSynced, setCatalogSynced] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selection, setSelection] = useState<{ type: "process" | "problem"; id: string } | null>(null);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const initialGraphLoaded = useRef(false);

  const loadData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (manual) params.set("refresh", "1");
      const fixture = localPreviewFixture("MINDMAP_UI_REGRESSION");
      if (fixture) params.set("fixture", fixture);
      const response = await fetch(`/api/knowledge?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as KnowledgeApiResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Google Sheets bilan sinxronlash amalga oshmadi");
      if (!payload.configured) {
        setSetup({ missing: payload.missing, spreadsheetIdConfigured: payload.spreadsheetIdConfigured });
        setGraph(null);
      } else {
        setGraph(payload.graph);
        setSetup(null);
        setLastSynced(payload.graph.meta.loadedAt);
        setSyncError(null);
        if (!initialGraphLoaded.current) {
          setExpandedAreas(new Set(payload.graph.areas.map((area) => area.id)));
          initialGraphLoaded.current = true;
        }
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Sinxronlashda xatolik yuz berdi");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadProduction = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/production${manual ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json() as ProductionApiResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Production database bilan sinxronlash amalga oshmadi");
      if (!payload.configured) {
        setSetup({ missing: payload.missing, spreadsheetIdConfigured: payload.spreadsheetIdConfigured });
        setProduction(null);
      } else {
        setProduction(payload.dataset);
        setSetup(null);
        setProductionSynced(payload.dataset.meta.loadedAt);
        setSyncError(null);
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Production sinxronlashda xatolik yuz berdi");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadCatalog = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (manual) params.set("refresh", "1");
      const fixture = localPreviewFixture("REAL_SNAPSHOT_REGRESSION");
      if (fixture) params.set("fixture", fixture);
      const response = await fetch(`/api/catalog-preview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as (
        | { configured: true; origin: "LOCAL_REGRESSION_FIXTURE" | "CONNECTOR_LIVE_READ"; preview: CatalogPreview; demo: DemoCp070Catalog; ctaPreview: CtaDestinationPreviewFixture; assistantPreview: AssistantContextPreviewFixture; materialWorkplanPreview: MaterialWorkplanPreviewFixture; trackingPreview: TrackingPreviewFixture; error?: string }
        | { configured: false; missing: string[]; spreadsheetIdConfigured: boolean; error?: string }
      );
      if (!response.ok) throw new Error(payload.error || "Catalog preview bilan sinxronlash amalga oshmadi");
      if (!payload.configured) {
        setSetup({ missing: payload.missing, spreadsheetIdConfigured: payload.spreadsheetIdConfigured });
        setCatalogPreview(null);
        setCatalogDemo(null);
        setCtaPreview(null);
        setAssistantPreview(null);
        setMaterialWorkplanPreview(null);
        setTrackingPreview(null);
      } else {
        setCatalogPreview(payload.preview);
        setCatalogDemo(payload.demo);
        setCtaPreview(payload.ctaPreview);
        setAssistantPreview(payload.assistantPreview);
        setMaterialWorkplanPreview(payload.materialWorkplanPreview);
        setTrackingPreview(payload.trackingPreview);
        setCatalogOrigin(payload.origin);
        setCatalogSynced(payload.preview.sourceSnapshot.capturedAt);
        setSetup(null);
        setCatalogError(null);
      }
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Catalog preview sinxronlashda xatolik yuz berdi");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Data fetching is an external subscription to the Sheet-backed API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    const interval = window.setInterval(() => void loadData(), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (activeView === "mindmap" || activeView === "packages") return;
    // Load production data only when an operational view is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProduction();
    const interval = window.setInterval(() => void loadProduction(), 60_000);
    return () => window.clearInterval(interval);
  }, [activeView, loadProduction]);

  useEffect(() => {
    if (activeView !== "packages") return;
    // Catalog preview has its own 13/33/35 + 23–29 adapter and never falls back to 16/19/22.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCatalog();
    const interval = window.setInterval(() => void loadCatalog(), 60_000);
    return () => window.clearInterval(interval);
  }, [activeView, loadCatalog]);

  const baselineSchedule = useMemo(() => production ? recalculateSchedule(production) : null, [production]);
  const effectiveProduction = useMemo(() => production ? applyScheduleOverrides(production, scheduleOverrides) : null, [production, scheduleOverrides]);
  const productionSchedule = useMemo(() => effectiveProduction ? simulation ? recalculateSchedule(effectiveProduction) : baselineSchedule : null, [effectiveProduction, simulation, baselineSchedule]);

  const processById = useMemo(() => new Map(graph?.processes.map((item) => [item.id, item]) ?? []), [graph]);
  const problemById = useMemo(() => new Map(graph?.problems.map((item) => [item.id, item]) ?? []), [graph]);
  const canonicalById = useMemo(() => new Map(graph?.canonicalProblems.map((item) => [item.id, item]) ?? []), [graph]);

  const filterOptions = useMemo(() => {
    if (!graph) return { segments: [], businessTypes: [], priorities: [], responsibles: [] };
    return {
      segments: splitOptions([...graph.processes.map((item) => item.primarySegment || item.segmentUrgusi), ...graph.problems.map((item) => item.primarySegment || item.segmentUrgusi)]),
      businessTypes: splitOptions([...graph.processes.map((item) => item.businessTypeNormalized || item.mosBiznesTuri), ...graph.problems.map((item) => item.businessTypeNormalized || item.mosBiznesTuri)]),
      priorities: splitOptions(graph.problems.map((item) => item.ustuvorlik)),
      responsibles: splitOptions(graph.processes.map((item) => item.roleNormalized || item.masul)),
    };
  }, [graph]);

  const { visibleProcessIds, visibleProblemIds } = useMemo(() => {
    const processIds = new Set<string>();
    const problemIds = new Set<string>();
    if (!graph) return { visibleProcessIds: processIds, visibleProblemIds: problemIds };

    for (const process of graph.processes) {
      if (filters.area !== "all" && process.areaId !== filters.area) continue;
      const related = process.problemIds.map((id) => problemById.get(id)).filter(Boolean);
      const businessMatch = filters.businessType === "all" || includes(process.businessTypeNormalized || process.mosBiznesTuri, filters.businessType) || related.some((problem) => problem && includes(problem.businessTypeNormalized || problem.mosBiznesTuri, filters.businessType));
      const segmentMatch = filters.segment === "all" || includes(`${process.primarySegment} ${process.segmentTags} ${process.segmentUrgusi}`, filters.segment) || related.some((problem) => problem && includes(`${problem.primarySegment} ${problem.segmentTags} ${problem.segmentUrgusi}`, filters.segment));
      const priorityMatch = filters.priority === "all" || related.some((problem) => problem && includes(problem.ustuvorlik, filters.priority));
      const responsibleMatch = filters.responsible === "all" || includes(process.roleNormalized || process.masul, filters.responsible);
      if (businessMatch && segmentMatch && priorityMatch && responsibleMatch) processIds.add(process.id);
    }

    for (const problem of graph.problems) {
      const process = processById.get(problem.jarayonId);
      if (!process || !processIds.has(process.id)) continue;
      const priorityMatch = filters.priority === "all" || includes(problem.ustuvorlik, filters.priority);
      const businessMatch = filters.businessType === "all" || includes(problem.businessTypeNormalized || problem.mosBiznesTuri, filters.businessType) || includes(process.businessTypeNormalized || process.mosBiznesTuri, filters.businessType);
      const segmentMatch = filters.segment === "all" || includes(`${problem.primarySegment} ${problem.segmentTags} ${problem.segmentUrgusi}`, filters.segment) || includes(`${process.primarySegment} ${process.segmentTags} ${process.segmentUrgusi}`, filters.segment);
      if (priorityMatch && businessMatch && segmentMatch) problemIds.add(problem.id);
    }
    return { visibleProcessIds: processIds, visibleProblemIds: problemIds };
  }, [filters, graph, problemById, processById]);

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!graph || normalized(deferredSearchQuery).length < 2) return [];
    const query = normalized(deferredSearchQuery);
    const results: Array<SearchResult & { score: number }> = [];
    for (const process of graph.processes) {
      const haystack = [process.jarayonId, process.kichikJarayon, process.bosqich, process.jarayonGuruhi, process.masul].join(" ");
      if (includes(haystack, query)) results.push({ key: `p-${process.id}`, nodeId: process.id, type: "Jarayon", title: process.kichikJarayon || process.jarayonId, subtitle: `${process.jarayonId} · ${process.bosqich || process.jarayonGuruhi}`, processId: process.id, score: normalized(process.jarayonId) === query ? 100 : normalized(process.kichikJarayon).startsWith(query) ? 80 : 50 });
    }
    for (const problem of graph.problems) {
      const canonical = canonicalById.get(problem.canonicalProblemId);
      const haystack = [problem.muammoId, problem.muammo, problem.ustuvorlik, problem.canonicalProblemId, canonical?.title ?? ""].join(" ");
      if (includes(haystack, query)) results.push({ key: `m-${problem.id}`, nodeId: problem.id, type: canonical && includes(canonical.title, query) ? "Canonical" : "Muammo", title: problem.muammo || problem.muammoId, subtitle: `${problem.muammoId} · ${problem.jarayonId}`, processId: problem.jarayonId, score: normalized(problem.muammoId) === query ? 100 : normalized(problem.muammo).startsWith(query) ? 80 : 45 });
    }
    for (const stage of graph.stages) {
      if (includes(`${stage.name} ${stage.bosqich} ${stage.jarayonGuruhi}`, query)) results.push({ key: `s-${stage.id}`, nodeId: stage.id, type: "Bosqich", title: stage.name, subtitle: `${stage.processCount} jarayon · ${stage.problemCount} muammo`, score: normalized(stage.name).startsWith(query) ? 70 : 35 });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 10).map((result) => ({
      key: result.key,
      nodeId: result.nodeId,
      type: result.type,
      title: result.title,
      subtitle: result.subtitle,
      processId: result.processId,
    }));
  }, [canonicalById, deferredSearchQuery, graph]);

  const focusNode = useCallback((result: SearchResult | { nodeId: string; processId?: string }) => {
    if (!graph) return false;
    let areaId: string | undefined;
    let stageId: string | undefined;
    let processId = result.processId;
    const process = processId ? processById.get(processId) : processById.get(result.nodeId);
    const problem = problemById.get(result.nodeId);
    const stage = graph.stages.find((item) => item.id === result.nodeId);
    const area = graph.areas.find((item) => item.id === result.nodeId);
    if (problem && !processId) processId = problem.jarayonId;
    const resolvedProcess = process ?? (processId ? processById.get(processId) : undefined);
    if (resolvedProcess) { areaId = resolvedProcess.areaId; stageId = resolvedProcess.stageId; }
    else if (stage) areaId = stage.areaId;
    else if (area) areaId = area.id;
    if (!areaId) return false;

    setFilters(EMPTY_FILTERS);
    setExpandedAreas((current) => new Set(current).add(areaId!));
    if (stageId) setExpandedStages((current) => new Set(current).add(stageId!));
    if (problem && processId) setExpandedProcesses((current) => new Set(current).add(processId!));
    setHighlightedId(result.nodeId);
    setFocusRequest({ id: result.nodeId, token: Date.now() });
    setSearchOpen(false);
    window.setTimeout(() => setHighlightedId((current) => current === result.nodeId ? null : current), 3200);
    return true;
  }, [graph, problemById, processById]);

  useEffect(() => {
    if (!graph) return;
    type WebMcpContext = { registerTool?: (tool: Record<string, unknown>, options?: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "focus_knowledge_node",
        title: "Bilimlar xaritasidagi tugunni ochish",
        description: "Jarayon_ID yoki Muammo_ID bo‘yicha ota tugunlarni ochadi va natijani xarita markaziga olib keladi.",
        inputSchema: { type: "object", properties: { id: { type: "string", description: "Jarayon_ID yoki Muammo_ID" } }, required: ["id"], additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input: unknown) => {
          const id = typeof input === "object" && input !== null && "id" in input ? String((input as { id: unknown }).id).trim() : "";
          if (!id) throw new Error("id is required");
          const process = processById.get(id);
          const problem = problemById.get(id);
          if (!process && !problem) throw new Error(`Node not found: ${id}`);
          focusNode({ nodeId: id, processId: problem?.jarayonId });
          return { id, type: process ? "process" : "problem", focused: true };
        },
      }, { signal: controller.signal })).catch(() => undefined);
    } catch { /* Unsupported preview/browser context. */ }
    return () => controller.abort();
  }, [focusNode, graph, problemById, processById]);

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const activeFilterCount = Object.values(filters).filter((value) => value !== "all").length;
  const hasResults = visibleProcessIds.size > 0;

  return (
    <SidebarProvider defaultOpen style={{ "--sidebar-width": "232px", "--sidebar-width-icon": "68px" } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="border-r border-[#173663] bg-[#071B3B] text-white">
        <SidebarHeader className="h-[72px] justify-center border-b border-white/10 px-3">
          <div className="flex items-center gap-3 overflow-hidden px-1">
            <div className="grid size-10 shrink-0 grid-cols-2 gap-1 rounded-xl bg-blue-600 p-2 shadow-[0_6px_18px_rgba(37,99,235,.3)]"><span className="rounded-[3px] bg-white" /><span className="rounded-[3px] bg-blue-200" /><span className="rounded-[3px] bg-blue-200" /><span className="rounded-[3px] bg-white" /></div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-[15px] font-bold tracking-[-0.02em]">IBOX Knowledge OS</p><p className="mt-0.5 text-[11px] text-blue-200/70">Internal workspace</p></div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2 py-3">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-bold uppercase tracking-[0.09em] text-blue-200/50">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ACTIVE_VIEWS.map(({ id, label, icon: Icon }) => <SidebarMenuItem key={id}><SidebarMenuButton isActive={activeView === id} tooltip={label} onClick={() => setActiveView(id)} className={`h-10 ${activeView === id ? "bg-blue-600 text-white hover:bg-blue-500 hover:text-white" : "text-blue-100/75 hover:bg-white/10 hover:text-white"}`}><Icon className="size-4" /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
                {FUTURE_VIEWS.map(({ label, icon: Icon }) => <SidebarMenuItem key={label}><SidebarMenuButton disabled tooltip={`${label} — tez kunda`} className="h-10 text-blue-100/45"><Icon className="size-4" /><span>{label}</span><span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase">Soon</span></SidebarMenuButton></SidebarMenuItem>)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2 overflow-hidden rounded-xl bg-white/5 px-3 py-2.5 text-[11px] text-blue-100/70"><span className={`size-2 shrink-0 rounded-full ${syncError || catalogError ? "bg-amber-400" : graph || production || catalogPreview ? "bg-emerald-400" : "bg-slate-400"}`} /><span className="truncate group-data-[collapsible=icon]:hidden">{syncError || catalogError ? "Sync warning" : graph || production || catalogPreview ? "Google Sheets connected" : "Setup required"}</span></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="h-svh min-w-0 overflow-hidden bg-[#F7F9FC]">
        {activeView === "mindmap" ? <>
        <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 lg:px-5">
          <SidebarTrigger className="shrink-0" />
          <div className="hidden min-w-[210px] lg:block"><h1 className="text-[16px] font-bold tracking-[-0.02em] text-slate-950">IBOX Business Knowledge OS</h1><p className="mt-0.5 text-[11px] text-slate-500">Jarayonlar va muammolar xaritasi</p></div>
          <div className="relative min-w-0 flex-1 max-w-[560px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)} onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) focusNode(searchResults[0]); }} className="h-10 rounded-xl border-slate-200 bg-slate-50/70 pl-9 pr-16 text-[14px] text-slate-900 shadow-none placeholder:text-slate-400 hover:border-blue-200 hover:bg-white focus-visible:border-blue-400 focus-visible:bg-white focus-visible:ring-blue-100" placeholder="Jarayon, muammo yoki ID bo‘yicha qidiring…" aria-label="Global qidiruv" />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:block">Enter</kbd>
            {searchOpen && normalized(searchQuery).length >= 2 && (
              <div className="absolute left-0 right-0 top-[46px] z-40 max-h-[420px] overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(16,24,40,.16)]">
                {searchResults.length ? searchResults.map((result) => <button key={result.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => focusNode(result)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-blue-50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{result.type === "Muammo" || result.type === "Canonical" ? <AlertTriangle className="size-4" /> : result.type === "Bosqich" ? <GitBranch className="size-4" /> : <Network className="size-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-slate-900">{result.title}</span><span className="mt-0.5 block truncate text-[12px] text-slate-500">{result.subtitle}</span></span>
                  <Badge variant="secondary" className="text-[10px]">{result.type}</Badge><ChevronRight className="size-4 text-slate-300" />
                </button>) : <div className="p-5 text-center text-sm text-slate-500">Hech narsa topilmadi</div>}
              </div>
            )}
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            <FilterSelect label="Yo‘nalish" value={filters.area} onValueChange={(area) => setFilters((current) => ({ ...current, area }))} options={graph?.areas.map((area) => ({ value: area.id, label: area.name })) ?? []} className="min-w-[138px]" />
            <FilterSelect label="Segment" value={filters.segment} onValueChange={(segment) => setFilters((current) => ({ ...current, segment }))} options={filterOptions.segments} />
            <FilterSelect label="Ustuvorlik" value={filters.priority} onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))} options={filterOptions.priorities} />
          </div>
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="size-10 shrink-0 rounded-xl border-slate-200 bg-white text-slate-600 shadow-none hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={() => void loadData(true)} disabled={refreshing} aria-label="Ma’lumotlarni yangilash"><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /></Button></TooltipTrigger><TooltipContent>Ma’lumotlarni yangilash</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="hidden size-10 shrink-0 rounded-xl border-slate-200 bg-white text-slate-600 shadow-none hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 sm:inline-flex" onClick={() => setFitRequest((value) => value + 1)} aria-label="Xaritani ekranga sig‘dirish"><Maximize2 className="size-4" /></Button></TooltipTrigger><TooltipContent>Fit View</TooltipContent></Tooltip>
        </header>

        <div className="flex h-[58px] shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-[#FBFCFE] px-3 scrollbar-none lg:px-5">
          <span className="mr-1 flex shrink-0 items-center gap-2 text-[12px] font-semibold text-slate-600"><span className="flex size-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700"><Settings2 className="size-4" /></span> Filtrlar</span>
          <div className="flex shrink-0 gap-2 xl:hidden"><FilterSelect label="Yo‘nalish" value={filters.area} onValueChange={(area) => setFilters((current) => ({ ...current, area }))} options={graph?.areas.map((area) => ({ value: area.id, label: area.name })) ?? []} /><FilterSelect label="Segment" value={filters.segment} onValueChange={(segment) => setFilters((current) => ({ ...current, segment }))} options={filterOptions.segments} /><FilterSelect label="Ustuvorlik" value={filters.priority} onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))} options={filterOptions.priorities} /></div>
          <FilterSelect label="Biznes turi" value={filters.businessType} onValueChange={(businessType) => setFilters((current) => ({ ...current, businessType }))} options={filterOptions.businessTypes} className="min-w-[142px]" />
          <FilterSelect label="Mas’ul" value={filters.responsible} onValueChange={(responsible) => setFilters((current) => ({ ...current, responsible }))} options={filterOptions.responsibles} />
          {activeFilterCount > 0 && <Button variant="ghost" size="sm" className="h-9 shrink-0 rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-700" onClick={() => setFilters(EMPTY_FILTERS)}><FilterX className="size-4" /> Tozalash <Badge variant="secondary" className="ml-1 bg-slate-900 text-white">{activeFilterCount}</Badge></Button>}
          <div className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-[11px] text-slate-500">
            {graph && <span>{visibleProcessIds.size} / {graph.processes.length} jarayon</span>}
            {graph && <span className={`rounded-full border px-2 py-1 font-semibold ${graph.meta.warnings.length ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{graph.meta.warnings.length ? `${graph.meta.warnings.length} data warning` : `Data healthy · ${graph.meta.stageCount} stage`}</span>}
            <span className="hidden h-4 w-px bg-slate-200 sm:block" />
            <span className="hidden sm:inline">Last synced: <strong className="font-semibold text-slate-700">{formatSyncedAt(lastSynced)}</strong></span>
          </div>
        </div>

        <main className="relative min-h-0 flex-1">
          {loading && !graph && !setup ? <LoadingState /> : setup ? <SetupState missing={setup.missing} spreadsheetIdConfigured={setup.spreadsheetIdConfigured} /> : graph ? (
            <>
              <KnowledgeCanvas
                graph={graph}
                expandedAreas={expandedAreas}
                expandedStages={expandedStages}
                expandedProcesses={expandedProcesses}
                visibleProcessIds={visibleProcessIds}
                visibleProblemIds={visibleProblemIds}
                highlightedId={highlightedId}
                focusRequest={focusRequest}
                fitRequest={fitRequest}
                onAreaToggle={(id) => toggleSet(setExpandedAreas, id)}
                onStageToggle={(id) => toggleSet(setExpandedStages, id)}
                onProcessToggle={(id) => toggleSet(setExpandedProcesses, id)}
                onProcessSelect={(id) => setSelection({ type: "process", id })}
                onProblemSelect={(id) => setSelection({ type: "problem", id })}
              />
              {!hasResults && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[2px]"><div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl"><BarChart3 className="mx-auto size-6 text-slate-400" /><h2 className="mt-3 font-bold text-slate-900">Filtrlar bo‘yicha natija topilmadi</h2><p className="mt-1 text-sm text-slate-500">Filtrlarni o‘zgartiring yoki tozalang.</p><Button className="pointer-events-auto mt-4" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>Filtrlarni tozalash</Button></div></div>}
              <KnowledgeDrawer graph={graph} selection={selection} onClose={() => setSelection(null)} onProcessSelect={(id) => setSelection({ type: "process", id })} onProblemSelect={(id) => setSelection({ type: "problem", id })} />
            </>
          ) : <div className="flex h-full items-center justify-center bg-slate-50"><div className="rounded-2xl border border-slate-200 bg-white p-6 text-center"><AlertTriangle className="mx-auto size-6 text-amber-600" /><h2 className="mt-3 font-bold">Ma’lumotlarni yuklab bo‘lmadi</h2><Button className="mt-4" onClick={() => void loadData(true)}>Qayta urinish</Button></div></div>}

          {syncError && graph && <button type="button" onClick={() => void loadData(true)} className="absolute right-5 top-4 z-30 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 shadow-lg"><AlertTriangle className="size-4" /> Sync failed — retry</button>}
        </main>
        </> : activeView === "packages" ? setup ? <SetupState missing={setup.missing} spreadsheetIdConfigured={setup.spreadsheetIdConfigured} /> : catalogPreview && catalogDemo && ctaPreview && assistantPreview && materialWorkplanPreview && trackingPreview ? (
          <div className="relative h-full min-h-0">
            <SidebarTrigger className="absolute left-2 top-2 z-50 bg-white shadow-sm lg:hidden" />
            <TopicPackages preview={catalogPreview} demo={catalogDemo} ctaPreview={ctaPreview} assistantPreview={assistantPreview} materialWorkplanPreview={materialWorkplanPreview} trackingPreview={trackingPreview} snapshotOrigin={catalogOrigin} onRefresh={() => void loadCatalog(true)} refreshing={refreshing} lastSynced={catalogSynced ?? catalogPreview.sourceSnapshot.capturedAt} />
            {catalogError && <button type="button" onClick={() => void loadCatalog(true)} className="absolute right-5 top-16 z-50 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 shadow-lg"><AlertTriangle className="size-4" /> Sync failed — retry <span className="max-w-sm truncate" title={catalogError}>{catalogError}</span></button>}
          </div>
        ) : catalogError ? (
          <div className="flex h-full items-center justify-center bg-slate-50"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center"><AlertTriangle className="mx-auto size-6 text-amber-600" /><h2 className="mt-3 font-bold">Catalog preview yuklanmadi</h2><p className="mt-2 text-sm text-slate-500">{catalogError}</p><Button className="mt-4" onClick={() => void loadCatalog(true)}>Qayta urinish</Button></div></div>
        ) : <LoadingState /> : setup ? <SetupState missing={setup.missing} spreadsheetIdConfigured={setup.spreadsheetIdConfigured} /> : production && effectiveProduction && productionSchedule && baselineSchedule ? (
          <div className="relative flex h-full min-h-0 flex-col">
            <SidebarTrigger className="absolute left-2 top-2 z-50 bg-white shadow-sm lg:hidden" />
            <div className={`shrink-0 border-b px-5 py-2 text-sm ${simulation ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              {simulation ? "Sinov faol · Kanban va Calendar umumiy hisobdan foydalanmoqda. Sheet o‘zgarmadi." : "TEST rejasi · hisoblangan sanalar prognoz; tasdiqlangan nashr majburiyati emas."}
              {simulation && <button className="ml-3 font-semibold underline" onClick={() => setScheduleOverrides({})}>Bekor qilish</button>}
            </div>
            <div className="min-h-0 flex-1">
            {activeView === "settings" ? <ProductionSettings dataset={production} baseline={baselineSchedule} schedule={productionSchedule} overrides={scheduleOverrides} onSimulate={setScheduleOverrides} onReset={() => setScheduleOverrides({})} /> : activeView === "kanban" ? (
              <ContentKanban simulation={simulation} dataset={effectiveProduction} schedule={productionSchedule} onRefresh={() => void loadProduction(true)} refreshing={refreshing} lastSynced={productionSynced ?? production.meta.loadedAt} />
            ) : (
              <ContentCalendar onSettings={() => setActiveView("settings")} dataset={effectiveProduction} baseSchedule={productionSchedule} onRefresh={() => void loadProduction(true)} refreshing={refreshing} lastSynced={productionSynced ?? production.meta.loadedAt} />
            )}
            </div>
            {syncError && <button type="button" onClick={() => void loadProduction(true)} className="absolute right-5 top-16 z-50 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 shadow-lg"><AlertTriangle className="size-4" /> Sync failed — retry <span className="max-w-sm truncate" title={syncError}>{syncError}</span></button>}
          </div>
        ) : syncError ? (
          <div className="flex h-full items-center justify-center bg-slate-50"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center"><AlertTriangle className="mx-auto size-6 text-amber-600" /><h2 className="mt-3 font-bold">Production ma’lumotlarini yuklab bo‘lmadi</h2><p className="mt-2 text-sm text-slate-500">{syncError}</p><Button className="mt-4" onClick={() => void loadProduction(true)}>Qayta urinish</Button></div></div>
        ) : <LoadingState />}
      </SidebarInset>
    </SidebarProvider>
  );
}
