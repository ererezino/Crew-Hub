import type {
  PayrollCurrencyTotals,
  PayrollOvertimeSummary,
  PayrollRunStatus
} from "../../types/payroll-runs";
import { addCurrencyTotal, normalizeCurrencyCode } from "./runs";

export type MonthlyOvertimeEntry = {
  id: string;
  employeeId: string;
  hours: number;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  payrollItemId: string | null;
};

export type MonthlyOvertimeEmployeeAggregate = {
  employeeId: string;
  hours: number;
  amount: number;
  currency: string | null;
  entryIds: string[];
  hasCurrencyMismatch: boolean;
};

export function getPreviousMonthWindow(payPeriodStart: string): {
  sourceMonth: string;
  periodStart: string;
  periodEnd: string;
} {
  const anchor = new Date(`${payPeriodStart}T00:00:00.000Z`);

  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Pay period start must be a valid ISO date.");
  }

  const previousMonthStart = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)
  );
  const previousMonthEnd = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0)
  );

  return {
    sourceMonth: previousMonthStart.toISOString().slice(0, 7),
    periodStart: previousMonthStart.toISOString().slice(0, 10),
    periodEnd: previousMonthEnd.toISOString().slice(0, 10)
  };
}

export function canApproveMonthlyOvertime(runStatus: PayrollRunStatus): boolean {
  return runStatus === "draft" || runStatus === "calculated" || runStatus === "rejected";
}

export function calculateOvertimeHourlyRate(monthlyCompensationAmount: number): number {
  if (!Number.isFinite(monthlyCompensationAmount) || monthlyCompensationAmount <= 0) {
    return 0;
  }

  return monthlyCompensationAmount / 160;
}

export function calculateOvertimeCompensation({
  monthlyCompensationAmount,
  overtimeHours
}: {
  monthlyCompensationAmount: number;
  overtimeHours: number;
}): number {
  if (!Number.isFinite(overtimeHours) || overtimeHours <= 0) {
    return 0;
  }

  return Math.round(calculateOvertimeHourlyRate(monthlyCompensationAmount) * overtimeHours);
}

function isEntryAvailableForRun(
  entry: MonthlyOvertimeEntry,
  currentRunId: string,
  linkedRunIdByPayrollItemId: ReadonlyMap<string, string>
): boolean {
  if (!entry.payrollItemId) {
    return true;
  }

  return linkedRunIdByPayrollItemId.get(entry.payrollItemId) === currentRunId;
}

export function summarizeMonthlyOvertime({
  entries,
  currentRunId,
  linkedRunIdByPayrollItemId,
  sourceMonth,
  periodStart,
  periodEnd
}: {
  entries: readonly MonthlyOvertimeEntry[];
  currentRunId: string;
  linkedRunIdByPayrollItemId: ReadonlyMap<string, string>;
  sourceMonth: string;
  periodStart: string;
  periodEnd: string;
}): PayrollOvertimeSummary {
  const employeeIds = new Set<string>();
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let linkedApprovedCount = 0;
  let pendingHours = 0;
  let approvedHours = 0;
  let pendingTotals: PayrollCurrencyTotals = {};
  let approvedTotals: PayrollCurrencyTotals = {};

  for (const entry of entries) {
    employeeIds.add(entry.employeeId);

    if (entry.status === "pending") {
      pendingCount += 1;
      pendingHours += entry.hours;
      pendingTotals = addCurrencyTotal(
        pendingTotals,
        normalizeCurrencyCode(entry.currency),
        entry.amount
      );
      continue;
    }

    if (entry.status === "rejected") {
      rejectedCount += 1;
      continue;
    }

    if (!isEntryAvailableForRun(entry, currentRunId, linkedRunIdByPayrollItemId)) {
      continue;
    }

    approvedCount += 1;
    approvedHours += entry.hours;
    approvedTotals = addCurrencyTotal(
      approvedTotals,
      normalizeCurrencyCode(entry.currency),
      entry.amount
    );

    if (
      entry.payrollItemId &&
      linkedRunIdByPayrollItemId.get(entry.payrollItemId) === currentRunId
    ) {
      linkedApprovedCount += 1;
    }
  }

  return {
    sourceMonth,
    periodStart,
    periodEnd,
    employeeCount: employeeIds.size,
    pendingCount,
    approvedCount,
    rejectedCount,
    linkedApprovedCount,
    pendingHours,
    approvedHours,
    pendingTotals,
    approvedTotals,
    hasPendingEntries: pendingCount > 0,
    hasApprovedEntries: approvedCount > 0
  };
}

export function aggregateApprovedMonthlyOvertimeByEmployee({
  entries,
  currentRunId,
  linkedRunIdByPayrollItemId
}: {
  entries: readonly MonthlyOvertimeEntry[];
  currentRunId: string;
  linkedRunIdByPayrollItemId: ReadonlyMap<string, string>;
}): Map<string, MonthlyOvertimeEmployeeAggregate> {
  const grouped = new Map<string, MonthlyOvertimeEmployeeAggregate>();

  for (const entry of entries) {
    if (entry.status !== "approved") {
      continue;
    }

    if (!isEntryAvailableForRun(entry, currentRunId, linkedRunIdByPayrollItemId)) {
      continue;
    }

    const normalizedCurrency = normalizeCurrencyCode(entry.currency);
    const current = grouped.get(entry.employeeId) ?? {
      employeeId: entry.employeeId,
      hours: 0,
      amount: 0,
      currency: null,
      entryIds: [],
      hasCurrencyMismatch: false
    };

    if (current.currency && current.currency !== normalizedCurrency) {
      current.hasCurrencyMismatch = true;
    } else if (!current.currency) {
      current.currency = normalizedCurrency;
    }

    current.hours += entry.hours;
    current.amount += entry.amount;
    current.entryIds.push(entry.id);
    grouped.set(entry.employeeId, current);
  }

  return grouped;
}
