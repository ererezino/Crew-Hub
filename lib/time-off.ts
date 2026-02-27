type ParsedDate = {
  year: number;
  month: number;
  day: number;
};

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseIsoDateParts(value: string): ParsedDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  return Boolean(parseIsoDateParts(value));
}

export function isoDateToUtcDate(value: string): Date | null {
  const parsed = parseIsoDateParts(value);

  if (!parsed) {
    return null;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

export function utcDateToIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = padDatePart(date.getUTCMonth() + 1);
  const day = padDatePart(date.getUTCDate());
  return `${year}-${month}-${day}`;
}

export function monthToDateRange(month: string): { startDate: string; endDate: string } | null {
  const parsed = /^(\d{4})-(\d{2})$/.exec(month);

  if (!parsed) {
    return null;
  }

  const year = Number.parseInt(parsed[1] ?? "", 10);
  const monthValue = Number.parseInt(parsed[2] ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
    return null;
  }

  const start = new Date(Date.UTC(year, monthValue - 1, 1));
  const end = new Date(Date.UTC(year, monthValue, 0));

  return {
    startDate: utcDateToIsoDate(start),
    endDate: utcDateToIsoDate(end)
  };
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${padDatePart(now.getUTCMonth() + 1)}`;
}

export function enumerateIsoDatesInRange(startDate: string, endDate: string): string[] {
  const start = isoDateToUtcDate(startDate);
  const end = isoDateToUtcDate(endDate);

  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(start.getTime());

  while (cursor.getTime() <= end.getTime()) {
    dates.push(utcDateToIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function isWeekendUtc(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function calculateWorkingDays(
  startDate: string,
  endDate: string,
  holidayDateKeys: ReadonlySet<string>
): number {
  const start = isoDateToUtcDate(startDate);
  const end = isoDateToUtcDate(endDate);

  if (!start || !end || start.getTime() > end.getTime()) {
    return 0;
  }

  const cursor = new Date(start.getTime());
  let workingDays = 0;

  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekendUtc(cursor)) {
      const dateKey = utcDateToIsoDate(cursor);

      if (!holidayDateKeys.has(dateKey)) {
        workingDays += 1;
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return workingDays;
}

export function normalizeCountryCode(countryCode: string | null | undefined): string | null {
  if (!countryCode) {
    return null;
  }

  const normalized = countryCode.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function formatLeaveTypeLabel(leaveType: string): string {
  return leaveType
    .replace(/_/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseNumeric(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
