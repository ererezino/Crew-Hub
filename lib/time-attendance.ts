import { isoDateToUtcDate, utcDateToIsoDate } from "./time-off";

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseNumeric(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function getCurrentIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = padDatePart(now.getUTCMonth() + 1);
  const day = padDatePart(now.getUTCDate());

  return `${year}-${month}-${day}`;
}

export function weekRangeFromIsoDate(isoDate: string): { weekStart: string; weekEnd: string } | null {
  const baseDate = isoDateToUtcDate(isoDate);

  if (!baseDate) {
    return null;
  }

  const day = baseDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const weekStartDate = new Date(baseDate.getTime());
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + mondayOffset);

  const weekEndDate = new Date(weekStartDate.getTime());
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);

  return {
    weekStart: utcDateToIsoDate(weekStartDate),
    weekEnd: utcDateToIsoDate(weekEndDate)
  };
}

export function getCurrentWeekRange(): { weekStart: string; weekEnd: string } {
  return (
    weekRangeFromIsoDate(getCurrentIsoDate()) ?? {
      weekStart: getCurrentIsoDate(),
      weekEnd: getCurrentIsoDate()
    }
  );
}

export function timestampFromIsoDate(isoDate: string, endOfDay = false): string | null {
  const baseDate = isoDateToUtcDate(isoDate);

  if (!baseDate) {
    return null;
  }

  if (endOfDay) {
    return `${isoDate}T23:59:59.999Z`;
  }

  return `${isoDate}T00:00:00.000Z`;
}

export function getDurationMinutes(clockIn: string, clockOut: string | null): number {
  if (!clockOut) {
    return 0;
  }

  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / 60000);
}

export function getOpenEntrySeconds(clockIn: string): number {
  const start = new Date(clockIn).getTime();
  const now = Date.now();

  if (!Number.isFinite(start) || now <= start) {
    return 0;
  }

  return Math.floor((now - start) / 1000);
}

export function formatHoursFromMinutes(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  return (safeMinutes / 60).toFixed(2);
}

export function formatTimeEntryMethod(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function resolveWorkedMinutes({
  totalMinutes,
  clockIn,
  clockOut
}: {
  totalMinutes: number;
  clockIn: string;
  clockOut: string | null;
}): number {
  if (totalMinutes > 0) {
    return totalMinutes;
  }

  return getDurationMinutes(clockIn, clockOut);
}
