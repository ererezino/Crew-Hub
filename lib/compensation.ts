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

function toIsoDate(dateValue: Date): string {
  return dateValue.toISOString().slice(0, 10);
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

function addUtcMonths(dateValue: Date, monthsToAdd: number): Date {
  const nextDate = new Date(dateValue.getTime());
  nextDate.setUTCMonth(nextDate.getUTCMonth() + monthsToAdd);
  return nextDate;
}

function hasFractionalShares(value: number): boolean {
  return Math.abs(value - Math.round(value)) > 0.0001;
}

function clampToFourDecimals(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function calculateSharesAtCompletedMonths(
  totalShares: number,
  cliffMonths: number,
  vestingDurationMonths: number,
  completedMonths: number
): number {
  if (totalShares <= 0 || vestingDurationMonths <= 0 || completedMonths <= 0) {
    return 0;
  }

  if (completedMonths < cliffMonths) {
    return 0;
  }

  if (completedMonths >= vestingDurationMonths) {
    return totalShares;
  }

  if (hasFractionalShares(totalShares)) {
    return clampToFourDecimals((totalShares * completedMonths) / vestingDurationMonths);
  }

  const cliffShares = Math.floor((totalShares * cliffMonths) / vestingDurationMonths);

  if (vestingDurationMonths === cliffMonths) {
    return completedMonths >= cliffMonths ? totalShares : 0;
  }

  const remainingShares = totalShares - cliffShares;
  const postCliffCompletedMonths = completedMonths - cliffMonths;
  const postCliffDurationMonths = vestingDurationMonths - cliffMonths;
  const vestedPostCliffShares = Math.floor(
    (remainingShares * postCliffCompletedMonths) / postCliffDurationMonths
  );

  return cliffShares + vestedPostCliffShares;
}

export type VestingProgress = {
  totalShares: number;
  vestedShares: number;
  unvestedShares: number;
  vestedPercent: number;
  cliffPercent: number;
  elapsedMonths: number;
  completedMonths: number;
  cliffMonths: number;
  vestingDurationMonths: number;
  todayOffsetPercent: number;
  cliffDate: string | null;
  fullyVestedDate: string | null;
  nextVestingDate: string | null;
  nextVestingShares: number;
  remainingMonths: number;
  isFullyVested: boolean;
  cliffReached: boolean;
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
      completedMonths: 0,
      cliffMonths: Math.max(0, grant.cliffMonths),
      vestingDurationMonths: Math.max(1, grant.vestingDurationMonths),
      todayOffsetPercent: 0,
      cliffDate: null,
      fullyVestedDate: null,
      nextVestingDate: null,
      nextVestingShares: 0,
      remainingMonths: Math.max(1, grant.vestingDurationMonths),
      isFullyVested: false,
      cliffReached: false
    };
  }

  const elapsedMonths = fullMonthsBetween(vestingStart, asOfDate);
  const vestingDurationMonths = Math.max(1, grant.vestingDurationMonths);
  const cliffMonths = Math.max(0, grant.cliffMonths);
  const completedMonths = Math.min(vestingDurationMonths, elapsedMonths);
  const vestedShares = clampToFourDecimals(
    calculateSharesAtCompletedMonths(
      totalShares,
      cliffMonths,
      vestingDurationMonths,
      completedMonths
    )
  );
  const unvestedShares = clampToFourDecimals(Math.max(0, totalShares - vestedShares));
  const vestedPercentRaw = totalShares <= 0 ? 0 : (vestedShares / totalShares) * 100;
  const vestedPercent = Math.max(0, Math.min(100, vestedPercentRaw));
  const cliffShares = calculateSharesAtCompletedMonths(
    totalShares,
    cliffMonths,
    vestingDurationMonths,
    cliffMonths
  );
  const cliffPercent = totalShares <= 0 ? 0 : Math.max(0, Math.min(100, (cliffShares / totalShares) * 100));
  const fullyVestedDateValue = addUtcMonths(vestingStart, vestingDurationMonths);
  const cliffDateValue = cliffMonths > 0 ? addUtcMonths(vestingStart, cliffMonths) : vestingStart;
  const totalVestingWindowMs = fullyVestedDateValue.getTime() - vestingStart.getTime();
  const elapsedWindowMs = Math.max(0, Math.min(totalVestingWindowMs, asOfDate.getTime() - vestingStart.getTime()));
  const todayOffsetPercent =
    totalVestingWindowMs <= 0 ? (vestedPercent >= 100 ? 100 : 0) : (elapsedWindowMs / totalVestingWindowMs) * 100;
  const isFullyVested = vestedShares >= totalShares;
  const cliffReached = completedMonths >= cliffMonths;
  const nextCompletedMonths = completedMonths < cliffMonths ? cliffMonths : completedMonths + 1;
  const nextVestingDate = isFullyVested ? null : toIsoDate(addUtcMonths(vestingStart, nextCompletedMonths));
  const nextVestingShares = isFullyVested
    ? 0
    : clampToFourDecimals(
        Math.max(
          0,
          calculateSharesAtCompletedMonths(
            totalShares,
            cliffMonths,
            vestingDurationMonths,
            Math.min(vestingDurationMonths, nextCompletedMonths)
          ) - vestedShares
        )
      );
  const remainingMonths = Math.max(0, vestingDurationMonths - completedMonths);

  return {
    totalShares,
    vestedShares,
    unvestedShares,
    vestedPercent,
    cliffPercent,
    elapsedMonths,
    completedMonths,
    cliffMonths,
    vestingDurationMonths,
    todayOffsetPercent,
    cliffDate: toIsoDate(cliffDateValue),
    fullyVestedDate: toIsoDate(fullyVestedDateValue),
    nextVestingDate,
    nextVestingShares,
    remainingMonths,
    isFullyVested,
    cliffReached
  };
}

export function calculateGrantExpirationDate(grantDate: string): string | null {
  const parsedGrantDate = parseIsoDate(grantDate);

  if (!parsedGrantDate) {
    return null;
  }

  return toIsoDate(addUtcMonths(parsedGrantDate, 120));
}
