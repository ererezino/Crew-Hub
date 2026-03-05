const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60]
];

function toDate(value: string | Date): Date | null {
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

export function toIsoDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

/* ─── Canonical formatting API ─── */

/**
 * "March 24, 2026"
 * Accepts ISO date strings (YYYY-MM-DD) or Date objects.
 */
export function formatDate(value: string | Date): string {
  const iso = typeof value === "string" && !value.includes("T") ? value + "T00:00:00Z" : value;
  const dateValue = toDate(iso);

  if (!dateValue) {
    return typeof value === "string" ? value : "--";
  }

  return dateValue.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

/** Alias kept for backward compatibility. */
export const formatSingleDateHuman = formatDate;

/**
 * "Mar 24, 2026"
 */
export function formatDateShort(value: string | Date): string {
  const iso = typeof value === "string" && !value.includes("T") ? value + "T00:00:00Z" : value;
  const dateValue = toDate(iso);

  if (!dateValue) {
    return typeof value === "string" ? value : "--";
  }

  return dateValue.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

/**
 * "March 24–27, 2026" or "Mar 24 – Apr 2, 2026" etc.
 */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = toDate(startDate + "T00:00:00Z");
  const end = toDate(endDate + "T00:00:00Z");

  if (!start || !end) {
    return `${startDate} – ${endDate}`;
  }

  if (startDate === endDate) {
    return formatDate(startDate);
  }

  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  if (sameMonth && sameYear) {
    const month = start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }

  if (sameYear) {
    const startStr = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });
    const endStr = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });
    return `${startStr} – ${endStr}, ${start.getUTCFullYear()}`;
  }

  return `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;
}

/** Alias kept for backward compatibility. */
export const formatDateRangeHuman = formatDateRange;

/**
 * "3 days ago" / "in 2 weeks" / "today" / "just now"
 */
export function formatRelative(value: string | Date): string {
  const dateValue = toDate(value);

  if (!dateValue) {
    return "--";
  }

  const now = new Date();
  const secondsDifference = Math.round((now.getTime() - dateValue.getTime()) / 1000);

  for (const [unit, secondsInUnit] of relativeUnits) {
    if (Math.abs(secondsDifference) >= secondsInUnit) {
      const relativeValue = Math.round(secondsDifference / secondsInUnit) * -1;
      return relativeTimeFormatter.format(relativeValue, unit);
    }
  }

  return "just now";
}

/** Alias kept for backward compatibility. */
export const formatRelativeTime = formatRelative;

/**
 * "March 2026"
 */
export function formatMonth(value: string | Date): string {
  const iso = typeof value === "string" && !value.includes("T") ? value + "T00:00:00Z" : value;
  const dateValue = toDate(iso);

  if (!dateValue) {
    return typeof value === "string" ? value : "--";
  }

  return dateValue.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

/**
 * Format a UTC timestamp in the employee's timezone.
 * Example: formatInTimezone("2026-03-24T06:00:00Z", "Africa/Nairobi") → "March 24, 2026, 9:00 AM"
 */
export function formatInTimezone(timestampUTC: string | Date, timezone: string): string {
  const dateValue = toDate(timestampUTC);

  if (!dateValue) {
    return "--";
  }

  try {
    return dateValue.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone
    });
  } catch {
    // Fallback if timezone is invalid
    return dateValue.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }
}

/**
 * Format a UTC timestamp's time portion only in the employee's timezone.
 * Example: formatTimeInTimezone("2026-03-24T06:00:00Z", "Africa/Nairobi") → "9:00 AM"
 */
export function formatTimeInTimezone(timestampUTC: string | Date, timezone: string): string {
  const dateValue = toDate(timestampUTC);

  if (!dateValue) {
    return "--";
  }

  try {
    return dateValue.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone
    });
  } catch {
    return dateValue.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  }
}

export function formatDateTimeTooltip(value: string | Date): string {
  const dateValue = toDate(value);

  if (!dateValue) {
    return "--";
  }

  return dateValue.toLocaleString();
}

/* ─── Number formatting helpers ─── */

/**
 * Format a numeric value for display, stripping unnecessary decimal places.
 * 16.0 → "16"   |   16.5 → "16.5"   |   3.25 → "3.25"
 */
export function formatDays(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  // Remove trailing zeros after decimal
  return Number(value.toFixed(1)).toString();
}
