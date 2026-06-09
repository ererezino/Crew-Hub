import { describe, expect, it } from "vitest";

import {
  calculatePayrollRunCurrencyTotals,
  calculatePayrollWorksheetMonthlyTotal
} from "../lib/payroll/runs";

describe("payroll run totals", () => {
  it("includes fees in the worksheet monthly total after a refresh", () => {
    expect(
      calculatePayrollWorksheetMonthlyTotal({
        cycle1BaseAmount: 25000,
        cycle2BaseAmount: 25000,
        cycle1OvertimeAmount: 5000,
        cycle2OvertimeAmount: 0,
        bonus: 2000,
        fees: 1000
      })
    ).toBe(58000);
  });

  it("rebuilds gross, net, and deduction totals by pay currency", () => {
    expect(
      calculatePayrollRunCurrencyTotals([
        { grossAmount: 58000, netAmount: 58000, payCurrency: "USD" },
        { grossAmount: 100000, netAmount: 90000, payCurrency: "NGN" }
      ])
    ).toEqual({
      totalGross: { USD: 58000, NGN: 100000 },
      totalNet: { USD: 58000, NGN: 90000 },
      totalDeductions: { USD: 0, NGN: 10000 }
    });
  });
});
