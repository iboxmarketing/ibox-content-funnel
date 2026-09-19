import { allocateWork, localDay, parseWorkWindows, wallClock } from "./work-calendar";
import type {
  ProductionDataset,
  ProductionHoliday,
  ProductionItem,
  ProductionPlan,
  PublishingRule,
  PublishingSlot,
  ScheduleResult,
  ScheduledStage,
  TeamCapacitySummary,
  TeamMember,
  WorkflowStageDefinition,
} from "./production-types";

const DAY_MS = 86_400_000;
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const STATUS_ORDER: Record<string, number> = {
  backlog: 0, research: 1, writing: 2, review: 3, ready: 4, scheduled: 5, published: 6, paused: -1,
};

export interface ScheduleOverrides {
  settings?: Record<string, string>;
  holidays?: ProductionHoliday[];
  postsPerWeek?: Record<string, number>;
  weeklyCapacityHours?: Record<string, number>;
  stageDurations?: Record<string, number>;
}

function normalized(value: string) {
  return value.toLocaleLowerCase("uz").replace(/[’‘`ʻʼ]/g, "'").trim();
}

function parseDay(value: string) {
  const clean = value.trim();
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const local = clean.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (local) return new Date(Date.UTC(Number(local[3]), Number(local[2]) - 1, Number(local[1])));
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function formatDay(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addCalendarDays(value: string, days: number) {
  const date = parseDay(value) ?? new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

function compareDays(left: string, right: string) {
  return (parseDay(left)?.getTime() ?? 0) - (parseDay(right)?.getTime() ?? 0);
}

function settingMap(dataset: ProductionDataset) {
  return new Map(dataset.settings.filter((item) => item.active).map((item) => [item.key, item.value]));
}

function numberSetting(settings: Map<string, string>, key: string, fallback = 0) {
  const raw = settings.get(key)?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function holidayApplies(holiday: ProductionHoliday, member?: TeamMember) {
  if (!holiday.active) return false;
  const target = normalized(holiday.appliesTo || "ALL");
  return target === "all" || Boolean(member && (target === normalized(member.employeeId) || target === normalized(member.role)));
}

function isWorkday(date: Date, workingDays: string[], holidays: ProductionHoliday[], member?: TeamMember) {
  const allowed = new Set(workingDays.map((day) => day.toUpperCase()));
  if (!allowed.has(WEEKDAY_CODES[date.getUTCDay()])) return false;
  const key = formatDay(date);
  return !holidays.some((holiday) => holiday.date === key && holidayApplies(holiday, member));
}

function moveToWorkday(value: string, direction: 1 | -1, workingDays: string[], holidays: ProductionHoliday[], member?: TeamMember) {
  if (!workingDays.length) throw new Error("Ish kunlari bo‘sh");
  const date = parseDay(value) ?? new Date();
  let guard = 0;
  while (!isWorkday(date, workingDays, holidays, member) && guard < 370) {
    date.setUTCDate(date.getUTCDate() + direction);
    guard += 1;
  }
  return formatDay(date);
}

export function addWorkdays(startDate: string, numberOfDays: number, employeeWorkingDays: string[], holidays: ProductionHoliday[] = [], member?: TeamMember) {
  const start = moveToWorkday(startDate, 1, employeeWorkingDays, holidays, member);
  if (numberOfDays <= 1) return start;
  const date = parseDay(start)!;
  let remaining = Math.max(0, Math.ceil(numberOfDays) - 1);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkday(date, employeeWorkingDays, holidays, member)) remaining -= 1;
  }
  return formatDay(date);
}

export function subtractWorkdays(endDate: string, numberOfDays: number, employeeWorkingDays: string[], holidays: ProductionHoliday[] = [], member?: TeamMember) {
  const end = moveToWorkday(endDate, -1, employeeWorkingDays, holidays, member);
  if (numberOfDays <= 1) return end;
  const date = parseDay(end)!;
  let remaining = Math.max(0, Math.ceil(numberOfDays) - 1);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (isWorkday(date, employeeWorkingDays, holidays, member)) remaining -= 1;
  }
  return formatDay(date);
}

function workflowFor(item: ProductionItem, workflow: WorkflowStageDefinition[]) {
  const active = workflow.filter((stage) => stage.active);
  const exact = active.filter((stage) => normalized(stage.contentType) === normalized(item.primaryContentType));
  const selected = exact.length ? exact : active.filter((stage) => normalized(stage.contentType) === "default");
  return [...selected].sort((a, b) => a.stageOrder - b.stageOrder);
}

function memberFor(role: string, assignee: string, team: TeamMember[]) {
  const active = team.filter((member) => member.active);
  if (assignee) {
    const exact = active.find((member) => [member.employeeId, member.employeeName].some((value) => normalized(value) === normalized(assignee)));
    if (exact) return exact;
  }
  return active.find((member) => normalized(member.role) === normalized(role));
}

function defaultWorkingDays(settings: Map<string, string>) {
  return (settings.get("DEFAULT_WORKING_DAYS") ?? "MON,TUE,WED,THU,FRI").split(/[,;|]+/).map((value) => value.trim()).filter(Boolean);
}

function stageBucket(stageId: string, stageName: string) {
  const key = normalized(`${stageId} ${stageName}`);
  if (/(publish)/.test(key)) return 6;
  if (/(schedul)/.test(key)) return 5;
  if (/(ready)/.test(key)) return 4;
  if (/(review|approval|qa)/.test(key)) return 3;
  if (/(writ|copy|script|outline|design|visual|record|edit|build|spec)/.test(key)) return 2;
  if (/(research|brief)/.test(key)) return 1;
  return 2;
}

function stageStatus(item: ProductionItem, definition: WorkflowStageDefinition) {
  if (normalized(item.productionStatus) === "paused") return "blocked" as const;
  const current = STATUS_ORDER[normalized(item.productionStatus)] ?? 0;
  const bucket = stageBucket(definition.stageId, definition.stageName);
  const stageKey = normalized(definition.stageId);
  if (/research/.test(stageKey)) {
    const status = normalized(item.researchStatus);
    if (/(verified|sourced|complete)/.test(status)) return "done" as const;
    if (/(in research|progress)/.test(status)) return "in_progress" as const;
  }
  if (/(writing|copy|script)/.test(stageKey)) {
    const status = normalized(item.writingStatus);
    if (/(draft complete|revised|approved)/.test(status)) return "done" as const;
    if (/(drafting|outline|progress)/.test(status)) return "in_progress" as const;
  }
  if (/(review|approval)/.test(stageKey)) {
    const status = normalized(item.reviewStatus);
    if (/approved/.test(status)) return "done" as const;
    if (/changes requested/.test(status)) return "blocked" as const;
    if (/in review/.test(status)) return "in_progress" as const;
  }
  if (current > bucket) return "done" as const;
  if (current === bucket && current > 0) return "in_progress" as const;
  return "pending" as const;
}

function durationFor(stage: WorkflowStageDefinition, settings: Map<string, string>) {
  if (stage.durationWorkdays >= 0) return stage.durationWorkdays;
  const key = normalized(`${stage.stageId} ${stage.stageName}`);
  if (/research|brief/.test(key)) return numberSetting(settings, "DEFAULT_RESEARCH_DAYS", 1);
  if (/review|approval|qa/.test(key)) return numberSetting(settings, "DEFAULT_REVIEW_DAYS", 1);
  if (/design|visual/.test(key)) return numberSetting(settings, "DEFAULT_DESIGN_DAYS", 1);
  if (/edit/.test(key)) return numberSetting(settings, "DEFAULT_EDITING_DAYS", 1);
  if (/schedul|publish/.test(key)) return numberSetting(settings, "DEFAULT_PUBLISHING_DAYS", 1);
  return numberSetting(settings, "DEFAULT_WRITING_DAYS", 1);
}

export function calculateWorkflowDates(item: ProductionItem, dataset: ProductionDataset, planningStart?: string) {
  const settings = settingMap(dataset);
  const definitions = workflowFor(item, dataset.workflow);
  const timezone = settings.get("TIMEZONE") || "Asia/Tashkent";
  const hours = numberSetting(settings, "HOURS_PER_WORKDAY", 8);
  const bufferMinutes = Math.round(numberSetting(settings, "DEFAULT_BUFFER_DAYS") * hours * 60);
  const globalCalendar = normalized(settings.get("GLOBAL_WORK_CALENDAR") || "false") === "true";
  const overrides = new Map(dataset.taskOverrides.filter((t) => t.active && t.productionId === item.productionId).map((t) => [t.stageId, t]));
  const ordered: WorkflowStageDefinition[] = [];
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (stage: WorkflowStageDefinition) => {
    if (visiting.has(stage.stageId)) throw new Error(`Workflow dependency cycle: ${stage.stageId}`);
    if (visited.has(stage.stageId)) return;
    visiting.add(stage.stageId);
    for (const id of stage.dependencyStageIds) {
      const dependency = definitions.find((d) => d.stageId === id);
      if (!dependency) throw new Error(`Workflow dependency topilmadi: ${id}`);
      visit(dependency);
    }
    visiting.delete(stage.stageId); visited.add(stage.stageId); ordered.push(stage);
  };
  definitions.forEach(visit);
  const backwards = Boolean(item.targetPublishDate);
  const anchorDay = (backwards ? item.targetPublishDate : item.productionStartDate || planningStart || settings.get("PLANNING_START_DATE") || todayInTimeZone(timezone)).slice(0, 10);
  const schedules = new Map<string, ScheduledStage>();
  for (const stage of backwards ? [...ordered].reverse() : ordered) {
    const override = overrides.get(stage.stageId);
    const member = memberFor(stage.ownerRole, override?.assigneeId || item.assignee, dataset.team);
    const windows = parseWorkWindows(settings.get("WORK_INTERVALS") || settings.get("DEFAULT_WORK_WINDOWS") || `${member?.workStart || "09:00"}-${member?.workEnd || "18:00"}`);
    const days = globalCalendar ? defaultWorkingDays(settings) : member?.workingDays.length ? member.workingDays : defaultWorkingDays(settings);
    const calendar = { timezone, windows, days, holidays: dataset.holidays.filter((h) => holidayApplies(h, member)).map((h) => h.date) };
    const related = backwards ? ordered.filter((d) => d.dependencyStageIds.includes(stage.stageId)).map((d) => schedules.get(d.stageId)!.startAt!) : stage.dependencyStageIds.map((id) => schedules.get(id)!.endAt!);
    let boundary = related.length ? (backwards ? Math.min : Math.max)(...related.map(Date.parse)) : wallClock(anchorDay, backwards ? windows.at(-1)!.end : windows[0].start, timezone);
    if (backwards && !related.length && item.targetPublishDate.includes("T")) boundary = Date.parse(item.targetPublishDate);
    if (related.length && bufferMinutes) {
      const gap = allocateWork(boundary, bufferMinutes, calendar, backwards ? -1 : 1);
      boundary = Date.parse(backwards ? gap.startAt : gap.endAt);
    }
    const duration = durationFor(stage, settings);
    const allocation = allocateWork(boundary, Math.round(duration * hours * 60), calendar, backwards ? -1 : 1);
    const startDate = override?.startDateOverride || localDay(allocation.startAt, timezone);
    const endDate = override?.deadlineOverride || localDay(allocation.endAt, timezone);
    const startAt = override?.startDateOverride ? new Date(wallClock(startDate, windows[0].start, timezone)).toISOString() : allocation.startAt;
    const endAt = override?.deadlineOverride ? new Date(wallClock(endDate, windows.at(-1)!.end, timezone)).toISOString() : allocation.endAt;
    schedules.set(stage.stageId, {
      taskId: `${item.productionId}::${stage.stageId}`, stageId: stage.stageId, stageName: stage.stageName, ownerRole: stage.ownerRole,
      ownerId: member?.employeeId ?? "", ownerName: member?.employeeName || stage.ownerRole || "Tayinlanmagan",
      startDate, endDate, startAt, endAt, workSegments: override?.startDateOverride || override?.deadlineOverride ? undefined : allocation.segments,
      durationWorkdays: duration, dependencyStageIds: stage.dependencyStageIds, status: override?.status || stageStatus(item, stage),
      capacityWarning: "", estimatedHours: duration * hours, locked: override?.locked ?? false, notes: override?.notes ?? "",
    });
  }
  return definitions.map((d) => schedules.get(d.stageId)!);
}

export function calculateContentReadyDate(stages: ScheduledStage[]) {
  const productionStages = stages.filter((stage) => !/(ready|schedul|publish)/i.test(`${stage.stageId} ${stage.stageName}`));
  const values = (productionStages.length ? productionStages : stages).map((stage) => stage.endAt || stage.endDate).filter(Boolean);
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function weekKey(value: string) {
  const date = parseDay(value) ?? new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatDay(date);
}

export function calculateRoleCapacity(plans: ProductionPlan[], dataset: ProductionDataset): TeamCapacitySummary[] {
  const settings = settingMap(dataset);
  const hoursPerDay = numberSetting(settings, "HOURS_PER_WORKDAY", 8);
  const groups = new Map<string, { member: TeamMember; week: string; hours: number; tasks: Set<string> }>();
  for (const plan of plans) {
    if (normalized(plan.item.productionStatus) === "published" || normalized(plan.item.productionStatus) === "paused") continue;
    if (!/publishable candidate/i.test(plan.item.publishability) && normalized(plan.item.productionStatus) === "backlog") continue;
    for (const stage of plan.stages) {
      const member = dataset.team.find((item) => item.employeeId === stage.ownerId);
      if (!member || !stage.startDate || !stage.endDate || stage.durationWorkdays <= 0) continue;
      if (stage.workSegments) {
        for (const segment of stage.workSegments) {
          const week = weekKey(localDay(segment.startAt, settings.get("TIMEZONE") || "Asia/Tashkent"));
          const key = `${member.employeeId}::${week}`;
          const group = groups.get(key) ?? { member, week, hours: 0, tasks: new Set<string>() };
          group.hours += (Date.parse(segment.endAt) - Date.parse(segment.startAt)) / 3_600_000;
          group.tasks.add(plan.item.productionId); groups.set(key, group);
        }
        continue;
      }
      let date = parseDay(stage.startDate)!;
      const end = parseDay(stage.endDate)!;
      let guard = 0;
      while (date <= end && guard < 370) {
        if (isWorkday(date, member.workingDays, dataset.holidays, member)) {
          const week = weekKey(formatDay(date));
          const key = `${member.employeeId}::${week}`;
          const group = groups.get(key) ?? { member, week, hours: 0, tasks: new Set<string>() };
          group.hours += hoursPerDay;
          group.tasks.add(plan.item.productionId);
          groups.set(key, group);
        }
        date = new Date(date.getTime() + DAY_MS);
        guard += 1;
      }
    }
  }
  return Array.from(groups.values()).map(({ member, week, hours, tasks }) => {
    const utilization = member.weeklyCapacityHours > 0 ? (hours / member.weeklyCapacityHours) * 100 : hours > 0 ? 101 : 0;
    return {
      employeeId: member.employeeId, employeeName: member.employeeName, role: member.role, week,
      scheduledHours: hours, weeklyCapacityHours: member.weeklyCapacityHours, utilization,
      activeParallelTasks: tasks.size, maxParallelTasks: member.maxParallelTasks,
      overCapacity: utilization > 100, parallelConflict: member.maxParallelTasks > 0 && tasks.size > member.maxParallelTasks,
    };
  });
}

function isoWithTime(day: string, time: string, timezone = "Asia/Tashkent") {
  if (day.includes("T")) return new Date(day).toISOString();
  const [hour, minute] = time.split(":").map(Number);
  return new Date(wallClock(day, hour * 60 + minute, timezone)).toISOString();
}

export function slotKey(slot: PublishingSlot) { return `${slot.channelAccountId || slot.platform}::${slot.startsAt}`; }

export function generatePublishingSlots(rules: PublishingRule[], startDate: string, endDate: string, occupied: PublishingSlot[] = [], channels: NonNullable<ProductionDataset["channels"]> = [], timezone = "Asia/Tashkent", globalGapHours = 0) {
  const slots: PublishingSlot[] = [...occupied];
  const active = rules.filter((r) => r.active && r.postsPerWeek > 0).sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId));
  for (const rule of active) {
    const channel = channels.find((c) => c.channelAccountId === rule.channelAccountId);
    if (rule.channelAccountId && !channel?.active) continue;
    const zone = channel?.timezone || timezone;
    const account = rule.channelAccountId || rule.platform;
    const gap = Math.max(globalGapHours * 60, rule.minimumGapHours * 60, channel?.minimumGapMinutes ?? 0) * 60_000;
    const counts = new Map<string, number>();
    for (const s of slots.filter((s) => s.ruleId === rule.ruleId)) { const week = weekKey(localDay(s.startsAt, zone)); counts.set(week, (counts.get(week) || 0) + 1); }
    for (let day = startDate; day <= endDate; day = addCalendarDays(day, 1)) {
      if ((rule.validFrom && day < rule.validFrom) || (rule.validTo && day > rule.validTo)) continue;
      if (!rule.preferredWeekdays.includes(WEEKDAY_CODES[parseDay(day)!.getUTCDay()])) continue;
      const week = weekKey(day);
      for (const time of [...rule.preferredTimes].sort()) {
        if ((counts.get(week) || 0) >= Math.min(rule.postsPerWeek, rule.weeklyMax ?? Infinity)) break;
        const startsAt = isoWithTime(day, time, zone); const instant = Date.parse(startsAt);
        const accountSlots = slots.filter((s) => (s.channelAccountId || s.platform) === account);
        if (channel?.weeklyMax != null && accountSlots.filter((s) => weekKey(localDay(s.startsAt, zone)) === week).length >= channel.weeklyMax) continue;
        if (accountSlots.some((s) => {
          const other = rules.find((r) => r.ruleId === s.ruleId);
          const requiredGap = Math.max(gap, (other?.minimumGapHours ?? 0) * 3_600_000);
          return Date.parse(s.startsAt) === instant || Math.abs(Date.parse(s.startsAt) - instant) < requiredGap;
        })) continue;
        slots.push({ ruleId: rule.ruleId, channelAccountId: rule.channelAccountId, platform: rule.platform, contentType: rule.contentType, language: rule.language, startsAt });
        counts.set(week, (counts.get(week) || 0) + 1);
      }
    }
  }
  return slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function findNextAvailableSlot(readyDate: string, rule: PublishingRule, slots: PublishingSlot[], occupied: Set<string>) {
  const ready = Date.parse(readyDate) || 0;
  return slots.find((slot) => !slot.locked && slot.ruleId === rule.ruleId && !occupied.has(slotKey(slot)) && Date.parse(slot.startsAt) >= ready) ?? null;
}

function matchingRule(item: ProductionItem, rules: PublishingRule[]) {
  return rules.filter((rule) => rule.active && normalized(rule.platform) === normalized(item.primaryPlatform))
    .filter((rule) => ["default", "*", normalized(item.primaryContentType)].includes(normalized(rule.contentType)))
    .filter((rule) => ["*", normalized(item.language)].includes(normalized(rule.language)))
    .sort((a, b) => {
      const specificity = (rule: PublishingRule) => (normalized(rule.contentType) === normalized(item.primaryContentType) ? 2 : 0) + (normalized(rule.language) === normalized(item.language) ? 1 : 0);
      return specificity(b) - specificity(a) || a.priority - b.priority;
    })[0];
}

function priorityRank(value: string) {
  return ({ p0: 0, p1: 1, p2: 2, p3: 3 } as Record<string, number>)[normalized(value)] ?? 4;
}

function itemBlocked(item: ProductionItem) {
  return /(needs split|requires tool|internal architecture)/i.test(item.publishability);
}

export function calculateScheduleRisk(plan: Pick<ProductionPlan, "item" | "earliestPossiblePublishDate" | "scheduledPublishDate" | "capacityWarnings">, today: string) {
  const target = plan.item.targetPublishDate;
  if (target && compareDays(plan.earliestPossiblePublishDate, target) > 0) return "late" as const;
  if (plan.capacityWarnings.length || (target && compareDays(plan.scheduledPublishDate || plan.earliestPossiblePublishDate, target) > 0)) return "at_risk" as const;
  if (target && compareDays(target, today) < 0 && normalized(plan.item.productionStatus) !== "published") return "late" as const;
  return "on_track" as const;
}

function unscheduledReason(item: ProductionItem, rule: PublishingRule | undefined) {
  if (/internal architecture/i.test(item.publishability)) return "Internal architecture only";
  if (/needs split|research/i.test(item.publishability)) return "Needs split/research";
  if (/requires tool/i.test(item.publishability)) return "Requires tool build";
  if (/[rR][uU]|[eE][nN]/.test(item.language) && !/approved/i.test(item.contentApprovalStatus)) return "Localization not ready";
  if (!rule) return `No valid ${item.primaryPlatform || "platform"} slot`;
  return "Planning horizon ichida bo‘sh slot yo‘q";
}

export function applyScheduleOverrides(dataset: ProductionDataset, overrides: ScheduleOverrides = {}): ProductionDataset {
  const settings = dataset.settings.map((s) => ({ ...s, value: overrides.settings?.[s.key] ?? s.value }));
  for (const [key, value] of Object.entries(overrides.settings ?? {})) if (!settings.some((s) => s.key === key)) settings.push({ key, value, unit: "", description: "Sinov", active: true });
  return {
    ...dataset, settings, holidays: overrides.holidays ?? dataset.holidays,
    team: dataset.team.map((m) => ({ ...m, weeklyCapacityHours: overrides.weeklyCapacityHours?.[m.employeeId] ?? overrides.weeklyCapacityHours?.[m.role] ?? m.weeklyCapacityHours })),
    workflow: dataset.workflow.map((s) => ({ ...s, durationWorkdays: overrides.stageDurations?.[s.stageId] ?? s.durationWorkdays })),
    publishingRules: dataset.publishingRules.map((r) => ({ ...r, postsPerWeek: overrides.postsPerWeek?.[r.ruleId] ?? overrides.postsPerWeek?.[r.platform] ?? r.postsPerWeek })),
  };
}

export function recalculateSchedule(dataset: ProductionDataset, overrides: ScheduleOverrides = {}): ScheduleResult {
  const cloned = applyScheduleOverrides(dataset, overrides);
  const settings = settingMap(cloned);
  const timezone = settings.get("TIMEZONE") || "Asia/Tashkent";
  const today = todayInTimeZone(timezone);
  const planningAnchor = settings.get("PLANNING_START_DATE") || today;
  const horizonDays = numberSetting(settings, "PLANNING_HORIZON_DAYS", 90);
  const horizonEnd = addCalendarDays(planningAnchor, horizonDays);
  const hoursPerDay = numberSetting(settings, "HOURS_PER_WORKDAY", 8);
  const committedByWeek = new Map<string, number>();
  const orderedItems = [...cloned.items].sort((a, b) => priorityRank(a.priorityBand) - priorityRank(b.priorityBand) || b.priorityScore - a.priorityScore || a.productionId.localeCompare(b.productionId));
  let plans: ProductionPlan[] = orderedItems.map((item) => {
    let planningStart = planningAnchor;
    const isEligibleBacklog = /publishable candidate/i.test(item.publishability) && normalized(item.productionStatus) === "backlog" && !item.targetPublishDate;
    if (isEligibleBacklog) {
      const estimates = new Map<string, { member: TeamMember; hours: number }>();
      for (const stage of workflowFor(item, cloned.workflow)) {
        const member = memberFor(stage.ownerRole, item.assignee, cloned.team);
        if (!member || durationFor(stage, settings) <= 0) continue;
        const current = estimates.get(member.employeeId) ?? { member, hours: 0 };
        current.hours += durationFor(stage, settings) * hoursPerDay;
        estimates.set(member.employeeId, current);
      }
      let weekOffset = 0;
      while (weekOffset < 520) {
        const week = weekKey(addCalendarDays(planningAnchor, weekOffset * 7));
        const fits = Array.from(estimates.values()).every(({ member, hours }) => (committedByWeek.get(`${member.employeeId}::${week}`) ?? 0) + hours <= member.weeklyCapacityHours);
        if (fits) {
          for (const { member, hours } of estimates.values()) {
            const key = `${member.employeeId}::${week}`;
            committedByWeek.set(key, (committedByWeek.get(key) ?? 0) + hours);
          }
          planningStart = addCalendarDays(planningAnchor, weekOffset * 7);
          break;
        }
        weekOffset += 1;
      }
    }
    const stages = calculateWorkflowDates(item, cloned, planningStart);
    const contentReadyDate = calculateContentReadyDate(stages) || today;
    const pending = stages.find((stage) => stage.status !== "done") ?? stages.at(-1);
    return {
      item, stages, currentOwner: pending?.ownerName ?? (item.assignee || "Tayinlanmagan"),
      currentRole: pending?.ownerRole ?? "", nextDeadline: pending?.endDate ?? item.deadline,
      contentReadyDate, recommendedPublishDate: "", scheduledPublishDate: item.scheduleLocked ? item.targetPublishDate : "",
      earliestPossiblePublishDate: contentReadyDate, scheduleRisk: "on_track", overdue: false,
      blocked: itemBlocked(item), unscheduledReason: "", capacityWarnings: [],
    };
  });

  const initialCapacity = calculateRoleCapacity(plans, cloned);
  const capacityByKey = new Map(initialCapacity.map((entry) => [`${entry.employeeId}::${entry.week}`, entry]));
  plans = plans.map((plan) => {
    let delayDays = 0;
    const warnings = new Set<string>();
    const stages = plan.stages.map((stage) => {
      const capacity = capacityByKey.get(`${stage.ownerId}::${weekKey(stage.startDate)}`);
      let capacityWarning = "";
      if (capacity?.overCapacity) {
        capacityWarning = `${capacity.employeeName}: ${Math.round(capacity.utilization)}% capacity`;
        delayDays = Math.max(delayDays, 7);
      } else if (capacity?.parallelConflict) {
        capacityWarning = `${capacity.employeeName}: parallel task limiti oshgan`;
        delayDays = Math.max(delayDays, 2);
      }
      if (capacityWarning) warnings.add(capacityWarning);
      return { ...stage, capacityWarning };
    });
    const earliestPossiblePublishDate = delayDays ? addCalendarDays(plan.contentReadyDate, delayDays) : plan.contentReadyDate;
    return { ...plan, stages, earliestPossiblePublishDate, capacityWarnings: Array.from(warnings) };
  });

  const lockedSlots: PublishingSlot[] = plans.flatMap((plan) => {
    const value = plan.item.scheduleLocked && plan.item.targetPublishDate ? plan.item.targetPublishDate : "";
    if (!value) return [];
    const rule = matchingRule(plan.item, cloned.publishingRules);
    return [{ ruleId: rule?.ruleId || "LOCKED", channelAccountId: rule?.channelAccountId, platform: plan.item.primaryPlatform, contentType: plan.item.primaryContentType, language: plan.item.language, startsAt: isoWithTime(value, "00:00", timezone), locked: true, productionId: plan.item.productionId }];
  });
  const slots = generatePublishingSlots(cloned.publishingRules, planningAnchor, horizonEnd, lockedSlots, cloned.channels, timezone, numberSetting(settings, "MIN_PUBLISH_GAP_HOURS"));
  const occupied = new Set(lockedSlots.map(slotKey));
  const planById = new Map(plans.map((plan) => [plan.item.productionId, plan]));
  const candidates = plans.filter((plan) => !plan.item.scheduleLocked && /publishable candidate/i.test(plan.item.publishability) && normalized(plan.item.productionStatus) !== "published")
    .sort((a, b) => priorityRank(a.item.priorityBand) - priorityRank(b.item.priorityBand)
      || Number(/approved/i.test(b.item.contentApprovalStatus)) - Number(/approved/i.test(a.item.contentApprovalStatus))
      || b.item.priorityScore - a.item.priorityScore
      || a.item.productionId.localeCompare(b.item.productionId));
  const lookback = Math.max(1, numberSetting(settings, "SOFT_DIVERSITY_LOOKBACK", 4));
  const recent: ProductionItem[] = [];
  const unscheduled = new Set(candidates.map((plan) => plan.item.productionId));

  while (unscheduled.size) {
    const pool = candidates.filter((plan) => unscheduled.has(plan.item.productionId));
    if (!pool.length) break;
    const last = recent.slice(-lookback);
    const chosen = [...pool].sort((a, b) => {
      const penalty = (plan: ProductionPlan) => last.reduce((score, previous) => score + (previous.clusterId === plan.item.clusterId ? 3 : 0) + (previous.funnelStage === plan.item.funnelStage ? 1 : 0) + (previous.nodeRole === plan.item.nodeRole ? 1 : 0), 0);
      return priorityRank(a.item.priorityBand) - priorityRank(b.item.priorityBand) || penalty(a) - penalty(b) || b.item.priorityScore - a.item.priorityScore;
    })[0];
    unscheduled.delete(chosen.item.productionId);
    const rule = matchingRule(chosen.item, cloned.publishingRules);
    let readyDate = chosen.earliestPossiblePublishDate;
    const delay = numberSetting(settings, "PUBLISH_BUFFER_DAYS") + (/^ru$/i.test(chosen.item.language) ? numberSetting(settings, "LOCALIZATION_RU_DELAY_DAYS") : /^en$/i.test(chosen.item.language) ? numberSetting(settings, "LOCALIZATION_EN_DELAY_DAYS") : 0);
    if (delay > 0) readyDate = allocateWork(Date.parse(readyDate), Math.round(delay * hoursPerDay * 60), { timezone, days: defaultWorkingDays(settings), windows: parseWorkWindows(settings.get("WORK_INTERVALS") || settings.get("DEFAULT_WORK_WINDOWS") || "09:00-18:00"), holidays: cloned.holidays.filter((h) => holidayApplies(h)).map((h) => h.date) }).endAt;
    const blockedLocalization = /^(ru|en)$/i.test(chosen.item.language) && !/approved/i.test(chosen.item.contentApprovalStatus);
    const slot = rule && !blockedLocalization ? findNextAvailableSlot(readyDate, rule, slots, occupied) : null;
    const plan = planById.get(chosen.item.productionId)!;
    if (slot) {
      occupied.add(slotKey(slot));
      slot.productionId = chosen.item.productionId;
      plan.recommendedPublishDate = slot.startsAt;
      plan.scheduledPublishDate = slot.startsAt;
      recent.push(chosen.item);
    } else {
      plan.unscheduledReason = unscheduledReason(chosen.item, rule);
    }
  }

  for (const plan of plans) {
    if (plan.item.scheduleLocked && plan.item.targetPublishDate) {
      plan.recommendedPublishDate = plan.item.targetPublishDate;
      plan.scheduledPublishDate = plan.item.targetPublishDate;
    }
    if (normalized(plan.item.productionStatus) === "published" && plan.item.publishDate) {
      plan.recommendedPublishDate = plan.item.publishDate;
      plan.scheduledPublishDate = plan.item.publishDate;
    }
    const deadline = plan.nextDeadline || plan.item.targetPublishDate;
    plan.overdue = Boolean(deadline && compareDays(deadline, today) < 0 && normalized(plan.item.productionStatus) !== "published");
    plan.scheduleRisk = calculateScheduleRisk(plan, today);
  }

  return { plans, capacity: calculateRoleCapacity(plans, cloned), slots, generatedAt: new Date().toISOString() };
}

export function formatDisplayDate(value: string, includeTime = false) {
  if (!value) return "—";
  const date = value.includes("T") ? new Date(value) : parseDay(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: value.includes("T") ? "Asia/Tashkent" : "UTC",
    day: "2-digit", month: "2-digit", year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const day = `${part("day")}.${part("month")}.${part("year")}`;
  return includeTime ? `${day} ${part("hour")}:${part("minute")}` : day;
}

export function dateKey(value: string) {
  if (!value) return "";
  if (value.includes("T")) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
  return formatDay(parseDay(value) ?? new Date());
}
