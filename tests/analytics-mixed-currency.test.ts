import { describe, expect, it } from "vitest";

import {
  buildExpensesAnalytics,
  monthSeries,
  type AnalyticsExpenseProfile,
  type AnalyticsExpenseSourceRow
} from "../lib/analytics/expenses-section";

function row(
  amount: number,
  currency: string,
  status: string,
  expenseDate: string,
  employeeId = "e-1",
  category = "meals"
): AnalyticsExpenseSourceRow {
  return { amount, currency, status, category, expense_date: expenseDate, employee_id: employeeId };
}

function profile(id: string, name: string): [string, AnalyticsExpenseProfile] {
  return [id, { id, full_name: name, department: "Engineering", country_code: "NG" }];
}

const RANGE = { startDate: "2026-06-01", endDate: "2026-08-31" };

describe("buildExpensesAnalytics (dominant-currency aggregation)", () => {
  it("aggregates only the dominant currency and reports the excluded rows", () => {
    const rows = [
      row(15_000_000, "NGN", "pending", "2026-07-10", "e-1"),
      row(500_000, "NGN", "reimbursed", "2026-07-20", "e-2"),
      row(200_000, "NGN", "approved", "2026-08-05", "e-1"),
      row(4_000, "USD", "pending", "2026-07-11", "e-3"),
      row(2_500, "KES", "reimbursed", "2026-08-01", "e-3")
    ];
    const result = buildExpensesAnalytics({
      rows,
      profileById: new Map([profile("e-1", "Amina"), profile("e-2", "Brian"), profile("e-3", "Chidi")]),
      ...RANGE
    });

    expect(result.primaryCurrency).toBe("NGN");
    expect(result.excludedCurrencies).toEqual([
      { currency: "USD", count: 1 },
      { currency: "KES", count: 1 }
    ]);
    expect(result.metrics.totalAmount).toBe(15_700_000); // NGN only — never NGN+USD
    expect(result.metrics.pendingAmount).toBe(15_000_000);
    expect(result.metrics.reimbursedAmount).toBe(500_000);
    expect(result.metrics.approvedAmount).toBe(700_000); // approved + reimbursed
    expect(result.metrics.expenseCount).toBe(3);
  });

  it("zero-fills the month trend across the whole range (RPC generate_series parity)", () => {
    const result = buildExpensesAnalytics({
      rows: [row(1_000, "USD", "pending", "2026-07-15")],
      profileById: new Map([profile("e-1", "Amina")]),
      ...RANGE
    });

    expect(result.trend.map((entry) => entry.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(result.trend[0]).toEqual({ month: "2026-06", totalAmount: 0, expenseCount: 0 });
    expect(result.trend[1]).toEqual({ month: "2026-07", totalAmount: 1_000, expenseCount: 1 });
  });

  it("ranks top spenders by primary-currency amount, drops profileless rows, caps at 8", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, index) =>
        row(1_000 * (index + 1), "USD", "pending", "2026-07-10", `e-${index}`)
      ),
      row(99_999, "USD", "pending", "2026-07-10", "e-ghost") // no profile → excluded
    ];
    const profileById = new Map(
      Array.from({ length: 10 }, (_, index) => profile(`e-${index}`, `Person ${index}`))
    );

    const result = buildExpensesAnalytics({ rows, profileById, ...RANGE });

    expect(result.topSpenders).toHaveLength(8);
    expect(result.topSpenders[0]).toMatchObject({ employeeId: "e-9", totalAmount: 10_000 });
    expect(result.topSpenders.some((entry) => entry.employeeId === "e-ghost")).toBe(false);
  });

  it("categories sort by amount descending with a stable key tiebreak", () => {
    const rows = [
      row(500, "USD", "pending", "2026-07-01", "e-1", "travel"),
      row(500, "USD", "pending", "2026-07-02", "e-1", "meals"),
      row(900, "USD", "pending", "2026-07-03", "e-1", "software")
    ];
    const result = buildExpensesAnalytics({
      rows,
      profileById: new Map([profile("e-1", "Amina")]),
      ...RANGE
    });

    expect(result.byCategory.map((entry) => entry.key)).toEqual(["software", "meals", "travel"]);
  });

  it("empty input keeps the section renderable: USD default, zero-filled trend, nothing excluded", () => {
    const result = buildExpensesAnalytics({ rows: [], profileById: new Map(), ...RANGE });

    expect(result.primaryCurrency).toBe("USD");
    expect(result.excludedCurrencies).toEqual([]);
    expect(result.metrics.totalAmount).toBe(0);
    expect(result.metrics.expenseCount).toBe(0);
    expect(result.trend).toHaveLength(3);
    expect(result.topSpenders).toEqual([]);
  });
});

describe("monthSeries", () => {
  it("spans partial months inclusively", () => {
    expect(monthSeries("2026-11-15", "2027-02-03")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02"
    ]);
  });

  it("returns empty for an inverted or unparseable range", () => {
    expect(monthSeries("2026-09-01", "2026-08-01")).toEqual([]);
    expect(monthSeries("garbage", "2026-08-01")).toEqual([]);
  });
});
