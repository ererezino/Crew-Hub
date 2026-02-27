import assert from "node:assert/strict";

import {
  calculateNigeriaPayrollBreakdown,
  type NigeriaRuleConfig
} from "../../lib/payroll/engines/nigeria-calculation";

const NIGERIA_RULE_CONFIG: NigeriaRuleConfig = {
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
};

function assertWithinOneKobo(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `${label}: expected ${expected}, received ${actual}`
  );
}

function runCase({
  label,
  monthlyGross,
  expectedAnnualGross,
  expectedCraTotal,
  expectedAnnualPension,
  expectedTaxableIncome,
  expectedAnnualPaye,
  expectedMonthlyPaye
}: {
  label: string;
  monthlyGross: number;
  expectedAnnualGross: number;
  expectedCraTotal: number;
  expectedAnnualPension: number;
  expectedTaxableIncome: number;
  expectedAnnualPaye: number;
  expectedMonthlyPaye: number;
}): void {
  const breakdown = calculateNigeriaPayrollBreakdown(
    {
      monthly_gross_amount: monthlyGross,
      monthly_base_salary_amount: monthlyGross
    },
    NIGERIA_RULE_CONFIG
  );

  assert.equal(breakdown.annualGrossAmount, expectedAnnualGross, `${label}: annual gross`);
  assert.equal(breakdown.craTotalAmount, expectedCraTotal, `${label}: CRA total`);
  assert.equal(breakdown.annualPensionAmount, expectedAnnualPension, `${label}: annual pension`);
  assert.equal(breakdown.taxableIncomeAmount, expectedTaxableIncome, `${label}: taxable income`);
  assertWithinOneKobo(breakdown.annualPayeAmount, expectedAnnualPaye, `${label}: annual PAYE`);
  assertWithinOneKobo(
    breakdown.monthlyPayeAmount,
    expectedMonthlyPaye,
    `${label}: monthly PAYE`
  );
}

runCase({
  label: "Test 1 (NGN 150,000 monthly gross)",
  monthlyGross: 15_000_000,
  expectedAnnualGross: 180_000_000,
  expectedCraTotal: 56_000_000,
  expectedAnnualPension: 14_400_000,
  expectedTaxableIncome: 109_600_000,
  expectedAnnualPaye: 12_840_000,
  expectedMonthlyPaye: 1_070_000
});

runCase({
  label: "Test 2 (NGN 500,000 monthly gross)",
  monthlyGross: 50_000_000,
  expectedAnnualGross: 600_000_000,
  expectedCraTotal: 140_000_000,
  expectedAnnualPension: 48_000_000,
  expectedTaxableIncome: 412_000_000,
  expectedAnnualPaye: 78_080_000,
  expectedMonthlyPaye: 6_506_667
});

const highIncomeBreakdown = calculateNigeriaPayrollBreakdown(
  {
    monthly_gross_amount: 200_000_000,
    monthly_base_salary_amount: 200_000_000
  },
  NIGERIA_RULE_CONFIG
);
const topBracket = highIncomeBreakdown.payeByBracket.find((row) => row.rate === 0.24);

assert.ok(topBracket && topBracket.taxableAmount > 0, "Test 3 should hit the 24% PAYE bracket.");

console.log("Nigeria engine verification passed (tests 1-3).");
