import type { ShiftRecord } from "../../types/scheduling";

/** Shared pure helpers for the weekly grid / roster views (weeks × shift-slots × people). */

export type GridSlot = { key: string; name: string; startTime: string; endTime: string };

export type GridWeek = {
  index: number;
  weekStart: string; // Monday ISO
  label: string;
  rangeDates: string[]; // in-range ISO dates for this week
  rangeWeekdays: number[]; // 0 = Mon … 6 = Sun, present in range
};

export type GridCellPerson = {
  employeeId: string;
  name: string;
  weekdays: Set<number>; // 0 = Mon … 6 = Sun
};

function isoToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function utcToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function gridWeekdayIndex(iso: string): number {
  return (isoToUtc(iso).getUTCDay() + 6) % 7; // Mon = 0
}
function mondayOf(iso: string): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() - gridWeekdayIndex(iso));
  return utcToIso(d);
}
function addDays(iso: string, n: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToIso(d);
}
/** "HH:MM" from an ISO timestamp or an already-HH:MM string. */
export function toHHMM(value: string): string {
  const m = value.match(/T(\d{2}:\d{2})/);
  if (m) return m[1]!;
  if (/^\d{2}:\d{2}$/.test(value.trim())) return value.trim();
  const d = new Date(value);
  if (Number.isFinite(d.getTime())) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return "00:00";
}
export function gridShortDate(iso: string, locale: string): string {
  return isoToUtc(iso).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}
export function slotKeyOf(startHHMM: string, endHHMM: string): string {
  return `${startHHMM}-${endHHMM}`;
}

/** Group a schedule's date range into Mon–Sun weeks that intersect the range (max 8). */
export function buildWeeks(startDate: string, endDate: string, locale = "en"): GridWeek[] {
  const out: GridWeek[] = [];
  let cursorMonday = mondayOf(startDate);
  let index = 0;
  while (cursorMonday <= endDate && index < 8) {
    const rangeDates: string[] = [];
    const rangeWeekdays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const iso = addDays(cursorMonday, i);
      if (iso >= startDate && iso <= endDate) {
        rangeDates.push(iso);
        rangeWeekdays.push(i);
      }
    }
    if (rangeDates.length > 0) {
      out.push({
        index,
        weekStart: cursorMonday,
        label: `${gridShortDate(rangeDates[0]!, locale)} – ${gridShortDate(rangeDates[rangeDates.length - 1]!, locale)}`,
        rangeDates,
        rangeWeekdays
      });
      index += 1;
    }
    cursorMonday = addDays(cursorMonday, 7);
  }
  return out;
}

function cleanSlotName(shift: ShiftRecord): string | null {
  const raw = (shift.notes ?? shift.templateName ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^Auto-generated:\s*/i, "").trim() || null;
}

/** Distinct shift slots (columns) derived from the shifts, sorted by start time. */
export function buildSlots(shifts: ShiftRecord[]): GridSlot[] {
  const map = new Map<string, GridSlot>();
  for (const shift of shifts) {
    const start = toHHMM(shift.startTime);
    const end = toHHMM(shift.endTime);
    const key = slotKeyOf(start, end);
    if (!map.has(key)) {
      map.set(key, { key, name: cleanSlotName(shift) ?? `${start}–${end}`, startTime: start, endTime: end });
    }
  }
  return [...map.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Build `${weekIndex}:${slotKey}` → Map<employeeId, person with worked weekdays>. */
export function buildCells(
  shifts: ShiftRecord[],
  weeks: GridWeek[]
): Map<string, Map<string, GridCellPerson>> {
  const grid = new Map<string, Map<string, GridCellPerson>>();
  if (weeks.length === 0) return grid;

  const weekByDate = new Map<string, GridWeek>();
  for (const w of weeks) for (const d of w.rangeDates) weekByDate.set(d, w);

  for (const shift of shifts) {
    if (!shift.employeeId || shift.status === "cancelled") continue;
    const week = weekByDate.get(shift.shiftDate);
    if (!week) continue;
    const cellKey = `${week.index}:${slotKeyOf(toHHMM(shift.startTime), toHHMM(shift.endTime))}`;
    let people = grid.get(cellKey);
    if (!people) {
      people = new Map();
      grid.set(cellKey, people);
    }
    const wd = gridWeekdayIndex(shift.shiftDate);
    const existing = people.get(shift.employeeId);
    if (existing) {
      existing.weekdays.add(wd);
    } else {
      people.set(shift.employeeId, {
        employeeId: shift.employeeId,
        name: shift.employeeName ?? "Unknown",
        weekdays: new Set([wd])
      });
    }
  }
  return grid;
}
