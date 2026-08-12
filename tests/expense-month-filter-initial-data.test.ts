import { describe, expect, it } from "vitest";

import { resolveInitialExpensesData } from "../hooks/use-expenses";
import type { ExpensesListResponseData, ExpensesSummary } from "../types/expenses";

const emptySummary: ExpensesSummary = {
  totalCount: 0,
  totalAmountByCurrency: {},
  pendingCount: 0,
  pendingAmountByCurrency: {},
  approvedCount: 0,
  managerApprovedCount: 0,
  reimbursedCount: 0,
  reimbursedAmountByCurrency: {},
  rejectedCount: 0,
  financeRejectedCount: 0,
  cancelledCount: 0
};

function listData(month: string | null): ExpensesListResponseData {
  return { expenses: [], summary: emptySummary, month };
}

/**
 * Regression: the expenses page server-renders the CURRENT month's data and
 * passes it as initialData. Seeding it into every month's query key marked the
 * seeded entry fresh, so clicking a previous month never fetched — the user
 * saw the current month's rows (or an empty list) for whichever month they
 * picked. initialData must only seed the slice it was fetched for.
 */
describe("resolveInitialExpensesData", () => {
  it("seeds the cache when the requested month matches the snapshot month", () => {
    const initialData = listData("2026-08");

    expect(resolveInitialExpensesData({ month: "2026-08", initialData })).toBe(initialData);
  });

  it("does NOT seed a different month's query (the reported bug)", () => {
    const initialData = listData("2026-08");

    expect(resolveInitialExpensesData({ month: "2026-07", initialData })).toBeUndefined();
  });

  it("does NOT seed when a status filter is applied", () => {
    const initialData = listData("2026-08");

    expect(
      resolveInitialExpensesData({ month: "2026-08", status: "pending", initialData })
    ).toBeUndefined();
  });

  it("does NOT seed an all-months query with a month-scoped snapshot", () => {
    const initialData = listData("2026-08");

    expect(resolveInitialExpensesData({ initialData })).toBeUndefined();
    expect(resolveInitialExpensesData({ month: "", initialData })).toBeUndefined();
  });

  it("seeds an all-months query with an all-months snapshot", () => {
    const initialData = listData(null);

    expect(resolveInitialExpensesData({ initialData })).toBe(initialData);
    expect(resolveInitialExpensesData({ month: "", initialData })).toBe(initialData);
  });

  it("returns undefined when there is no snapshot", () => {
    expect(resolveInitialExpensesData({ month: "2026-08" })).toBeUndefined();
  });
});
