import type {
  PayrollAnomaly,
  PayrollItemVariance,
  PayrollRunItem
} from "../../types/payroll-runs";

const LARGE_VARIANCE_THRESHOLD = 0.15;

function percentChange(previous: number, current: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 1;
  }

  return (current - previous) / Math.abs(previous);
}

/**
 * Compare current payroll items against the previous period's items
 * and return variance data keyed by employee ID.
 */
export function computeVariances(
  currentItems: readonly PayrollRunItem[],
  previousItems: readonly PayrollRunItem[]
): Record<string, PayrollItemVariance> {
  const previousByEmployee = new Map<
    string,
    { grossAmount: number; netAmount: number }
  >();

  for (const item of previousItems) {
    previousByEmployee.set(item.employeeId, {
      grossAmount: item.grossAmount,
      netAmount: item.netAmount
    });
  }

  const variances: Record<string, PayrollItemVariance> = {};

  for (const item of currentItems) {
    const prev = previousByEmployee.get(item.employeeId);

    if (!prev) {
      continue;
    }

    const grossChange = item.grossAmount - prev.grossAmount;
    const netChange = item.netAmount - prev.netAmount;

    variances[item.employeeId] = {
      employeeId: item.employeeId,
      grossChange,
      netChange,
      grossChangePercent: percentChange(prev.grossAmount, item.grossAmount),
      netChangePercent: percentChange(prev.netAmount, item.netAmount),
      previousGross: prev.grossAmount,
      previousNet: prev.netAmount
    };
  }

  return variances;
}

/**
 * Detect anomalies across payroll items and return a list of flagged issues.
 * Checks for: large variance (>15%), new employees, zero gross, negative net.
 */
export function detectAnomalies(
  items: readonly PayrollRunItem[],
  variances: Record<string, PayrollItemVariance>,
  previousEmployeeIds: ReadonlySet<string>
): PayrollAnomaly[] {
  const anomalies: PayrollAnomaly[] = [];

  const largeVarianceIds: string[] = [];
  const newEmployeeIds: string[] = [];
  const zeroGrossIds: string[] = [];
  const negativeNetIds: string[] = [];

  for (const item of items) {
    const variance = variances[item.employeeId];

    if (
      variance &&
      Math.abs(variance.grossChangePercent) > LARGE_VARIANCE_THRESHOLD
    ) {
      largeVarianceIds.push(item.id);
    }

    if (!previousEmployeeIds.has(item.employeeId) && previousEmployeeIds.size > 0) {
      newEmployeeIds.push(item.id);
    }

    if (item.grossAmount === 0) {
      zeroGrossIds.push(item.id);
    }

    if (item.netAmount < 0) {
      negativeNetIds.push(item.id);
    }
  }

  if (largeVarianceIds.length > 0) {
    anomalies.push({
      type: "large_variance",
      label: "Large pay variance detected",
      description: `${largeVarianceIds.length} employee${largeVarianceIds.length === 1 ? "" : "s"} show${largeVarianceIds.length === 1 ? "s" : ""} gross pay changes exceeding 15% from the previous period.`,
      severity: "warning",
      itemIds: largeVarianceIds
    });
  }

  if (newEmployeeIds.length > 0) {
    anomalies.push({
      type: "new_employee",
      label: "New employees in this run",
      description: `${newEmployeeIds.length} employee${newEmployeeIds.length === 1 ? "" : "s"} appear${newEmployeeIds.length === 1 ? "s" : ""} for the first time in payroll. Verify compensation setup.`,
      severity: "warning",
      itemIds: newEmployeeIds
    });
  }

  if (zeroGrossIds.length > 0) {
    anomalies.push({
      type: "zero_gross",
      label: "Zero gross pay",
      description: `${zeroGrossIds.length} employee${zeroGrossIds.length === 1 ? "" : "s"} ha${zeroGrossIds.length === 1 ? "s" : "ve"} a gross amount of zero. This may indicate missing compensation data.`,
      severity: "critical",
      itemIds: zeroGrossIds
    });
  }

  if (negativeNetIds.length > 0) {
    anomalies.push({
      type: "negative_net",
      label: "Negative net pay",
      description: `${negativeNetIds.length} employee${negativeNetIds.length === 1 ? "" : "s"} ha${negativeNetIds.length === 1 ? "s" : "ve"} a negative net amount. Deductions may exceed gross pay.`,
      severity: "critical",
      itemIds: negativeNetIds
    });
  }

  return anomalies;
}
