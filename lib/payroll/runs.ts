import type {
  PayrollCycleStatus,
  PayrollCurrencyTotals,
  PayrollRunAdjustment,
  PayrollRunDeduction,
  PayrollRunEmployerContribution,
  PayrollRunStatus
} from "../../types/payroll-runs";

type StatusTone =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "draft"
  | "processing";

export function normalizeCurrencyCode(currency: string | null | undefined): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
}

export function parseCurrencyTotals(value: unknown): PayrollCurrencyTotals {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const totals: PayrollCurrencyTotals = {};

  for (const [currencyKey, amountValue] of Object.entries(value)) {
    const currencyCode = normalizeCurrencyCode(currencyKey);
    const parsedAmount =
      typeof amountValue === "number"
        ? amountValue
        : typeof amountValue === "string"
          ? Number.parseInt(amountValue, 10)
          : Number.NaN;

    if (Number.isFinite(parsedAmount)) {
      totals[currencyCode] = Math.trunc(parsedAmount);
    }
  }

  return totals;
}

export function addCurrencyTotal(
  totals: PayrollCurrencyTotals,
  currency: string,
  amount: number
): PayrollCurrencyTotals {
  const currencyCode = normalizeCurrencyCode(currency);
  const currentValue = totals[currencyCode] ?? 0;

  return {
    ...totals,
    [currencyCode]: currentValue + Math.trunc(amount)
  };
}

export function calculatePayrollWorksheetMonthlyTotal(input: {
  cycle1BaseAmount: number;
  cycle2BaseAmount: number;
  cycle1OvertimeAmount: number;
  cycle2OvertimeAmount: number;
  bonus: number;
  fees: number;
}): number {
  return (
    input.cycle1BaseAmount
    + input.cycle2BaseAmount
    + input.cycle1OvertimeAmount
    + input.cycle2OvertimeAmount
    + input.bonus
    + input.fees
  );
}

export function calculatePayrollRunCurrencyTotals(
  rows: ReadonlyArray<{
    grossAmount: number;
    netAmount: number;
    /**
     * Sum of the row's actual deduction line items in integer minor units.
     * This is the real total of withheld amounts for the row — NOT
     * `grossAmount - netAmount`, which silently folds in adjustments
     * (net = gross - deductions + adjustments) and is therefore wrong
     * whenever an adjustment is present.
     */
    deductionsAmount: number;
    payCurrency: string;
  }>
): {
  totalGross: PayrollCurrencyTotals;
  totalNet: PayrollCurrencyTotals;
  totalDeductions: PayrollCurrencyTotals;
} {
  let totalGross: PayrollCurrencyTotals = {};
  let totalNet: PayrollCurrencyTotals = {};
  let totalDeductions: PayrollCurrencyTotals = {};

  for (const row of rows) {
    totalGross = addCurrencyTotal(totalGross, row.payCurrency, row.grossAmount);
    totalNet = addCurrencyTotal(totalNet, row.payCurrency, row.netAmount);
    totalDeductions = addCurrencyTotal(
      totalDeductions,
      row.payCurrency,
      row.deductionsAmount
    );
  }

  return { totalGross, totalNet, totalDeductions };
}

export function getCurrencyTotal(
  totals: PayrollCurrencyTotals,
  currency: string = "USD"
): number {
  const currencyCode = normalizeCurrencyCode(currency);
  return totals[currencyCode] ?? 0;
}

/**
 * Return the dominant currency code from a PayrollCurrencyTotals record.
 * Picks the key with the highest amount; falls back to the given default.
 */
export function getPrimaryCurrency(
  totals: PayrollCurrencyTotals,
  fallback: string = "NGN"
): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return fallback;
  let best = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i][1] > best[1]) best = entries[i];
  }
  return best[0] || fallback;
}

export function labelForPayrollRunStatus(status: PayrollRunStatus): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toneForPayrollRunStatus(status: PayrollRunStatus): StatusTone {
  switch (status) {
    case "draft":
      return "draft";
    case "calculated":
      return "info";
    case "submitted":
      return "pending";
    case "rejected":
      return "warning";
    case "approved":
      return "success";
    case "processing":
      return "processing";
    case "completed":
      return "success";
    case "cancelled":
      return "error";
    default:
      return "draft";
  }
}

/**
 * Derive the month-level payroll run status from the real semimonthly cycle state.
 * This keeps run status as a truthful aggregate while Cycle 1 / Cycle 2 remain
 * the operational source of truth.
 */
export function derivePayrollRunStatusFromCycles(
  cycleStatuses: readonly PayrollCycleStatus[],
  currentStatus: PayrollRunStatus
): PayrollRunStatus {
  if (currentStatus === "cancelled" || currentStatus === "completed") {
    return currentStatus;
  }

  const activeStatuses = cycleStatuses.filter((status) => status !== "cancelled");

  if (activeStatuses.length === 0) {
    return currentStatus === "draft" ? "draft" : "calculated";
  }

  if (activeStatuses.every((status) => status === "draft")) {
    return "calculated";
  }

  if (activeStatuses.some((status) => status === "processing" || status === "paid")) {
    return "processing";
  }

  if (activeStatuses.some((status) => status === "submitted")) {
    return "submitted";
  }

  if (activeStatuses.some((status) => status === "rejected" || status === "failed")) {
    return "rejected";
  }

  if (activeStatuses.some((status) => status === "approved" || status === "ready")) {
    return "approved";
  }

  return currentStatus;
}

export function currentMonthPeriod(now: Date = new Date()): {
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    payPeriodStart: start.toISOString().slice(0, 10),
    payPeriodEnd: end.toISOString().slice(0, 10),
    // Legacy run.payDate should align to the second semimonthly cycle, not month-end.
    payDate: thirdFriday(year, month)
  };
}

/**
 * Compute period dates for an arbitrary year/month.
 * month is 1-based (1 = January, 12 = December).
 */
export function monthPeriod(year: number, month: number): {
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
} {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    payPeriodStart: start.toISOString().slice(0, 10),
    payPeriodEnd: end.toISOString().slice(0, 10),
    // Keep the legacy field aligned with the second semimonthly payout date.
    payDate: thirdFriday(year, month)
  };
}

/**
 * Return the first Friday of a given month (1-based).
 * Used for Cycle 1 target pay date.
 */
export function firstFriday(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = date.getUTCDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  date.setUTCDate(1 + daysUntilFriday);
  return date.toISOString().slice(0, 10);
}

/**
 * Return the third Friday of a given month (1-based).
 * Used for Cycle 2 target pay date.
 */
export function thirdFriday(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = date.getUTCDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  date.setUTCDate(1 + daysUntilFriday + 14);
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the semimonthly cycle dates for a given year/month.
 */
export function semiMonthlyCycleDates(year: number, month: number): {
  cycle1Date: string;
  cycle2Date: string;
} {
  return {
    cycle1Date: firstFriday(year, month),
    cycle2Date: thirdFriday(year, month)
  };
}

/**
 * Parse a run_month string (YYYY-MM) into year and month.
 */
export function parseRunMonth(runMonth: string): { year: number; month: number } | null {
  const match = runMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return { year: Number.parseInt(match[1], 10), month: Number.parseInt(match[2], 10) };
}

export function labelForPayrollCycleStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toneForPayrollCycleStatus(status: string): StatusTone {
  switch (status) {
    case "draft":
      return "draft";
    case "submitted":
      return "pending";
    case "approved":
      return "success";
    case "rejected":
      return "warning";
    case "ready":
      return "info";
    case "processing":
      return "processing";
    case "paid":
      return "success";
    case "failed":
      return "error";
    case "cancelled":
      return "error";
    default:
      return "draft";
  }
}

export function adjustmentTotal(adjustments: readonly PayrollRunAdjustment[]): number {
  return adjustments.reduce((sum, adjustment) => sum + Math.trunc(adjustment.amount), 0);
}

export function deductionTotal(
  deductions: readonly PayrollRunDeduction[] | readonly PayrollRunEmployerContribution[]
): number {
  return deductions.reduce((sum, deduction) => sum + Math.max(0, Math.trunc(deduction.amount)), 0);
}
