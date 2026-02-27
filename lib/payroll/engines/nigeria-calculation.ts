import type { CalculatePayrollItemParams, PayrollCalculationResult } from "../../../types/payroll";

export type NigeriaPayeBracketRule = {
  ruleName: string;
  bracketMin: number;
  bracketMax: number | null;
  rate: number;
  calculationOrder: number;
};

export type NigeriaRuleConfig = {
  payeBrackets: NigeriaPayeBracketRule[];
  craFixedAmount: number;
  craPercentRate: number;
  craAdditionalRate: number;
  pensionEmployeeRate: number;
  pensionEmployerRate: number;
  nhfRate: number;
  nsitfEmployeeRate: number;
  nsitfEmployerRate: number;
};

export type NigeriaPayeBracketBreakdown = {
  ruleName: string;
  bracketMin: number;
  bracketMax: number | null;
  taxableAmount: number;
  rate: number;
  annualAmount: number;
  monthlyAmount: number;
};

export type NigeriaPayrollBreakdown = {
  annualGrossAmount: number;
  craFixedOrPercentAmount: number;
  craTwentyPercentAmount: number;
  craTotalAmount: number;
  annualPensionAmount: number;
  taxableIncomeAmount: number;
  annualPayeAmount: number;
  monthlyPayeAmount: number;
  monthlyPensionAmount: number;
  monthlyNhfAmount: number;
  monthlyNsitfAmount: number;
  monthlyEmployerPensionAmount: number;
  monthlyEmployerNsitfAmount: number;
  grossAmount: number;
  totalDeductions: number;
  totalEmployerContributions: number;
  netAmount: number;
  payeByBracket: NigeriaPayeBracketBreakdown[];
};

function roundToKobo(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value);
}

function multiplyRate(amount: number, rate: number): number {
  return roundToKobo(amount * rate);
}

function monthlyFromAnnual(annualAmount: number): number {
  return roundToKobo(annualAmount / 12);
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

export function validateNigeriaRuleConfig(config: NigeriaRuleConfig): string | null {
  if (config.payeBrackets.length === 0) {
    return "Nigeria PAYE brackets are missing.";
  }

  const sortedBrackets = [...config.payeBrackets].sort((left, right) => {
    if (left.calculationOrder !== right.calculationOrder) {
      return left.calculationOrder - right.calculationOrder;
    }

    return left.bracketMin - right.bracketMin;
  });

  for (let index = 0; index < sortedBrackets.length; index += 1) {
    const bracket = sortedBrackets[index];

    if (!Number.isFinite(bracket.rate) || bracket.rate < 0 || bracket.rate > 1) {
      return `Invalid PAYE rate for ${bracket.ruleName}.`;
    }

    if (!Number.isFinite(bracket.bracketMin) || bracket.bracketMin < 0) {
      return `Invalid PAYE minimum bracket value for ${bracket.ruleName}.`;
    }

    if (
      bracket.bracketMax !== null &&
      (!Number.isFinite(bracket.bracketMax) || bracket.bracketMax < bracket.bracketMin)
    ) {
      return `Invalid PAYE maximum bracket value for ${bracket.ruleName}.`;
    }

    const nextBracket = sortedBrackets[index + 1];

    if (!nextBracket) {
      continue;
    }

    if (bracket.bracketMax !== null && nextBracket.bracketMin < bracket.bracketMax) {
      return "PAYE brackets overlap.";
    }
  }

  const rateFields: Array<{ label: string; value: number }> = [
    { label: "CRA 1%", value: config.craPercentRate },
    { label: "CRA 20%", value: config.craAdditionalRate },
    { label: "Pension employee rate", value: config.pensionEmployeeRate },
    { label: "Pension employer rate", value: config.pensionEmployerRate },
    { label: "NHF rate", value: config.nhfRate },
    { label: "NSITF employee rate", value: config.nsitfEmployeeRate },
    { label: "NSITF employer rate", value: config.nsitfEmployerRate }
  ];

  for (const field of rateFields) {
    if (!Number.isFinite(field.value) || field.value < 0 || field.value > 1) {
      return `${field.label} is invalid.`;
    }
  }

  if (!Number.isFinite(config.craFixedAmount) || config.craFixedAmount < 0) {
    return "CRA fixed amount is invalid.";
  }

  return null;
}

function calculateAnnualPaye(
  taxableIncomeAmount: number,
  payeBrackets: readonly NigeriaPayeBracketRule[]
): {
  annualPayeAmount: number;
  payeByBracket: NigeriaPayeBracketBreakdown[];
} {
  let annualPayeAmount = 0;
  const payeByBracket: NigeriaPayeBracketBreakdown[] = [];

  for (const bracket of payeBrackets) {
    if (taxableIncomeAmount <= bracket.bracketMin) {
      payeByBracket.push({
        ruleName: bracket.ruleName,
        bracketMin: bracket.bracketMin,
        bracketMax: bracket.bracketMax,
        taxableAmount: 0,
        rate: bracket.rate,
        annualAmount: 0,
        monthlyAmount: 0
      });
      continue;
    }

    const bracketUpperBound = bracket.bracketMax ?? taxableIncomeAmount;
    const taxableAmount = Math.max(
      0,
      Math.min(taxableIncomeAmount, bracketUpperBound) - bracket.bracketMin
    );
    const annualAmount = multiplyRate(taxableAmount, bracket.rate);

    annualPayeAmount += annualAmount;

    payeByBracket.push({
      ruleName: bracket.ruleName,
      bracketMin: bracket.bracketMin,
      bracketMax: bracket.bracketMax,
      taxableAmount,
      rate: bracket.rate,
      annualAmount,
      monthlyAmount: monthlyFromAnnual(annualAmount)
    });
  }

  return {
    annualPayeAmount,
    payeByBracket
  };
}

export function calculateNigeriaPayrollBreakdown(
  params: Pick<
    CalculatePayrollItemParams,
    "monthly_gross_amount" | "monthly_base_salary_amount"
  >,
  config: NigeriaRuleConfig
): NigeriaPayrollBreakdown {
  const configError = validateNigeriaRuleConfig(config);

  if (configError) {
    throw new Error(configError);
  }

  const monthlyGrossAmount = normalizeAmount(params.monthly_gross_amount);
  const monthlyBaseSalaryAmount = normalizeAmount(params.monthly_base_salary_amount);
  const annualGrossAmount = monthlyGrossAmount * 12;

  const craOnePercentAmount = multiplyRate(annualGrossAmount, config.craPercentRate);
  const craFixedOrPercentAmount = Math.max(config.craFixedAmount, craOnePercentAmount);
  const craTwentyPercentAmount = multiplyRate(annualGrossAmount, config.craAdditionalRate);
  const craTotalAmount = craFixedOrPercentAmount + craTwentyPercentAmount;
  const annualPensionAmount = multiplyRate(annualGrossAmount, config.pensionEmployeeRate);
  const taxableIncomeAmount = Math.max(0, annualGrossAmount - craTotalAmount - annualPensionAmount);

  const sortedBrackets = [...config.payeBrackets].sort((left, right) => {
    if (left.calculationOrder !== right.calculationOrder) {
      return left.calculationOrder - right.calculationOrder;
    }

    return left.bracketMin - right.bracketMin;
  });

  const payeResult = calculateAnnualPaye(taxableIncomeAmount, sortedBrackets);
  const monthlyPayeAmount = monthlyFromAnnual(payeResult.annualPayeAmount);
  const monthlyPensionAmount = monthlyFromAnnual(annualPensionAmount);
  const monthlyNhfAmount = multiplyRate(monthlyBaseSalaryAmount, config.nhfRate);
  const monthlyNsitfAmount = multiplyRate(monthlyGrossAmount, config.nsitfEmployeeRate);

  const annualEmployerPensionAmount = multiplyRate(
    annualGrossAmount,
    config.pensionEmployerRate
  );
  const monthlyEmployerPensionAmount = monthlyFromAnnual(annualEmployerPensionAmount);
  const monthlyEmployerNsitfAmount = multiplyRate(monthlyGrossAmount, config.nsitfEmployerRate);

  const totalDeductions =
    monthlyPayeAmount + monthlyPensionAmount + monthlyNhfAmount + monthlyNsitfAmount;
  const totalEmployerContributions =
    monthlyEmployerPensionAmount + monthlyEmployerNsitfAmount;
  const netAmount = monthlyGrossAmount - totalDeductions;

  return {
    annualGrossAmount,
    craFixedOrPercentAmount,
    craTwentyPercentAmount,
    craTotalAmount,
    annualPensionAmount,
    taxableIncomeAmount,
    annualPayeAmount: payeResult.annualPayeAmount,
    monthlyPayeAmount,
    monthlyPensionAmount,
    monthlyNhfAmount,
    monthlyNsitfAmount,
    monthlyEmployerPensionAmount,
    monthlyEmployerNsitfAmount,
    grossAmount: monthlyGrossAmount,
    totalDeductions,
    totalEmployerContributions,
    netAmount,
    payeByBracket: payeResult.payeByBracket
  };
}

function percentLabel(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

export function toNigeriaPayrollCalculationResult(
  breakdown: NigeriaPayrollBreakdown,
  config: NigeriaRuleConfig
): PayrollCalculationResult {
  return {
    gross_amount: breakdown.grossAmount,
    deductions: [
      {
        rule_type: "income_tax",
        rule_name: "PAYE (Income Tax)",
        amount: breakdown.monthlyPayeAmount,
        description: "Annual PAYE calculated on annual taxable income and converted to monthly."
      },
      {
        rule_type: "pension_employee",
        rule_name: "Pension (Employee)",
        amount: breakdown.monthlyPensionAmount,
        description: `${percentLabel(config.pensionEmployeeRate)} of annual gross, paid monthly.`
      },
      {
        rule_type: "housing_fund",
        rule_name: "NHF",
        amount: breakdown.monthlyNhfAmount,
        description: `${percentLabel(config.nhfRate)} of monthly basic salary.`
      },
      {
        rule_type: "social_insurance",
        rule_name: "NSITF (Employee)",
        amount: breakdown.monthlyNsitfAmount,
        description: `${percentLabel(config.nsitfEmployeeRate)} of monthly gross salary.`
      }
    ],
    employer_contributions: [
      {
        rule_type: "pension_employer",
        rule_name: "Pension (Employer)",
        amount: breakdown.monthlyEmployerPensionAmount,
        description: `${percentLabel(config.pensionEmployerRate)} of annual gross, paid monthly.`
      },
      {
        rule_type: "social_insurance",
        rule_name: "NSITF (Employer)",
        amount: breakdown.monthlyEmployerNsitfAmount,
        description: `${percentLabel(config.nsitfEmployerRate)} of monthly gross salary.`
      }
    ],
    total_deductions: breakdown.totalDeductions,
    total_employer_contributions: breakdown.totalEmployerContributions,
    net_amount: breakdown.netAmount,
    withholding_applied: true,
    withholding_note: "Nigerian statutory withholding applied."
  };
}
