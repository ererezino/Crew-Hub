/**
 * Shift-hours helpers: pure functions for computing shift durations and
 * per-employee weekly totals from loaded shifts.
 *
 * Time-range convention (consistent with `combineDateAndTimeRange` in
 * lib/scheduling and `slotHours` in lib/scheduling/auto-scheduler):
 * when the end clock time is at or before the start clock time, the range
 * is treated as overnight and rolls into the next day.
 *
 * Weeks are ISO weeks (Monday start), matching the manual scheduling grid.
 */

import { toIsoDate } from "../datetime";

/**
 * Soft weekly-hours guardrail. Visual warning only — never blocking.
 */
export const WEEKLY_HOURS_SOFT_LIMIT = 48;

export type WeeklyHoursShift = {
  employeeId: string | null;
  /** YYYY-MM-DD */
  shiftDate: string;
  /** "HH:MM", "HH:MM:SS" or an ISO timestamp */
  startTime: string;
  /** "HH:MM", "HH:MM:SS" or an ISO timestamp */
  endTime: string;
  breakMinutes?: number;
  status?: string;
};

/** Per-employee weekly totals: employeeId -> (week-start Monday ISO -> hours). */
export type WeeklyHoursByEmployee = Map<string, Map<string, number>>;

/**
 * Extract minutes-since-midnight from "HH:MM", "HH:MM:SS" or an ISO
 * timestamp ("...THH:MM..."). Returns null when unparseable.
 */
function toMinutesOfDay(value: string): number | null {
  const trimmed = value.trim();

  const embedded = trimmed.match(/T(\d{2}):(\d{2})/);
  if (embedded) {
    return Number(embedded[1]) * 60 + Number(embedded[2]);
  }

  const clock = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours <= 23 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  return null;
}

/**
 * Duration of a shift in hours from its start/end times and break minutes.
 * Handles overnight ranges (end clock time at or before start rolls to the
 * next day). Returns 0 for unparseable input; never returns a negative.
 */
export function shiftDurationHours(
  startTime: string,
  endTime: string,
  breakMinutes = 0
): number {
  const startMinutes = toMinutesOfDay(startTime);
  const endMinutes = toMinutesOfDay(endTime);

  if (startMinutes === null || endMinutes === null) {
    return 0;
  }

  let spanMinutes = endMinutes - startMinutes;
  if (spanMinutes <= 0) {
    spanMinutes += 24 * 60; // overnight shift
  }

  const netMinutes = spanMinutes - Math.max(0, breakMinutes);
  return Math.max(0, netMinutes) / 60;
}

/**
 * Monday of the ISO week containing `isoDate` (YYYY-MM-DD), as YYYY-MM-DD.
 * Returns the input unchanged when it is not a valid date.
 */
export function isoWeekStart(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);

  if (!Number.isFinite(date.getTime())) {
    return isoDate;
  }

  const mondayIndex = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - mondayIndex);
  return toIsoDate(date);
}

/**
 * Total scheduled hours per employee per ISO week (Monday start) from a
 * list of shifts. Skips unassigned (open) and cancelled shifts.
 */
export function weeklyHoursByEmployee(
  shifts: readonly WeeklyHoursShift[]
): WeeklyHoursByEmployee {
  const totals: WeeklyHoursByEmployee = new Map();

  for (const shift of shifts) {
    if (!shift.employeeId || shift.status === "cancelled") {
      continue;
    }

    const hours = shiftDurationHours(
      shift.startTime,
      shift.endTime,
      shift.breakMinutes ?? 0
    );

    if (hours <= 0) {
      continue;
    }

    const weekStart = isoWeekStart(shift.shiftDate);
    let weeks = totals.get(shift.employeeId);

    if (!weeks) {
      weeks = new Map();
      totals.set(shift.employeeId, weeks);
    }

    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + hours);
  }

  return totals;
}

/**
 * Convenience lookup: an employee's total hours for the ISO week containing
 * `isoDate`. Returns 0 when nothing is scheduled.
 */
export function employeeWeekHours(
  totals: WeeklyHoursByEmployee,
  employeeId: string,
  isoDate: string
): number {
  return totals.get(employeeId)?.get(isoWeekStart(isoDate)) ?? 0;
}

/** Whether a weekly total breaches the soft guardrail (strictly over 48h). */
export function isOverWeeklyLimit(hours: number): boolean {
  return hours > WEEKLY_HOURS_SOFT_LIMIT;
}

/** Round to one decimal for display: 38.333… -> 38.3, 40 -> 40. */
export function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}
