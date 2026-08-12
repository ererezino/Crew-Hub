import { describe, expect, it } from "vitest";

import {
  addCurrencyAmount,
  partitionByPrimaryCurrency,
  summarizeExpenses
} from "../lib/expenses";
import type { ExpenseRecord, ExpenseStatus } from "../types/expenses";

/**
 * summarizeExpenses only reads amount/currency/status; the rest of the record
 * is irrelevant to aggregation, so tests build minimal rows.
 */
function expense(amount: number, currency: string, status: ExpenseStatus): ExpenseRecord {
  return { amount, currency, status } as ExpenseRecord;
}

describe("summarizeExpenses (per-currency amounts)", () => {
  it("keeps currencies separate instead of summing minor units across them", () => {
    const summary = summarizeExpenses([
      expense(15_000_000, "NGN", "pending"), // ₦150,000.00
      expense(4_000, "USD", "pending"), // $40.00
      expense(2_500, "USD", "reimbursed"),
      expense(500_000, "NGN", "manager_approved")
    ]);

    expect(summary.totalCount).toBe(4);
    expect(summary.totalAmountByCurrency).toEqual({ NGN: 15_500_000, USD: 6_500 });
    // pending bucket = pending + manager_approved (+ additional_approved)
    expect(summary.pendingAmountByCurrency).toEqual({ NGN: 15_500_000, USD: 4_000 });
    expect(summary.reimbursedAmountByCurrency).toEqual({ USD: 2_500 });
    expect(summary.pendingCount).toBe(2);
    expect(summary.managerApprovedCount).toBe(1);
    expect(summary.reimbursedCount).toBe(1);
  });

  it("returns empty records (not zeros in a guessed currency) when there are no expenses", () => {
    const summary = summarizeExpenses([]);

    expect(summary.totalAmountByCurrency).toEqual({});
    expect(summary.pendingAmountByCurrency).toEqual({});
    expect(summary.reimbursedAmountByCurrency).toEqual({});
  });

  it("buckets a missing/empty currency under USD rather than dropping the amount", () => {
    const summary = summarizeExpenses([expense(1_000, "", "pending")]);

    expect(summary.totalAmountByCurrency).toEqual({ USD: 1_000 });
  });
});

describe("addCurrencyAmount", () => {
  it("accumulates per currency code", () => {
    const amounts: Record<string, number> = {};
    addCurrencyAmount(amounts, "KES", 100);
    addCurrencyAmount(amounts, "KES", 250);
    addCurrencyAmount(amounts, "GHS", 75);

    expect(amounts).toEqual({ KES: 350, GHS: 75 });
  });
});

describe("partitionByPrimaryCurrency", () => {
  it("picks the currency with the most rows and lists the excluded ones", () => {
    const rows = [
      { currency: "NGN" },
      { currency: "NGN" },
      { currency: "NGN" },
      { currency: "USD" },
      { currency: "USD" },
      { currency: "KES" }
    ];

    const result = partitionByPrimaryCurrency(rows);

    expect(result.primaryCurrency).toBe("NGN");
    expect(result.primaryRows).toHaveLength(3);
    expect(result.primaryRows.every((row) => row.currency === "NGN")).toBe(true);
    expect(result.excludedCurrencies).toEqual([
      { currency: "USD", count: 2 },
      { currency: "KES", count: 1 }
    ]);
  });

  it("single-currency population excludes nothing", () => {
    const result = partitionByPrimaryCurrency([{ currency: "USD" }, { currency: "USD" }]);

    expect(result.primaryCurrency).toBe("USD");
    expect(result.primaryRows).toHaveLength(2);
    expect(result.excludedCurrencies).toEqual([]);
  });

  it("empty population defaults to USD with nothing excluded", () => {
    const result = partitionByPrimaryCurrency([]);

    expect(result.primaryCurrency).toBe("USD");
    expect(result.primaryRows).toEqual([]);
    expect(result.excludedCurrencies).toEqual([]);
  });

  it("treats an empty currency code as USD", () => {
    const result = partitionByPrimaryCurrency([
      { currency: "" },
      { currency: "" },
      { currency: "NGN" }
    ]);

    expect(result.primaryCurrency).toBe("USD");
    expect(result.primaryRows).toHaveLength(2);
    expect(result.excludedCurrencies).toEqual([{ currency: "NGN", count: 1 }]);
  });
});
