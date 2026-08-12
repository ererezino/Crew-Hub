import { partitionByPrimaryCurrency } from "../expenses";
import type {
  AnalyticsExpensesCategoryRow,
  AnalyticsExpensesTrendRow,
  AnalyticsExpensesTopSpenderRow
} from "../../types/analytics";

/**
 * Route-side replacement for the `analytics_expenses` SQL RPC, which summed
 * `amount` minor units across ALL currencies (NGN + USD in one figure).
 *
 * Same shape and semantics as the RPC — totalAmount over everything in
 * range, approvedAmount = approved + reimbursed, pendingAmount = pending,
 * zero-filled month trend, top 8 spenders joined to live profiles — except
 * every amount, bucket, and chart shares ONE denominator: the dominant
 * currency's expenses (PR #99's reports treatment). Rows in other currencies
 * are excluded from the aggregation and reported explicitly so the UI can
 * say so instead of rendering a meaningless mixed sum.
 *
 * Pure: callers fetch rows/profiles and hand them in, which is what makes
 * the aggregation unit-testable (see tests/analytics-mixed-currency.test.ts).
 */

export type AnalyticsExpenseSourceRow = {
  amount: number;
  currency: string;
  status: string;
  category: string;
  expense_date: string;
  employee_id: string;
};

export type AnalyticsExpenseProfile = {
  id: string;
  full_name: string;
  department: string | null;
  country_code: string | null;
};

export type ExpensesAnalyticsAggregation = {
  primaryCurrency: string;
  excludedCurrencies: Array<{ currency: string; count: number }>;
  metrics: {
    totalAmount: number;
    approvedAmount: number;
    pendingAmount: number;
    reimbursedAmount: number;
    expenseCount: number;
  };
  byCategory: AnalyticsExpensesCategoryRow[];
  trend: AnalyticsExpensesTrendRow[];
  topSpenders: AnalyticsExpensesTopSpenderRow[];
};

const TOP_SPENDER_LIMIT = 8;

function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Zero-filled YYYY-MM series covering [startDate, endDate], like the RPC's generate_series. */
export function monthSeries(startDate: string, endDate: string): string[] {
  const start = new Date(`${monthKeyOf(startDate)}-01T00:00:00.000Z`);
  const end = new Date(`${monthKeyOf(endDate)}-01T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

export function buildExpensesAnalytics({
  rows,
  profileById,
  startDate,
  endDate
}: {
  rows: readonly AnalyticsExpenseSourceRow[];
  profileById: ReadonlyMap<string, AnalyticsExpenseProfile>;
  startDate: string;
  endDate: string;
}): ExpensesAnalyticsAggregation {
  const { primaryCurrency, primaryRows, excludedCurrencies } =
    partitionByPrimaryCurrency(rows);

  let totalAmount = 0;
  let approvedAmount = 0;
  let pendingAmount = 0;
  let reimbursedAmount = 0;

  const byCategoryMap = new Map<string, { totalAmount: number; expenseCount: number }>();
  const byMonthMap = new Map<string, { totalAmount: number; expenseCount: number }>();
  const bySpenderMap = new Map<string, { totalAmount: number; expenseCount: number }>();

  for (const row of primaryRows) {
    const amount = Math.trunc(row.amount);
    totalAmount += amount;

    if (row.status === "approved" || row.status === "reimbursed") {
      approvedAmount += amount;
    }
    if (row.status === "pending") {
      pendingAmount += amount;
    }
    if (row.status === "reimbursed") {
      reimbursedAmount += amount;
    }

    const category = byCategoryMap.get(row.category) ?? { totalAmount: 0, expenseCount: 0 };
    category.totalAmount += amount;
    category.expenseCount += 1;
    byCategoryMap.set(row.category, category);

    const month = monthKeyOf(row.expense_date);
    const monthEntry = byMonthMap.get(month) ?? { totalAmount: 0, expenseCount: 0 };
    monthEntry.totalAmount += amount;
    monthEntry.expenseCount += 1;
    byMonthMap.set(month, monthEntry);

    const spender = bySpenderMap.get(row.employee_id) ?? { totalAmount: 0, expenseCount: 0 };
    spender.totalAmount += amount;
    spender.expenseCount += 1;
    bySpenderMap.set(row.employee_id, spender);
  }

  const byCategory = [...byCategoryMap.entries()]
    .map(([key, value]) => ({
      key,
      totalAmount: value.totalAmount,
      expenseCount: value.expenseCount
    }))
    .sort(
      (left, right) =>
        right.totalAmount - left.totalAmount || left.key.localeCompare(right.key)
    );

  const trend = monthSeries(startDate, endDate).map((month) => ({
    month,
    totalAmount: byMonthMap.get(month)?.totalAmount ?? 0,
    expenseCount: byMonthMap.get(month)?.expenseCount ?? 0
  }));

  const topSpenders = [...bySpenderMap.entries()]
    /* The RPC inner-joins live profiles — spenders without one drop out. */
    .flatMap(([employeeId, value]) => {
      const profile = profileById.get(employeeId);
      if (!profile) {
        return [];
      }
      return [
        {
          employeeId,
          fullName: profile.full_name,
          department: profile.department,
          countryCode: profile.country_code,
          totalAmount: value.totalAmount,
          expenseCount: value.expenseCount
        }
      ];
    })
    .sort(
      (left, right) =>
        right.totalAmount - left.totalAmount || left.fullName.localeCompare(right.fullName)
    )
    .slice(0, TOP_SPENDER_LIMIT);

  return {
    primaryCurrency,
    excludedCurrencies,
    metrics: {
      totalAmount,
      approvedAmount,
      pendingAmount,
      reimbursedAmount,
      expenseCount: primaryRows.length
    },
    byCategory,
    trend,
    topSpenders
  };
}
