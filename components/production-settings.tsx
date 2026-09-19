"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, Plus, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyScheduleOverrides, type ScheduleOverrides } from "@/lib/scheduling-engine";
import { settingsValues, validatePlanningConfig } from "@/lib/planning-config";
import type { ProductionDataset, ScheduleResult } from "@/lib/production-types";

const TABS = [
  ["Kanallar", "32_CHANNEL_ACCOUNTS", "Kanal nomi, platforma, havola, vaqt zonasi va umumiy limitlar.", 116024028],
  ["Nashr qoidalari", "20_PUBLISHING_RULES", "Haftalik son, kunlar, vaqtlar, interval va amal qilish davri.", 200000001],
  ["Ish kalendari", "17_PRODUCTION_SETTINGS", "Ish kunlari, tanaffuslar, buferlar va rejalash boshlanishi.", 170000001],
  ["Dam olish kunlari", "21_HOLIDAYS", "Umumiy, rol yoki xodim uchun dam olish kunini qo‘shing.", 210000001],
  ["Jamoa yuklamasi", "18_TEAM_CAPACITY", "Rollar, haftalik soatlar va parallel ish limiti.", 180000001],
  ["Ish bosqichlari", "19_CONTENT_WORKFLOW", "Davomiylik, mas’ul rol va bosqichlar orasidagi bog‘lanishlar.", 190000001],
  ["Task shablonlari", "23_TASK_TEMPLATES", "Har bir alohida task nomi, taxminiy vaqti, egasi va konfiguratsiya versiyasi.", 32000102],
  ["Workflow qadamlar", "25_WORKFLOW_STEPS", "Paket materialini Research’dan Publish’gacha alohida tasklarga ajratish qoidalari.", 32000104],
  ["Mavzu paketlari", "33_TOPIC_PACKAGE_PLAN", "Haftalik mavzular, manba node va ishlab chiqarishga tanlash holati.", 33000201],
  ["Paket materiallari", "35_TOPIC_PACKAGE_ITEMS", "Har paketdagi blog, video, karusel va postlarni aniq satrlarda boshqarish.", 35000201],
  ["Ishga tushirish", "34_LAUNCH_PREPARATION", "21-sentabrdan 1-oktabrgacha tayyorgarlik nazorat ro‘yxati.", 33000202],
] as const;

export function ProductionSettings({ dataset, baseline, schedule, overrides, onSimulate, onReset }: { dataset: ProductionDataset; baseline: ScheduleResult; schedule: ScheduleResult; overrides: ScheduleOverrides; onSimulate: (value: ScheduleOverrides) => void; onReset: () => void }) {
  const [draft, setDraft] = useState<ScheduleOverrides>(overrides);
  const [errors, setErrors] = useState<string[]>([]);
  const values = { ...settingsValues(dataset), ...draft.settings };
  const update = (key: string, value: string) => setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const sheetLink = (id: number) => `https://docs.google.com/spreadsheets/d/${dataset.meta.spreadsheetId}/edit#gid=${id}`;
  const simulated = Object.keys(overrides).length > 0;
  const basePlans = new Map(baseline.plans.map((p) => [p.item.productionId, p]));
  const changes = schedule.plans.filter((p) => { const b = basePlans.get(p.item.productionId); return b && (p.scheduledPublishDate !== b.scheduledPublishDate || p.nextDeadline !== b.nextDeadline); });
  const numberInput = (value: number, change: (n: number) => void, label: string) => <Input aria-label={label} type="number" min="0" step="0.5" className="w-28 bg-white" value={Number.isNaN(value) ? "" : value} onChange={(e) => change(e.target.value === "" ? NaN : Number(e.target.value))} />;
  return <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700"><Settings2 className="size-4" /> IBOX · boshqaruv</div><h1 className="text-2xl font-bold tracking-tight text-slate-950">Sozlamalar</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Doimiy qiymatlarni Google Sheet’da tahrirlang. Sayt ularni har 60 soniyada oladi. Yangi kanal va qoidalar uchun yangi qator qo‘shish mumkin.</p></div><span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">{values.PLANNING_MODE || "TEST"} · rejalash</span></header>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{TABS.map(([name, tab, description, id]) => <a key={tab} href={sheetLink(id)} target="_blank" rel="noreferrer" className="group rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/30"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">{name}</h2><ArrowUpRight className="size-4 text-slate-400 group-hover:text-blue-600" /></div><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p><p className="mt-4 text-sm font-semibold text-blue-700">Sheet’da tahrirlash</p></a>)}</section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Kanallar va akkauntlar</h2><p className="mt-1 text-sm text-slate-500">Haqiqiy kanal ma’lumotlari tayyor bo‘lganda kiriting.</p></div><a href={sheetLink(116024028)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"><Plus className="size-4" /> Kanal qo‘shish</a></div>
        {dataset.channels?.length ? <div className="mt-4 divide-y divide-slate-100">{dataset.channels.map((c) => <div key={c.channelAccountId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className={`size-2 rounded-full ${c.active ? "bg-emerald-500" : "bg-slate-300"}`} /><strong>{c.accountName || "Nomi kiritilmagan"}</strong><span className="text-slate-500">{c.platform} · {c.timezone || values.TIMEZONE}</span><span className="ml-auto text-slate-500">Haftalik limit: {c.weeklyMax ?? "belgilanmagan"}</span></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">Hali kanal qo‘shilmagan. Nom, platforma, havola, vaqt zonasi va limitlar uchun bo‘sh maydonlar tayyor. Nashr qoidasini <code className="text-blue-700">Channel_Account_ID</code> orqali ulang.</div>}
      </section>
      <section className="rounded-2xl border border-blue-200 bg-white p-5 sm:p-6"><div className="mb-5"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CalendarDays className="size-5 text-blue-600" /> What if? · reja sinovi</h2><p className="mt-2 text-sm leading-6 text-slate-600">Sinov Kanban va Kalendarga birgalikda ta’sir qiladi. Sheet’ga yozilmaydi; sahifa yangilanganda bekor bo‘ladi. Qulflangan nashr sanalari saqlanadi.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
          ["PLANNING_START_DATE", "Rejalash boshlanishi", "date"], ["TIMEZONE", "Vaqt zonasi", "text"], ["DEFAULT_WORKING_DAYS", "Ish kunlari (MON,TUE…)", "text"], ["WORK_INTERVALS", "Ish oynalari (09:00-13:00|14:00-18:00)", "text"], ["DEFAULT_BUFFER_DAYS", "Bosqichlar buferi · ish kuni", "number"], ["PUBLISH_BUFFER_DAYS", "Nashrgacha bufer · ish kuni", "number"], ["HOURS_PER_WORKDAY", "Bir ish kuni · soat", "number"], ["PLANNING_HORIZON_DAYS", "Rejalash oralig‘i · kun", "number"], ["DEFAULT_REVIEW_DAYS", "Standart review · ish kuni", "number"],
        ].map(([key, label, type]) => <label key={key} className="grid gap-2 text-sm font-medium text-slate-700">{label}<Input type={type} min="0" value={values[key] ?? ""} onChange={(e) => update(key, e.target.value)} className="bg-white font-normal" /></label>)}</div>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={values.GLOBAL_WORK_CALENDAR === "TRUE"} onChange={(e) => update("GLOBAL_WORK_CALENDAR", e.target.checked ? "TRUE" : "FALSE")} /> Umumiy ish kunlarini barcha rollarga qo‘llash</label>
        <div className="mt-6 grid gap-6 lg:grid-cols-2"><div><h3 className="mb-3 font-semibold text-slate-900">Nashr chastotasi</h3><div className="space-y-3">{dataset.publishingRules.map((r) => <label key={r.ruleId} className="flex items-center justify-between gap-3 text-sm text-slate-600"><span>{r.platform}<span className="block text-xs text-slate-400">{r.ruleId} · hafta</span></span>{numberInput(draft.postsPerWeek?.[r.ruleId] ?? r.postsPerWeek, (n) => setDraft((d) => ({ ...d, postsPerWeek: { ...d.postsPerWeek, [r.ruleId]: n } })), `${r.ruleId} haftalik nashr`)}</label>)}</div></div><div><h3 className="mb-3 font-semibold text-slate-900">Jamoa quvvati</h3><div className="space-y-3">{dataset.team.filter((m) => m.active).map((m) => <label key={m.employeeId} className="flex items-center justify-between gap-3 text-sm text-slate-600"><span>{m.employeeName}<span className="block text-xs text-slate-400">{m.role} · soat/hafta</span></span>{numberInput(draft.weeklyCapacityHours?.[m.employeeId] ?? m.weeklyCapacityHours, (n) => setDraft((d) => ({ ...d, weeklyCapacityHours: { ...d.weeklyCapacityHours, [m.employeeId]: n } })), `${m.employeeName} haftalik soat`)}</label>)}</div></div></div>
        <p className="mt-4 text-sm text-slate-500">Standart davomiylik workflow’da aniq muddat berilmagan bosqichlarga qo‘llanadi. Aniq muddatlarni “Ish bosqichlari” jadvalida o‘zgartiring.</p>
        {errors.length > 0 && <ul role="alert" className="mt-4 space-y-1 rounded-xl bg-red-50 p-4 text-sm text-red-800">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="mt-5 flex flex-wrap gap-3"><Button onClick={() => { const next = applyScheduleOverrides(dataset, draft); const issues = validatePlanningConfig(next); setErrors(issues); if (!issues.length) onSimulate(draft); }} className="bg-blue-700 text-white hover:bg-blue-800">Barcha rejalarda sinash</Button><Button variant="outline" onClick={() => { setDraft({}); setErrors([]); onReset(); }}><RotateCcw className="size-4" /> Sinovni bekor qilish</Button></div>
        {simulated && <div className="mt-5 grid gap-3 rounded-xl bg-blue-50 p-4 text-sm text-blue-950 sm:grid-cols-3"><p><strong className="block text-xl">{changes.length}</strong>Muddati o‘zgargan kontent</p><p><strong className="block text-xl">{schedule.capacity.filter((c) => c.overCapacity || c.parallelConflict).length}</strong>Yuklama ogohlantirishlari</p><p><strong className="block text-xl">{schedule.plans.filter((p) => p.scheduledPublishDate).length - baseline.plans.filter((p) => p.scheduledPublishDate).length}</strong>Nashr rejasidagi son farqi</p></div>}
      </section>
    </div>
  </div>;
}
