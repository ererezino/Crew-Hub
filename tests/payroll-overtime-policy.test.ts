import { describe, expect, it } from "vitest";

import {
  aggregateApprovedMonthlyOvertimeByEmployee,
  calculateOvertimeCompensation,
  calculateOvertimeHourlyRate,
  canApproveMonthlyOvertime,
  getPreviousMonthWindow,
  summarizeMonthlyOvertime
} from "../lib/payroll/overtime";

describe("payroll overtime policy helpers", () => {
  it("derives the previous calendar month from the run period", () => {
    expect(getPreviousMonthWindow("2026-03-01")).toEqual({
      sourceMonth: "2026-02",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28"
    });

    expect(getPreviousMonthWindow("2026-01-01")).toEqual({
      sourceMonth: "2025-12",
      periodStart: "2025-12-01",
      periodEnd: "2025-12-31"
    });
  });

  it("only allows monthly overtime approval while the run is editable", () => {
    expect(canApproveMonthlyOvertime("draft")).toBe(true);
    expect(canApproveMonthlyOvertime("calculated")).toBe(true);
    expect(canApproveMonthlyOvertime("rejected")).toBe(true);
    expect(canApproveMonthlyOvertime("submitted")).toBe(false);
    expect(canApproveMonthlyOvertime("approved")).toBe(false);
    expect(canApproveMonthlyOvertime("processing")).toBe(false);
    expect(canApproveMonthlyOvertime("completed")).toBe(false);
    expect(canApproveMonthlyOvertime("cancelled")).toBe(false);
  });

  it("calculates overtime from monthly compensation divided by 160 hours", () => {
    expect(calculateOvertimeHourlyRate(50000)).toBe(312.5);
    expect(
      calculateOvertimeCompensation({
        monthlyCompensationAmount: 50000,
        overtimeHours: 16
      })
    ).toBe(5000);
    expect(
      calculateOvertimeCompensation({
        monthlyCompensationAmount: 75000,
        overtimeHours: 16
      })
    ).toBe(7500);
  });

  it("summarizes pending and approved previous-month overtime for the current run", () => {
    const summary = summarizeMonthlyOvertime({
      entries: [
        {
          id: "entry-1",
          employeeId: "employee-1",
          hours: 4,
          amount: 24000,
          currency: "NGN",
          status: "pending",
          payrollItemId: null
        },
        {
          id: "entry-2",
          employeeId: "employee-1",
          hours: 3,
          amount: 18000,
          currency: "NGN",
          status: "approved",
          payrollItemId: null
        },
        {
          id: "entry-3",
          employeeId: "employee-2",
          hours: 2,
          amount: 12000,
          currency: "NGN",
          status: "approved",
          payrollItemId: "item-linked-current-run"
        },
        {
          id: "entry-4",
          employeeId: "employee-3",
          hours: 2,
          amount: 100,
          currency: "USD",
          status: "approved",
          payrollItemId: "item-linked-other-run"
        },
        {
          id: "entry-5",
          employeeId: "employee-4",
          hours: 1,
          amount: 5000,
          currency: "NGN",
          status: "rejected",
          payrollItemId: null
        }
      ],
      currentRunId: "current-run",
      linkedRunIdByPayrollItemId: new Map([
        ["item-linked-current-run", "current-run"],
        ["item-linked-other-run", "other-run"]
      ]),
      sourceMonth: "2026-02",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28"
    });

    expect(summary).toEqual({
      sourceMonth: "2026-02",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      employeeCount: 4,
      pendingCount: 1,
      approvedCount: 2,
      rejectedCount: 1,
      linkedApprovedCount: 1,
      pendingHours: 4,
      approvedHours: 5,
      pendingTotals: { NGN: 24000 },
      approvedTotals: { NGN: 30000 },
      hasPendingEntries: true,
      hasApprovedEntries: true
    });
  });

  it("aggregates only approved overtime available to the current run", () => {
    const aggregates = aggregateApprovedMonthlyOvertimeByEmployee({
      entries: [
        {
          id: "entry-1",
          employeeId: "employee-1",
          hours: 3,
          amount: 18000,
          currency: "NGN",
          status: "approved",
          payrollItemId: null
        },
        {
          id: "entry-2",
          employeeId: "employee-1",
          hours: 2,
          amount: 12000,
          currency: "NGN",
          status: "approved",
          payrollItemId: "item-current-run"
        },
        {
          id: "entry-3",
          employeeId: "employee-1",
          hours: 1,
          amount: 5000,
          currency: "USD",
          status: "approved",
          payrollItemId: null
        },
        {
          id: "entry-4",
          employeeId: "employee-2",
          hours: 4,
          amount: 20000,
          currency: "NGN",
          status: "approved",
          payrollItemId: "item-other-run"
        }
      ],
      currentRunId: "current-run",
      linkedRunIdByPayrollItemId: new Map([
        ["item-current-run", "current-run"],
        ["item-other-run", "other-run"]
      ])
    });

    expect(aggregates.get("employee-1")).toEqual({
      employeeId: "employee-1",
      hours: 6,
      amount: 35000,
      currency: "NGN",
      entryIds: ["entry-1", "entry-2", "entry-3"],
      hasCurrencyMismatch: true
    });
    expect(aggregates.has("employee-2")).toBe(false);
  });
});
