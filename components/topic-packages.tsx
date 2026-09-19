"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarRange, CheckCircle2, CircleDot, Layers3, RefreshCw, Route, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductionDataset } from "@/lib/production-types";
import { formatDisplayDate } from "@/lib/scheduling-engine";

function normalize(value: string) {
  return value.toLocaleLowerCase("uz").trim();
}

function statusTone(value: string) {
  const status = normalize(value);
  if (/tasdiq|approved|active|ishlab chiqarish/.test(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (/tanlandi|selected/.test(status)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (/pauza|paused/.test(status)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function setting(dataset: ProductionDataset, key: string) {
  return dataset.settings.find((item) => item.active && item.key === key)?.value ?? "—";
}

export function TopicPackages({ dataset, onRefresh, refreshing, lastSynced }: { dataset: ProductionDataset; onRefresh: () => void; refreshing: boolean; lastSynced: string }) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const selectedStatuses = /^(tanlandi|tasdiqlandi|selected|approved|active)$/i;
  const selected = dataset.topicPackages.filter((item) => selectedStatuses.test(item.planningStatus));
  const areas = useMemo(() => Array.from(new Set(dataset.topicPackages.map((item) => item.primaryArea).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uz")), [dataset.topicPackages]);
  const visible = useMemo(() => dataset.topicPackages
    .filter((item) => area === "all" || item.primaryArea === area)
    .filter((item) => !query || normalize([item.packagePlanId, item.topicUz, item.primaryArea, item.clusterId, item.mainNodeId].join(" ")).includes(normalize(query)))
    .sort((a, b) => a.suggestedOrder - b.suggestedOrder), [area, dataset.topicPackages, query]);
  const sheetLink = (gid: number) => `https://docs.google.com/spreadsheets/d/${dataset.meta.spreadsheetId}/edit#gid=${gid}`;

  return <div className="h-full overflow-y-auto bg-[#F7F9FC]">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur lg:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">Mavzu paketlari</h1><p className="mt-0.5 text-[12px] text-slate-500">Haftalik rejaning asosiy birligi · Google Sheet 33 va 34</p></div>
        <div className="relative min-w-[240px] max-w-[420px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mavzu, paket yoki cluster…" className="h-10 rounded-xl bg-slate-50 pl-9 shadow-none" /></div>
        <select value={area} onChange={(event) => setArea(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 outline-none hover:border-blue-200 focus:border-blue-400"><option value="all">Barcha yo‘nalishlar</option>{areas.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <Button variant="outline" className="h-10 rounded-xl" onClick={onRefresh} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Yangilash</Button>
        <span className="text-[11px] text-slate-400">{formatDisplayDate(lastSynced, true)}</span>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["Haftalik maqsad", setting(dataset, "TOPIC_PACKAGES_PER_WEEK"), "mavzu paketi"],
          ["Tayyor zaxira", setting(dataset, "READY_RESERVE_TOPIC_PACKAGES"), "paket"],
          ["Takliflar", dataset.topicPackages.length, "mavzu"],
          ["Tanlangan", selected.length, "paket"],
          ["Strukturali material", dataset.topicPackageItems.length, "alohida item"],
          ["Tayyorgarlik", `${setting(dataset, "PREPARATION_START_DATE")} → ${setting(dataset, "CONTENT_LAUNCH_DATE")}`, "reja oynasi"],
        ].map(([label, value, hint]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4"><p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</p><p className="mt-1 text-xl font-bold tracking-[-0.03em] text-slate-950">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>)}
      </section>

      {selected.length === 0 && <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div><h2 className="font-semibold">Hali ishlab chiqarishga tanlangan paket yo‘q</h2><p className="mt-1 text-sm leading-6 text-amber-900/80">9 ta mavzu `Taklif` holatida. Bu xavfsiz: tasklar, deadline va syomka bookinglari hali yaratilmaydi. Avval paket tarkibidagi blog/video/rasm/postlar strukturali tanlanadi, so‘ng Head tasdig‘i bilan bot backendda alohida tasklar ochiladi.</p></div>
        <a href={sheetLink(33000201)} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-950">Sheet 33 <ArrowUpRight className="size-3.5" /></a>
      </section>}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
        <div>
          <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">Oktabr mavzu takliflari</h2><p className="mt-1 text-sm text-slate-500">Har karta mavjud cluster, node va production yozuviga ID orqali bog‘langan.</p></div><Badge variant="secondary">{visible.length}</Badge></div>
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((item) => <article key={item.packagePlanId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,.035)] transition hover:border-blue-200 hover:shadow-[0_8px_24px_rgba(15,23,42,.07)]">
              <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">{item.suggestedOrder}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-400">{item.packagePlanId}</span><Badge variant="outline" className={`h-5 text-[9px] ${statusTone(item.planningStatus)}`}>{item.planningStatus}</Badge></div><h3 className="mt-2 text-[15px] font-semibold leading-5 text-slate-950">{item.topicUz}</h3></div></div>
              <p className="mt-3 text-[13px] leading-5 text-slate-600">{item.packageObjectiveUz}</p>
              <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400">Taklif etilgan tarkib</p><p className="mt-1 text-[12px] leading-5 text-slate-700">{item.proposedContentScopeUz}</p></div>
              <div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="outline">{item.primaryArea}</Badge><Badge variant="outline">{item.clusterId}</Badge><Badge variant="outline">{item.mainNodeId}</Badge><Badge variant="outline">{item.sourceProductionId}</Badge></div>
              {item.notesUz && <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-500">{item.notesUz}</p>}
            </article>)}
          </div>
        </div>

        <aside className="min-w-0">
          <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">Ishga tushirish tayyorgarligi</h2><p className="mt-1 text-sm text-slate-500">Reja; runtime task emas.</p></div><a href={sheetLink(33000202)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 hover:text-blue-900">Sheet 34</a></div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {dataset.launchPreparation.map((item, index) => <div key={item.preparationId} className={`relative flex gap-3 p-4 ${index ? "border-t border-slate-100" : ""}`}>
              <div className="flex flex-col items-center"><span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700">{normalize(item.statusUz) === "bajarildi" ? <CheckCircle2 className="size-4" /> : <CircleDot className="size-4" />}</span>{index < dataset.launchPreparation.length - 1 && <span className="mt-1 h-full w-px bg-slate-200" />}</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-slate-400">{item.preparationId}</span><Badge variant="outline" className="h-5 text-[9px]">{item.statusUz}</Badge></div><h3 className="mt-1 text-sm font-semibold text-slate-900">{item.stageUz}</h3><p className="mt-1 text-[11px] font-medium text-blue-700">{item.proposedWindowUz} · {item.primaryRole}</p><p className="mt-2 text-[12px] leading-5 text-slate-600">{item.workUz}</p></div>
            </div>)}
          </div>
        </aside>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><Layers3 className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Paket → material</h3><p className="mt-1 text-sm leading-6 text-slate-600">Blog, video, karusel va postlar paket ichida alohida material sifatida tanlanadi. Soni matndan taxmin qilinmaydi.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><Route className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Material → workflow</h3><p className="mt-1 text-sm leading-6 text-slate-600">Har material Sheet 25 dagi workflow’ga ulanadi; Researchdan Publishgacha har qadam alohida task bo‘ladi.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><CalendarRange className="size-5 text-blue-700" /><h3 className="mt-3 font-semibold text-slate-950">Task → real xodim</h3><p className="mt-1 text-sm leading-6 text-slate-600">Assignee `ROLE-*` emas, botga kirgan haqiqiy xodim. Deadline ish kalendari, dependency va capacity bo‘yicha hisoblanadi.</p></div>
      </section>
    </main>
  </div>;
}
