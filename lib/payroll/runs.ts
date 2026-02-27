import type {
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

export function getCurrencyTotal(
  totals: PayrollCurrencyTotals,
  currency: string = "USD"
): number {
  const currencyCode = normalizeCurrencyCode(currency);
  return totals[currencyCode] ?? 0;
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
    case "pending_first_approval":
    case "pending_final_approval":
      return "pending";
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

export function currentMonthPeriod(now: Date = new Date()): {
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return {
    payPeriodStart: start.toISOString().slice(0, 10),
    payPeriodEnd: end.toISOString().slice(0, 10),
    payDate: end.toISOString().slice(0, 10)
  };
}

export function adjustmentTotal(adjustments: readonly PayrollRunAdjustment[]): number {
  return adjustments.reduce((sum, adjustment) => sum + Math.trunc(adjustment.amount), 0);
}

export function deductionTotal(
  deductions: readonly PayrollRunDeduction[] | readonly PayrollRunEmployerContribution[]
): number {
  return deductions.reduce((sum, deduction) => sum + Math.max(0, Math.trunc(deduction.amount)), 0);
}
