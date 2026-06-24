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
        { grossAmount: 58000, netAmount: 58000, deductionsAmount: 0, payCurrency: "USD" },
        { grossAmount: 100000, netAmount: 90000, deductionsAmount: 10000, payCurrency: "NGN" }
      ])
    ).toEqual({
      totalGross: { USD: 58000, NGN: 100000 },
      totalNet: { USD: 58000, NGN: 90000 },
      totalDeductions: { USD: 0, NGN: 10000 }
    });
  });

  // PAYROLL-01: the heart of the bug. net = gross - deductions + adjustment, so
  // gross - net under-reports (positive adjustment) or over-reports (negative
  // adjustment) deductions. totalDeductions must equal the ACTUAL deduction rows.
  it("reports actual deductions, not gross-net, when a POSITIVE adjustment is present", () => {
    // gross 100000, deductions 10000, +5000 bonus adjustment → net 95000.
    // gross - net = 5000, but real deductions are 10000.
    const totals = calculatePayrollRunCurrencyTotals([
      { grossAmount: 100000, netAmount: 95000, deductionsAmount: 10000, payCurrency: "NGN" }
    ]);
    expect(totals.totalDeductions).toEqual({ NGN: 10000 });
    expect(totals.totalDeductions.NGN).not.toBe(100000 - 95000); // not gross-net
  });

  it("reports actual deductions, not gross-net, when a NEGATIVE adjustment is present", () => {
    // gross 100000, deductions 10000, -3000 clawback adjustment → net 87000.
    // gross - net = 13000, but real deductions are 10000.
    const totals = calculatePayrollRunCurrencyTotals([
      { grossAmount: 100000, netAmount: 87000, deductionsAmount: 10000, payCurrency: "NGN" }
    ]);
    expect(totals.totalDeductions).toEqual({ NGN: 10000 });
    expect(totals.totalDeductions.NGN).not.toBe(100000 - 87000);
  });

  it("accumulates multiple rows per currency and keeps currencies separate", () => {
    const totals = calculatePayrollRunCurrencyTotals([
      { grossAmount: 100000, netAmount: 95000, deductionsAmount: 10000, payCurrency: "NGN" },
      { grossAmount: 50000, netAmount: 48000, deductionsAmount: 4000, payCurrency: "NGN" },
      { grossAmount: 60000, netAmount: 54000, deductionsAmount: 6000, payCurrency: "USD" }
    ]);
    expect(totals.totalDeductions).toEqual({ NGN: 14000, USD: 6000 });
    expect(totals.totalGross).toEqual({ NGN: 150000, USD: 60000 });
  });

  it("no adjustment: deductions still equal gross-net (regression of the simple case)", () => {
    const totals = calculatePayrollRunCurrencyTotals([
      { grossAmount: 100000, netAmount: 90000, deductionsAmount: 10000, payCurrency: "NGN" }
    ]);
    expect(totals.totalDeductions.NGN).toBe(100000 - 90000);
  });
});
