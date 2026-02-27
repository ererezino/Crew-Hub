import { beforeAll, describe, expect, it, vi } from "vitest";

import { calculateNigeriaPayrollBreakdown } from "../lib/payroll/engines/nigeria-calculation";

vi.mock("../lib/payroll/engines", () => ({
  getCountryEngine: () => null
}));

let calculatePayrollItem: typeof import("../lib/payroll/calculate-payroll-item").calculatePayrollItem;

const nigeriaRuleConfig = {
  payeBrackets: [
    {
      ruleName: "PAYE 0 - 300,000 NGN",
      bracketMin: 0,
      bracketMax: 30_000_000,
      rate: 0.07,
      calculationOrder: 0
    },
    {
      ruleName: "PAYE 300,000 - 600,000 NGN",
      bracketMin: 30_000_000,
      bracketMax: 60_000_000,
      rate: 0.11,
      calculationOrder: 1
    },
    {
      ruleName: "PAYE 600,000 - 1,100,000 NGN",
      bracketMin: 60_000_000,
      bracketMax: 110_000_000,
      rate: 0.15,
      calculationOrder: 2
    },
    {
      ruleName: "PAYE 1,100,000 - 1,600,000 NGN",
      bracketMin: 110_000_000,
      bracketMax: 160_000_000,
      rate: 0.19,
      calculationOrder: 3
    },
    {
      ruleName: "PAYE 1,600,000 - 3,200,000 NGN",
      bracketMin: 160_000_000,
      bracketMax: 320_000_000,
      rate: 0.21,
      calculationOrder: 4
    },
    {
      ruleName: "PAYE Above 3,200,000 NGN",
      bracketMin: 320_000_000,
      bracketMax: null,
      rate: 0.24,
      calculationOrder: 5
    }
  ],
  craFixedAmount: 20_000_000,
  craPercentRate: 0.01,
  craAdditionalRate: 0.2,
  pensionEmployeeRate: 0.08,
  pensionEmployerRate: 0.1,
  nhfRate: 0.025,
  nsitfEmployeeRate: 0.01,
  nsitfEmployerRate: 0.01
} as const;

describe("Payroll calculations", () => {
  beforeAll(async () => {
    ({ calculatePayrollItem } = await import("../lib/payroll/calculate-payroll-item"));
  });

  it("returns net = gross for contractor mode with no deductions", async () => {
    const result = await calculatePayrollItem({
      employee: {
        id: "0b1f7ea1-f777-4dc3-b1f7-3cba6ab6664e",
        org_id: "6d03d3f3-a3dc-4cd9-b715-82a26d8d4e38",
        payroll_mode: "contractor_usd_no_withholding",
        country_code: "NG"
      },
      monthly_gross_amount: 500_000_00,
      monthly_base_salary_amount: 500_000_00,
      currency: "USD",
      allowances: []
    });

    expect(result.gross_amount).toBe(500_000_00);
    expect(result.net_amount).toBe(500_000_00);
    expect(result.total_deductions).toBe(0);
    expect(result.deductions).toHaveLength(0);
    expect(result.withholding_applied).toBe(false);
  });

  it("matches NGN 150,000 source-of-truth PAYE calculation", () => {
    const breakdown = calculateNigeriaPayrollBreakdown(
      {
        monthly_gross_amount: 15_000_000,
        monthly_base_salary_amount: 15_000_000
      },
      nigeriaRuleConfig
    );

    expect(breakdown.annualGrossAmount).toBe(180_000_000);
    expect(breakdown.craTotalAmount).toBe(56_000_000);
    expect(breakdown.annualPensionAmount).toBe(14_400_000);
    expect(breakdown.taxableIncomeAmount).toBe(109_600_000);
    expect(Math.abs(breakdown.monthlyPayeAmount - 1_070_000)).toBeLessThanOrEqual(1);
  });

  it("matches NGN 500,000 source-of-truth PAYE calculation", () => {
    const breakdown = calculateNigeriaPayrollBreakdown(
      {
        monthly_gross_amount: 50_000_000,
        monthly_base_salary_amount: 50_000_000
      },
      nigeriaRuleConfig
    );

    expect(breakdown.annualGrossAmount).toBe(600_000_000);
    expect(breakdown.craTotalAmount).toBe(140_000_000);
    expect(breakdown.annualPensionAmount).toBe(48_000_000);
    expect(breakdown.taxableIncomeAmount).toBe(412_000_000);
    expect(Math.abs(breakdown.monthlyPayeAmount - 6_506_667)).toBeLessThanOrEqual(1);
  });

  it("hits the 24% top PAYE bracket at NGN 2,000,000 monthly gross", () => {
    const breakdown = calculateNigeriaPayrollBreakdown(
      {
        monthly_gross_amount: 200_000_000,
        monthly_base_salary_amount: 200_000_000
      },
      nigeriaRuleConfig
    );

    const topBracket = breakdown.payeByBracket.find((bracket) => bracket.rate === 0.24);

    expect(topBracket).toBeDefined();
    expect(topBracket?.taxableAmount ?? 0).toBeGreaterThan(0);
  });
});
