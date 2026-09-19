export type WorkWindow = { start: number; end: number };
export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY = 86_400_000;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

export function localDay(instant: string | number | Date, timezone: string) {
  if (!dayFormatters.has(timezone)) dayFormatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }));
  return dayFormatters.get(timezone)!.format(new Date(instant));
}

export function shiftDay(day: string, count: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}

export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day;
}

export function parseWorkWindows(value: string): WorkWindow[] {
  const windows = value.split(/[|;,]+/).filter(Boolean).map((part) => {
    const match = part.trim().match(/^(\d{2}):(\d{2})\s*[-–]\s*(\d{2}):(\d{2})$/);
    if (!match) throw new Error("Ish oynalari: 09:00-13:00|14:00-18:00 shaklida kiriting");
    const [, sh, sm, eh, em] = match.map(Number);
    const start = sh * 60 + sm; const end = eh * 60 + em;
    if (sh > 23 || eh > 23 || sm > 59 || em > 59 || end <= start) throw new Error("Ish oynasining boshlanish/tugash vaqti noto‘g‘ri");
    return { start, end };
  }).sort((a, b) => a.start - b.start);
  if (!windows.length || windows.some((w, i) => i > 0 && w.start < windows[i - 1].end)) throw new Error("Ish oynalari bo‘sh yoki bir-birini qoplaydi");
  return windows;
}

// Convert an IANA wall-clock date to an instant; never depend on browser timezone.
export function wallClock(day: string, minute: number, timezone: string): number {
  const desired = Date.parse(`${day}T00:00:00Z`) + minute * 60_000;
  let instant = desired;
  if (!timeFormatters.has(timezone)) timeFormatters.set(timezone, new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  const formatter = timeFormatters.get(timezone)!;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const p = (key: string) => Number(parts.find((part) => part.type === key)?.value);
    const seen = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"));
    if (seen === desired) return instant;
    instant += desired - seen;
  }
  throw new Error(`${day}: ${timezone} vaqt zonasida mavjud bo‘lmagan vaqt`);
}

export interface WorkCalendar { timezone: string; days: string[]; windows: WorkWindow[]; holidays: string[] }

export function allocateWork(anchor: number, minutes: number, calendar: WorkCalendar, direction: 1 | -1 = 1) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Davomiylik musbat butun daqiqa yoki 0 bo‘lishi kerak");
  if (!calendar.days.length || !calendar.windows.length) throw new Error("Ish kalendari bo‘sh");
  const segments: Array<{ startAt: string; endAt: string }> = [];
  let remaining = minutes; let day = localDay(anchor, calendar.timezone);
  if (!remaining) return { startAt: new Date(anchor).toISOString(), endAt: new Date(anchor).toISOString(), segments };
  for (let guard = 0; guard < 3660 && remaining > 0; guard++, day = shiftDay(day, direction)) {
    if (!calendar.days.includes(WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]) || calendar.holidays.includes(day)) continue;
    const windows = direction === 1 ? calendar.windows : [...calendar.windows].reverse();
    for (const window of windows) {
      const start = Math.max(wallClock(day, window.start, calendar.timezone), direction === 1 ? anchor : -Infinity);
      const end = Math.min(wallClock(day, window.end, calendar.timezone), direction === -1 ? anchor : Infinity);
      const available = Math.max(0, Math.floor((end - start) / 60_000));
      const used = Math.min(available, remaining);
      if (!used) continue;
      const a = direction === 1 ? start : end - used * 60_000;
      const b = direction === 1 ? start + used * 60_000 : end;
      segments.push({ startAt: new Date(a).toISOString(), endAt: new Date(b).toISOString() });
      remaining -= used;
      if (!remaining) break;
    }
  }
  if (remaining) throw new Error("Ish kalendari bo‘yicha hisoblash oralig‘i yetarli emas");
  segments.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { startAt: segments[0].startAt, endAt: segments.at(-1)!.endAt, segments };
}
