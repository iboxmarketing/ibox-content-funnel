"use client";

/**
 * Production Queue (V1 Sprint 5): the local hand-off views around Material
 * production -- Ready for Shoot (with MANUAL Shoot Session creation),
 * existing Shoot Sessions, and Ready for Distribution (Sprint 6's input
 * queue; no Distribution Plan is created here). Session-only; no
 * TaskClient, no Supabase, no automatic batching.
 */
import { useMemo, useState } from "react";
import { BookOpenCheck, CalendarClock, Clapperboard, Hourglass, PackageCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useContentOsStore } from "@/components/content-os-store-provider";
import { useContentEntityStore } from "@/components/content-entity-store-provider";
import { useTaskRuntimeStore } from "@/components/task-runtime-store-provider";
import {
  DISTRIBUTION_PLAN_TASK_TYPE_NAME,
  buildDistributionPlanTask,
  getAwaitingPublishCheck,
  getDistributionPlanEligibleMaterials,
  getLearningDue,
  latestLearningSummary,
  materialResultReviewState,
  reconcileDueRuntimeTasks,
} from "@/lib/distribution";
import { SHOOT_TASK_TYPE_NAME, buildShootSession, getReadyForDistribution, getReadyForShootMaterials } from "@/lib/material-production";

export function MaterialProductionView() {
  const { state: contentOsState } = useContentOsStore();
  const contentEntityStore = useContentEntityStore();
  const { state: runtimeState, createInstances } = useTaskRuntimeStore();
  const { state } = contentEntityStore;

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [assignee, setAssignee] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Local "now" for deterministic reconciliation (no timers): the
  // employee can advance it past a scheduled publish / result review date.
  const [localNow, setLocalNow] = useState(() => new Date().toISOString().slice(0, 16));

  const taskTypesById = useMemo(() => new Map(contentOsState.taskTypes.map((t) => [t.id, t])), [contentOsState.taskTypes]);
  const shootTaskType = contentOsState.taskTypes.find((t) => t.name === SHOOT_TASK_TYPE_NAME) ?? null;
  const readyForShoot = getReadyForShootMaterials(state, runtimeState.instances, taskTypesById);
  const readyForDistribution = useMemo(() => getReadyForDistribution(state, runtimeState.instances, taskTypesById), [state, runtimeState.instances, taskTypesById]);

  const awaitingCheck = useMemo(() => getAwaitingPublishCheck(runtimeState.instances, taskTypesById), [runtimeState.instances, taskTypesById]);
  const learningDue = useMemo(() => getLearningDue(runtimeState.instances, taskTypesById), [runtimeState.instances, taskTypesById]);
  const planEligible = useMemo(() => new Set(getDistributionPlanEligibleMaterials(state, runtimeState.instances, taskTypesById).map((m) => m.id)), [state, runtimeState.instances, taskTypesById]);
  const learningSummaries = useMemo(
    () => state.materials.map((material) => ({ material, summary: latestLearningSummary(material.id, runtimeState.instances, taskTypesById) })).filter((row) => row.summary),
    [state.materials, runtimeState.instances, taskTypesById],
  );

  function createDistributionPlan(materialId: string) {
    const material = state.materials.find((m) => m.id === materialId);
    const planType = contentOsState.taskTypes.find((t) => t.name === DISTRIBUTION_PLAN_TASK_TYPE_NAME);
    if (!material || !planType) { setNotice("Distribution Plan Task Type topilmadi."); return; }
    createInstances([buildDistributionPlanTask(material, planType)]);
    setNotice(`“${material.title}” uchun Distribution Plan task yaratildi (Workflow Run → Material va boshqa tasklar).`);
  }

  function reconcile() {
    const drafts = reconcileDueRuntimeTasks({ now: localNow, instances: runtimeState.instances, taskTypesById, content: state }, contentOsState.taskTypes);
    if (drafts.length) createInstances(drafts);
    setNotice(drafts.length ? `${drafts.length} ta muddati kelgan task yaratildi.` : "Muddati kelgan yangi task yo’q.");
  }

  function setResultReviewAt(materialId: string, resultReviewAt: string) {
    if (!resultReviewAt) return;
    contentEntityStore.applyActions([{ type: "CONFIRM_MATERIAL_RESULT_REVIEW", materialId, resultReviewAt, sourceTaskId: null }]);
  }

  function toggle(id: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, id] : current.filter((x) => x !== id)));
  }

  function createSession() {
    if (!shootTaskType) { setNotice("Shoot Task Type topilmadi."); return; }
    const result = buildShootSession({ title, scheduledAt: scheduledAt || null, assignee: assignee || null, materialIds: selectedIds }, state, runtimeState.instances, taskTypesById, shootTaskType);
    if (!result.ok) { setNotice(result.message); return; }
    contentEntityStore.applyActions(result.build.entityActions);
    createInstances([result.build.shootTaskDraft]);
    setSelectedIds([]); setTitle(""); setScheduledAt(""); setAssignee("");
    setNotice(`“${result.build.session.title}” yaratildi — bitta Shoot task, ${result.build.session.materialIds.length} ta Material.`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <h1 className="text-[17px] font-bold tracking-[-0.02em] text-slate-950">Production Queue</h1>
        <p className="text-[11px] text-slate-500">Ready for Shoot → Shoot Session → Ready for Distribution</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-900 lg:px-5"><ShieldCheck className="size-3.5" /> Sessiya-only · hech narsa haqiqiy platformaga nashr qilinmaydi.<span className="ml-auto flex items-center gap-2">Local now<Input type="datetime-local" value={localNow} onChange={(e) => setLocalNow(e.target.value)} className="h-7 w-44 bg-white text-xs" /><Button type="button" size="sm" variant="outline" className="h-7 rounded-lg bg-white text-xs" onClick={reconcile}><RefreshCw className="size-3" /> Reconcile</Button></span></div>
      {notice && <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-medium text-emerald-800 lg:px-5">{notice}</div>}

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4 lg:p-6">
        <section className="mx-auto max-w-3xl space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><Clapperboard className="size-4 text-blue-700" /> Ready for Shoot ({readyForShoot.length})</h2>
          {readyForShoot.map((material) => (
            <label key={material.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" className="size-4 accent-blue-700" checked={selectedIds.includes(material.id)} onChange={(e) => toggle(material.id, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{material.title}</span>
              <Badge variant="outline" className="text-[10px]">{material.format}</Badge>
            </label>
          ))}
          {!readyForShoot.length && <p className="text-xs text-slate-400">Hozircha Planning tugagan va sessiyaga kiritilmagan Material yo’q.</p>}
          {readyForShoot.length > 0 && (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
              <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">Shoot Session nomi<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tuesday Shoot — 2 Reels" className="mt-1 h-8 text-xs" /></label>
              <label className="text-[11px] font-semibold text-slate-600">Sana<Input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1 h-8 text-xs" /></label>
              <label className="text-[11px] font-semibold text-slate-600">Assignee<Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Operator / Montajer" className="mt-1 h-8 text-xs" /></label>
              <div className="sm:col-span-4"><Button type="button" size="sm" className="rounded-lg bg-blue-700 hover:bg-blue-800" disabled={!selectedIds.length} onClick={createSession}>Shoot Session yaratish ({selectedIds.length})</Button></div>
            </div>
          )}
        </section>

        <section className="mx-auto max-w-3xl space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><CalendarClock className="size-4 text-blue-700" /> Shoot Sessions ({state.shootSessions.length})</h2>
          {state.shootSessions.map((session) => (
            <div key={session.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2"><strong className="flex-1 truncate text-sm text-slate-900">{session.title}</strong><Badge variant="outline" className="text-[10px]">{session.status}</Badge></div>
              <p className="mt-1 text-[11px] text-slate-500">{session.scheduledAt ?? "Sana yo’q"} · {session.assignee ?? "Assignee yo’q"}</p>
              <p className="mt-1 text-[11px] text-slate-600">{session.materialIds.map((id) => state.materials.find((m) => m.id === id)?.title ?? id).join(" · ")}</p>
            </div>
          ))}
          {!state.shootSessions.length && <p className="text-xs text-slate-400">Hali Shoot Session yo’q.</p>}
        </section>

        <section className="mx-auto max-w-3xl space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><PackageCheck className="size-4 text-emerald-600" /> Ready for Distribution ({readyForDistribution.length})</h2>
          {readyForDistribution.map(({ material, destination, productionTasks }) => (
            <div key={material.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2"><strong className="flex-1 truncate text-sm text-slate-900">{material.title}</strong><Badge variant="outline" className="text-[10px]">{material.format}</Badge></div>
              <p className="mt-1 text-[11px] text-slate-600">CTA: {material.ctaType ?? "—"}{material.ctaText ? ` — ${material.ctaText}` : ""}</p>
              <p className="text-[11px] text-slate-600">Destination: {destination ? `${destination.name} (${destination.status})` : "—"}</p>
              {planEligible.has(material.id) && (
                <Button type="button" size="sm" className="mt-2 h-7 rounded-lg bg-blue-700 text-xs hover:bg-blue-800" onClick={() => createDistributionPlan(material.id)}>Distribution Plan yaratish</Button>
              )}
              {productionTasks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">{productionTasks.map((t, index) => <Badge key={index} variant="outline" className="text-[10px]">{t.taskType}: {t.status}</Badge>)}</div>
              )}
            </div>
          ))}
          {!readyForDistribution.length && <p className="text-xs text-slate-400">Hali Distribution’ga tayyor Material yo’q.</p>}
        </section>

        <section className="mx-auto max-w-3xl space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><Hourglass className="size-4 text-amber-600" /> Scheduled / Awaiting Publish Check ({awaitingCheck.length})</h2>
          {awaitingCheck.map(({ publishTask, info, check }) => (
            <div key={publishTask.id} className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
              <strong className="text-sm text-slate-900">{publishTask.title}</strong>
              <p className="mt-1">{info.channel} · scheduled {info.scheduledPublishAt || "—"} · {check ? `Publish Check: ${check.status}` : "Publish Check hali due emas"}</p>
            </div>
          ))}
          {!awaitingCheck.length && <p className="text-xs text-slate-400">Hozircha kutilayotgan Publish Check yo’q.</p>}
        </section>

        <section className="mx-auto max-w-3xl space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><BookOpenCheck className="size-4 text-violet-600" /> Learning Due ({learningDue.length})</h2>
          <p className="text-[11px] text-slate-500">Bitta Material — bitta Learning. Result Review sanasi Material darajasida; keyingi kanallar yangi Learning yaratmaydi.</p>
          {learningDue.map((task) => (
            <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600"><strong className="text-sm text-slate-900">{task.title}</strong><p className="mt-1">Deadline {task.deadline ?? "—"} · {task.status}</p></div>
          ))}
          {!learningDue.length && <p className="text-xs text-slate-400">Hozircha Learning task yo’q.</p>}
          {state.materialResultReviews.map((review) => {
            const material = state.materials.find((m) => m.id === review.materialId);
            const { learning, due } = materialResultReviewState(review, runtimeState.instances, taskTypesById, localNow);
            return (
              <div key={review.materialId} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
                <strong className="min-w-0 flex-1 truncate text-sm text-slate-900">{material?.title ?? review.materialId}</strong>
                <span>{review.sourcePublishTaskIds.length} ta muvaffaqiyatli nashr</span>
                <label className="flex items-center gap-1">Result Review<Input type="date" value={review.resultReviewAt?.slice(0, 10) ?? ""} disabled={Boolean(learning)} onChange={(e) => setResultReviewAt(review.materialId, e.target.value)} className="h-7 w-36 text-xs" /></label>
                <Badge variant="outline" className="text-[10px]">{learning ? `Learning: ${learning.status}` : due ? "Due — Reconcile bosing" : "Kutilmoqda"}</Badge>
              </div>
            );
          })}
          {learningSummaries.map(({ material, summary }) => summary && (
            <div key={material.id} className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-[11px] text-slate-700">
              <strong className="text-sm text-slate-900">{material.title}</strong>
              <p className="mt-1"><b>Result:</b> {summary.result}</p>
              <p><b>What worked?</b> {summary.whatWorked}</p>
              <p><b>Next step:</b> {summary.nextStep}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
