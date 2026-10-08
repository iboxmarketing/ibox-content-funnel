"use client";

/**
 * Content Tree (V1 Sprint 3, section 13; Destination Library added Sprint
 * 4, section 6): browse Domain -> ProblemCategory -> ProblemPart ->
 * KnowledgeNode -> Blog -> Material. A plain nested list, not a reuse of
 * KnowledgeCanvas's Area/Stage/Process shell -- that model doesn't map
 * onto this tree and forcing it would just create conceptual confusion
 * (per instruction, correctness over visual polish).
 *
 * Angle and Destination are intentionally absent from the TREE itself --
 * they are not tree nodes. Destination is instead shown as a
 * ProblemCategory-scoped "Destination Library" section in that category's
 * own detail panel (never a global library). TaskInstances are also
 * intentionally absent from the tree -- a task operates on an entity
 * here, it never appears as a node of this tree itself.
 *
 * Deep tree-wide search/filtering (section 20) is explicitly secondary
 * and skipped this sprint beyond the one low-cost filter below (the
 * Destination Library's own status filter) -- not worth the added
 * complexity of expand-to-match tree filtering for this sprint's scope.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Lightbulb, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useContentEntityStore } from "@/components/content-entity-store-provider";
import { useContentOsStore } from "@/components/content-os-store-provider";
import { latestLearningSummary } from "@/lib/distribution";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import {
  anglesForDestination,
  blogsForNode,
  destinationsForProblemCategory,
  knowledgeNodesForPart,
  materialsForBlog,
  materialsForDestination,
  problemCategoriesForDomain,
  problemPartsForCategory,
} from "@/lib/content-entity-store";
import { DESTINATION_STATUSES, type ContentEntityType, type Destination, type DestinationStatus } from "@/lib/content-entity";

type SelectedEntity = { type: ContentEntityType; id: string } | null;

function TreeRow({ depth, label, badge, selected, onSelect, children }: { depth: number; label: string; badge?: string; selected: boolean; onSelect: () => void; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Boolean(children);
  return (
    <div>
      <div className={`flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm ${selected ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`} style={{ paddingLeft: `${8 + depth * 16}px` }}>
        {hasChildren ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-slate-400" aria-label="Kengaytirish/yopish">
            <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : <span className="inline-block size-3.5 shrink-0" />}
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left font-medium">{label}</button>
        {badge && <Badge variant="outline" className="shrink-0 text-[9px]">{badge}</Badge>}
      </div>
      {hasChildren && expanded && <div>{children}</div>}
    </div>
  );
}

/** Section 6: Problem-Category-scoped Destination Library. Deliberately
 * NOT a global library -- `destinationsForProblemCategory` already
 * guarantees that scoping. */
function DestinationLibrary({ problemCategoryId }: { problemCategoryId: string }) {
  const { state, setDestinationStatus } = useContentEntityStore();
  const [statusFilter, setStatusFilter] = useState<DestinationStatus | "ALL">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const destinations = destinationsForProblemCategory(state, problemCategoryId).filter((d) => statusFilter === "ALL" || d.status === statusFilter);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[.06em] text-slate-500">Destination Library ({destinations.length})</p>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DestinationStatus | "ALL")} className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px]">
          <option value="ALL">Barcha status</option>
          {DESTINATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {destinations.map((destination: Destination) => {
        const expanded = expandedId === destination.id;
        const angles = anglesForDestination(state, destination.id);
        const materials = materialsForDestination(state, destination.id);
        return (
          <div key={destination.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <button type="button" onClick={() => setExpandedId(expanded ? null : destination.id)} className="flex w-full items-center gap-2 text-left">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{destination.name}</p>
                <p className="text-[11px] text-slate-500">{destination.type}{destination.primaryUrl ? ` · ${destination.primaryUrl}` : ""}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">{destination.status}</Badge>
            </button>
            {expanded && (
              <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                <label className="flex items-center gap-2"><strong className="text-slate-900">Status:</strong>
                  <select value={destination.status} onChange={(e) => setDestinationStatus(destination.id, e.target.value as DestinationStatus)} className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px]">
                    {DESTINATION_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </label>
                <p><strong className="text-slate-900">Value proposition:</strong> {destination.valueProposition || "—"}</p>
                <p><strong className="text-slate-900">Owner:</strong> {destination.owner ?? "—"}</p>
                <p><strong className="text-slate-900">Deadline:</strong> {destination.deadline ?? "—"}</p>
                <p><strong className="text-slate-900">Related Angles:</strong> {angles.length ? angles.map((a) => a.title).join(", ") : "—"}</p>
                <p><strong className="text-slate-900">Related Materials:</strong> {materials.length ? materials.map((m) => m.title).join(", ") : "—"}</p>
              </div>
            )}
          </div>
        );
      })}
      {!destinations.length && <p className="text-[11px] text-slate-400">Bu Problem Category uchun hali destination yo&apos;q.</p>}
    </div>
  );
}

export function ContentTreeView() {
  const { state } = useContentEntityStore();
  const { state: runtimeState } = useTaskRuntimeStore();
  const { state: contentOsState } = useContentOsStore();
  const taskTypesById = useMemo(() => new Map(contentOsState.taskTypes.map((t) => [t.id, t])), [contentOsState.taskTypes]);
  const [selected, setSelected] = useState<SelectedEntity>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const select = (type: ContentEntityType, id: string) => setSelected({ type, id });

  const detail = useMemo(() => {
    if (!selected) return null;
    switch (selected.type) {
      case "DOMAIN":
        return state.domains.find((d) => d.id === selected.id) ?? null;
      case "PROBLEM_CATEGORY":
        return state.problemCategories.find((d) => d.id === selected.id) ?? null;
      case "PROBLEM_PART":
        return state.problemParts.find((d) => d.id === selected.id) ?? null;
      case "KNOWLEDGE_NODE":
        return state.knowledgeNodes.find((d) => d.id === selected.id) ?? null;
      case "BLOG":
        return state.blogs.find((d) => d.id === selected.id) ?? null;
      case "MATERIAL":
        return state.materials.find((d) => d.id === selected.id) ?? null;
      default:
        return null;
    }
  }, [selected, state]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <div><h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Content Tree</h1><p className="text-[11px] text-slate-500">Domain → Problem Category → Problem Part → Knowledge Node → Blog → Material</p></div>
        {runtimeState.suggestions.length > 0 && (
          <button type="button" onClick={() => setShowSuggestions((v) => !v)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
            <Lightbulb className="size-3.5" /> {runtimeState.suggestions.length} shablon taklifi
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-900 lg:px-5"><ShieldCheck className="size-3.5" /> Sessiya-only — Angle va Destination bu daraxtda emas; tasklar bu yerda ko&apos;rinmaydi.</div>

      {showSuggestions && runtimeState.suggestions.length > 0 && (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50/60 px-4 py-2 lg:px-5">
          <ul className="space-y-1 text-[11px] text-amber-900">
            {runtimeState.suggestions.map((s) => <li key={s.id}>• <strong>{s.field.label}</strong> ({s.field.type}) — {s.note}</li>)}
          </ul>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:border-b-0 lg:border-r">
          {state.domains.map((domain) => (
            <TreeRow key={domain.id} depth={0} label={domain.name} selected={selected?.type === "DOMAIN" && selected.id === domain.id} onSelect={() => select("DOMAIN", domain.id)}>
              {problemCategoriesForDomain(state, domain.id).map((category) => (
                <TreeRow key={category.id} depth={1} label={category.name} selected={selected?.type === "PROBLEM_CATEGORY" && selected.id === category.id} onSelect={() => select("PROBLEM_CATEGORY", category.id)}>
                  {problemPartsForCategory(state, category.id).map((part) => (
                    <TreeRow key={part.id} depth={2} label={part.name} selected={selected?.type === "PROBLEM_PART" && selected.id === part.id} onSelect={() => select("PROBLEM_PART", part.id)}>
                      {knowledgeNodesForPart(state, part.id).map((node) => (
                        <TreeRow key={node.id} depth={3} label={node.name} badge={node.status} selected={selected?.type === "KNOWLEDGE_NODE" && selected.id === node.id} onSelect={() => select("KNOWLEDGE_NODE", node.id)}>
                          {blogsForNode(state, node.id).map((blog) => (
                            <TreeRow key={blog.id} depth={4} label={blog.title} badge={blog.state} selected={selected?.type === "BLOG" && selected.id === blog.id} onSelect={() => select("BLOG", blog.id)}>
                              {materialsForBlog(state, blog.id).map((material) => (
                                <TreeRow key={material.id} depth={5} label={material.title} badge={material.format} selected={selected?.type === "MATERIAL" && selected.id === material.id} onSelect={() => select("MATERIAL", material.id)} />
                              ))}
                            </TreeRow>
                          ))}
                        </TreeRow>
                      ))}
                    </TreeRow>
                  ))}
                </TreeRow>
              ))}
            </TreeRow>
          ))}
          {!state.domains.length && <p className="p-4 text-center text-xs text-slate-400">Hali content yo&apos;q.</p>}
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 lg:p-6">
          {detail ? (
            <div className="mx-auto max-w-xl space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-950">{"name" in detail ? detail.name : detail.title}</h2>
                <Badge variant="outline">{selected?.type}</Badge>
              </div>
              <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                {"status" in detail && <div><dt className="font-semibold text-slate-900">Status</dt><dd>{detail.status}</dd></div>}
                {"state" in detail && <div><dt className="font-semibold text-slate-900">State</dt><dd>{detail.state}</dd></div>}
                {"format" in detail && <div><dt className="font-semibold text-slate-900">Format</dt><dd>{detail.format}</dd></div>}
                {"primaryLink" in detail && detail.primaryLink && <div><dt className="font-semibold text-slate-900">Link</dt><dd className="truncate">{detail.primaryLink}</dd></div>}
                {"angleId" in detail && detail.angleId && <div><dt className="font-semibold text-slate-900">Angle</dt><dd className="truncate">{state.angles.find((a) => a.id === detail.angleId)?.title ?? detail.angleId}</dd></div>}
                {"destinationNeeded" in detail && <div><dt className="font-semibold text-slate-900">Destination kerak</dt><dd>{detail.destinationNeeded ? "Ha" : "Yo'q"}</dd></div>}
                {"destinationId" in detail && <div><dt className="font-semibold text-slate-900">Aniq destination</dt><dd className="truncate">{detail.destinationId ? state.destinations.find((d) => d.id === detail.destinationId)?.name ?? detail.destinationId : "— (keyinroq tanlanadi)"}</dd></div>}
                {"sourceTaskId" in detail && detail.sourceTaskId && <div><dt className="font-semibold text-slate-900">Manba task</dt><dd className="truncate">{runtimeState.instances.find((i) => i.id === detail.sourceTaskId)?.title ?? detail.sourceTaskId}</dd></div>}
                <div><dt className="font-semibold text-slate-900">Yaratilgan</dt><dd>{new Date(detail.createdAt).toLocaleString("uz")}</dd></div>
              </dl>
              {selected?.type === "MATERIAL" && (() => {
                const summary = latestLearningSummary(selected.id, runtimeState.instances, taskTypesById);
                return summary ? (
                  <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-[11px] text-slate-700">
                    <p className="text-[10px] font-bold uppercase tracking-[.06em] text-violet-800">Latest Learning</p>
                    <p className="mt-1"><b>Result:</b> {summary.result}</p>
                    <p><b>What worked?</b> {summary.whatWorked}</p>
                    <p><b>Next step:</b> {summary.nextStep}</p>
                  </div>
                ) : null;
              })()}
              {selected?.type === "PROBLEM_CATEGORY" && <DestinationLibrary problemCategoryId={selected.id} />}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Tafsilot ko&apos;rish uchun daraxtdan biror narsa tanlang.</div>
          )}
        </main>
      </div>
    </div>
  );
}
