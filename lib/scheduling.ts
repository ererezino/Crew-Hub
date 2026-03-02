import type { UserRole } from "./navigation";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isIsoDate(value: string): boolean {
  return isoDatePattern.test(value);
}

export function isIsoTime(value: string): boolean {
  return timePattern.test(value);
}

export function parseInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function formatTimeRangeLabel(startIso: string, endIso: string): string {
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);

  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return "--";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

export function combineDateAndTime(isoDate: string, isoTime: string): string | null {
  if (!isIsoDate(isoDate) || !isIsoTime(isoTime)) {
    return null;
  }

  return `${isoDate}T${isoTime}:00.000Z`;
}

export function extractIsoTime(value: string): string {
  const parsedDate = new Date(value);

  if (!Number.isFinite(parsedDate.getTime())) {
    return "00:00";
  }

  const hour = String(parsedDate.getUTCHours()).padStart(2, "0");
  const minute = String(parsedDate.getUTCMinutes()).padStart(2, "0");

  return `${hour}:${minute}`;
}

export function endDateFromWeekStart(weekStart: string): string | null {
  if (!isIsoDate(weekStart)) {
    return null;
  }

  const parsedDate = new Date(`${weekStart}T00:00:00.000Z`);
  parsedDate.setUTCDate(parsedDate.getUTCDate() + 6);

  return parsedDate.toISOString().slice(0, 10);
}

export function isSchedulingManager(userRoles: readonly UserRole[]): boolean {
  return (
    userRoles.includes("MANAGER") ||
    userRoles.includes("HR_ADMIN") ||
    userRoles.includes("SUPER_ADMIN")
  );
}

export function isSchedulingAdmin(userRoles: readonly UserRole[]): boolean {
  return userRoles.includes("HR_ADMIN") || userRoles.includes("SUPER_ADMIN");
}

export function canViewTeamSchedules(userRoles: readonly UserRole[]): boolean {
  return (
    userRoles.includes("MANAGER") ||
    userRoles.includes("HR_ADMIN") ||
    userRoles.includes("FINANCE_ADMIN") ||
    userRoles.includes("SUPER_ADMIN")
  );
}

export function areTimeRangesOverlapping({
  startA,
  endA,
  startB,
  endB
}: {
  startA: string;
  endA: string;
  startB: string;
  endB: string;
}): boolean {
  const startATime = new Date(startA).getTime();
  const endATime = new Date(endA).getTime();
  const startBTime = new Date(startB).getTime();
  const endBTime = new Date(endB).getTime();

  if (
    !Number.isFinite(startATime) ||
    !Number.isFinite(endATime) ||
    !Number.isFinite(startBTime) ||
    !Number.isFinite(endBTime)
  ) {
    return false;
  }

  return startATime < endBTime && startBTime < endATime;
}
