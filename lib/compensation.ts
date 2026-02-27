import type {
  AllowanceType,
  CompensationEmploymentType,
  CompensationPayFrequency,
  EquityGrantRecord,
  EquityGrantStatus
} from "../types/compensation";

export function parseBigIntValue(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumericValue(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatPayFrequencyLabel(value: CompensationPayFrequency): string {
  switch (value) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Biweekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return "Annual";
    default:
      return value;
  }
}

export function formatEmploymentTypeLabel(value: CompensationEmploymentType): string {
  switch (value) {
    case "full_time":
      return "Full time";
    case "part_time":
      return "Part time";
    case "contractor":
      return "Contractor";
    default:
      return value;
  }
}

export function formatAllowanceTypeLabel(value: AllowanceType): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toneForEquityStatus(status: EquityGrantStatus) {
  switch (status) {
    case "active":
      return "success" as const;
    case "vested":
      return "info" as const;
    case "draft":
      return "draft" as const;
    case "cancelled":
      return "warning" as const;
    case "terminated":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function parseIsoDate(dateValue: string): Date | null {
  const parsedDate = new Date(`${dateValue}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function fullMonthsBetween(startDate: Date, endDate: Date): number {
  if (endDate.getTime() < startDate.getTime()) {
    return 0;
  }

  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();

  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth();
  const endDay = endDate.getUTCDate();

  let months = (endYear - startYear) * 12 + (endMonth - startMonth);

  if (endDay < startDay) {
    months -= 1;
  }

  return Math.max(0, months);
}

export type VestingProgress = {
  totalShares: number;
  vestedShares: number;
  unvestedShares: number;
  vestedPercent: number;
  cliffPercent: number;
  elapsedMonths: number;
  cliffMonths: number;
  vestingDurationMonths: number;
  todayOffsetPercent: number;
};

export function calculateVestingProgress(
  grant: Pick<
    EquityGrantRecord,
    "numberOfShares" | "vestingStartDate" | "cliffMonths" | "vestingDurationMonths"
  >,
  asOfDate: Date = new Date()
): VestingProgress {
  const totalShares = Math.max(0, grant.numberOfShares);
  const vestingStart = parseIsoDate(grant.vestingStartDate);

  if (!vestingStart || grant.vestingDurationMonths <= 0 || totalShares <= 0) {
    return {
      totalShares,
      vestedShares: 0,
      unvestedShares: totalShares,
      vestedPercent: 0,
      cliffPercent: 0,
      elapsedMonths: 0,
      cliffMonths: Math.max(0, grant.cliffMonths),
      vestingDurationMonths: Math.max(1, grant.vestingDurationMonths),
      todayOffsetPercent: 0
    };
  }

  const elapsedMonths = fullMonthsBetween(vestingStart, asOfDate);
  const vestingDurationMonths = Math.max(1, grant.vestingDurationMonths);
  const cliffMonths = Math.max(0, grant.cliffMonths);

  const vestedMonths =
    elapsedMonths < cliffMonths
      ? 0
      : Math.min(vestingDurationMonths, elapsedMonths + 1);

  const vestedPercentRaw = (vestedMonths / vestingDurationMonths) * 100;
  const vestedPercent = Math.max(0, Math.min(100, vestedPercentRaw));
  const cliffPercent = Math.max(0, Math.min(100, (cliffMonths / vestingDurationMonths) * 100));

  const vestedShares = (totalShares * vestedPercent) / 100;
  const unvestedShares = Math.max(0, totalShares - vestedShares);

  const todayOffsetPercent = Math.max(
    0,
    Math.min(100, ((elapsedMonths + 1) / vestingDurationMonths) * 100)
  );

  return {
    totalShares,
    vestedShares,
    unvestedShares,
    vestedPercent,
    cliffPercent,
    elapsedMonths,
    cliffMonths,
    vestingDurationMonths,
    todayOffsetPercent
  };
}
