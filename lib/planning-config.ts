import type { ProductionDataset } from "./production-types";
import { parseWorkWindows, validDay, WEEKDAYS } from "./work-calendar";

export function settingsValues(dataset: ProductionDataset) {
  return Object.fromEntries(dataset.settings.filter((s) => s.active).map((s) => [s.key, s.value]));
}

export function validatePlanningConfig(dataset: ProductionDataset): string[] {
  const errors: string[] = [];
  const settings = settingsValues(dataset);
  try { new Intl.DateTimeFormat("uz", { timeZone: settings.TIMEZONE || "Asia/Tashkent" }); } catch { errors.push("17 · TIMEZONE: vaqt zonasi noto‘g‘ri"); }
  const days = (settings.DEFAULT_WORKING_DAYS || "").split(/[,;|]+/).map((v) => v.trim());
  if (!days.length || days.some((d) => !WEEKDAYS.includes(d))) errors.push("17 · DEFAULT_WORKING_DAYS: kamida bitta haqiqiy ish kunini kiriting");
  if (settings.WORK_INTERVALS || settings.DEFAULT_WORK_WINDOWS) { try { parseWorkWindows(settings.WORK_INTERVALS || settings.DEFAULT_WORK_WINDOWS); } catch (e) { errors.push(`17 · WORK_INTERVALS: ${(e as Error).message}`); } }
  if (settings.PLANNING_START_DATE && !validDay(settings.PLANNING_START_DATE)) errors.push("17 · PLANNING_START_DATE: YYYY-MM-DD sanani kiriting");
  for (const key of new Set(["PLANNING_HORIZON_DAYS", "HOURS_PER_WORKDAY", "DEFAULT_BUFFER_DAYS", "PUBLISH_BUFFER_DAYS", "LOCALIZATION_RU_DELAY_DAYS", "LOCALIZATION_EN_DELAY_DAYS", ...Object.keys(settings).filter((k) => /^DEFAULT_.*_DAYS$/.test(k) && k !== "DEFAULT_WORKING_DAYS")])) {
    if (settings[key] === undefined) continue;
    const value = Number(settings[key]);
    if (!settings[key].trim() || !Number.isFinite(value) || value < 0 || (key === "PLANNING_HORIZON_DAYS" && (!Number.isInteger(value) || value < 1 || value > 730)) || (key === "HOURS_PER_WORKDAY" && (value <= 0 || value > 24))) errors.push(`17 · ${key}: qiymat noto‘g‘ri`);
  }
  const seen = new Set<string>();
  for (const s of dataset.settings.filter((s) => s.active)) { if (seen.has(s.key)) errors.push(`17 · ${s.key}: takroriy faol sozlama`); seen.add(s.key); }
  const channels = new Map((dataset.channels ?? []).map((c) => [c.channelAccountId, c]));
  if (channels.size !== (dataset.channels ?? []).length) errors.push("32 · Channel_Account_ID: takrorlangan ID");
  for (const c of dataset.channels ?? []) {
    if (!c.active) continue;
    if (!c.platform || !c.accountName) errors.push(`32 · ${c.channelAccountId}: platforma/kanal nomi yetishmaydi`);
    try { new Intl.DateTimeFormat("uz", { timeZone: c.timezone || settings.TIMEZONE }); } catch { errors.push(`32 · ${c.channelAccountId}: timezone noto‘g‘ri`); }
    if (c.publicUrl && !/^https?:\/\//i.test(c.publicUrl)) errors.push(`32 · ${c.channelAccountId}: havola http/https bo‘lishi kerak`);
    for (const [key, value] of [["Account_Weekly_Max", c.weeklyMax], ["Account_Minimum_Gap_Minutes", c.minimumGapMinutes]] as const) if (value !== null && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) errors.push(`32 · ${c.channelAccountId} · ${key}: musbat butun son kiriting`);
  }
  const ruleIds = new Set<string>();
  for (const m of dataset.team.filter((m) => m.active)) {
    if (!Number.isFinite(m.weeklyCapacityHours) || m.weeklyCapacityHours < 0) errors.push(`18 · ${m.employeeId}: haftalik soat noto‘g‘ri`);
    if (!Number.isInteger(m.maxParallelTasks) || m.maxParallelTasks < 0) errors.push(`18 · ${m.employeeId}: parallel task limiti noto‘g‘ri`);
    if (settings.GLOBAL_WORK_CALENDAR !== "TRUE" && m.workingDays.some((d) => !WEEKDAYS.includes(d))) errors.push(`18 · ${m.employeeId}: ish kunlari noto‘g‘ri`);
  }
  for (const s of dataset.workflow.filter((s) => s.active)) if (!Number.isFinite(s.durationWorkdays) || s.durationWorkdays < -1) errors.push(`19 · ${s.stageId}: davomiylik noto‘g‘ri`);
  for (const type of new Set(dataset.workflow.filter((s) => s.active).map((s) => s.contentType))) {
    const stages = dataset.workflow.filter((s) => s.active && s.contentType === type);
    const byId = new Map(stages.map((s) => [s.stageId, s]));
    if (byId.size !== stages.length) errors.push(`19 · ${type}: takrorlangan Stage_ID`);
    const visited = new Set<string>(); const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) { errors.push(`19 · ${type}: dependency cycle (${id})`); return; }
      if (visited.has(id)) return;
      const stage = byId.get(id);
      if (!stage) { errors.push(`19 · ${type}: dependency topilmadi (${id})`); return; }
      visiting.add(id); stage.dependencyStageIds.forEach(visit); visiting.delete(id); visited.add(id);
    };
    stages.forEach((s) => visit(s.stageId));
  }
  for (const r of dataset.publishingRules.filter((r) => r.active)) {
    if (ruleIds.has(r.ruleId)) errors.push(`20 · ${r.ruleId}: takrorlangan faol qoida`); ruleIds.add(r.ruleId);
    if (!Number.isInteger(r.postsPerWeek) || r.postsPerWeek < 0 || r.postsPerWeek > 1000) errors.push(`20 · ${r.ruleId}: Posts_Per_Week noto‘g‘ri`);
    if (!r.preferredWeekdays.length || r.preferredWeekdays.some((d) => !WEEKDAYS.includes(d))) errors.push(`20 · ${r.ruleId}: nashr kunlari noto‘g‘ri`);
    if (!r.preferredTimes.length || r.preferredTimes.some((v) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) errors.push(`20 · ${r.ruleId}: HH:mm nashr vaqti kerak`);
    if (r.weeklyMax != null && (!Number.isInteger(r.weeklyMax) || r.weeklyMax < r.postsPerWeek)) errors.push(`20 · ${r.ruleId}: Weekly_Max targetdan kam bo‘lmasin`);
    if (r.channelAccountId && !channels.has(r.channelAccountId)) errors.push(`20 · ${r.ruleId}: Channel_Account_ID topilmadi`);
    if (!Number.isFinite(r.minimumGapHours) || r.minimumGapHours < 0) errors.push(`20 · ${r.ruleId}: minimal interval noto‘g‘ri`);
    if ((r.validFrom && !validDay(r.validFrom)) || (r.validTo && !validDay(r.validTo)) || (r.validFrom && r.validTo && r.validFrom > r.validTo)) errors.push(`20 · ${r.ruleId}: amal qilish davri noto‘g‘ri`);
  }
  for (const h of dataset.holidays.filter((h) => h.active)) if (!validDay(h.date)) errors.push(`21 · ${h.name || h.date}: YYYY-MM-DD sana kerak`);
  return errors;
}
