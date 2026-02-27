export const DEDUCTION_RULE_TYPES = [
  "income_tax",
  "pension_employee",
  "pension_employer",
  "housing_fund",
  "social_insurance",
  "health_insurance",
  "development_levy",
  "relief",
  "other"
] as const;

export type DeductionRuleType = (typeof DEDUCTION_RULE_TYPES)[number];

export type PayrollMode =
  | "contractor_usd_no_withholding"
  | "employee_local_withholding"
  | "employee_usd_withholding";

export type PayrollEmployeeProfile = {
  id: string;
  org_id: string;
  payroll_mode: PayrollMode | string;
  country_code: string | null;
};

export type PayrollAllowanceItem = {
  label: string;
  amount: number;
  currency: string;
  is_taxable?: boolean;
};

export type PayrollCalculationLineItem = {
  rule_type: DeductionRuleType;
  rule_name: string;
  amount: number;
  description: string;
};

export type PayrollCalculationResult = {
  gross_amount: number;
  deductions: PayrollCalculationLineItem[];
  employer_contributions: PayrollCalculationLineItem[];
  total_deductions: number;
  total_employer_contributions: number;
  net_amount: number;
  withholding_applied: boolean;
  withholding_note: string | null;
};

export type CalculatePayrollItemParams = {
  employee: PayrollEmployeeProfile;
  monthly_gross_amount: number;
  monthly_base_salary_amount: number;
  currency: string;
  allowances: PayrollAllowanceItem[];
  effective_date?: string | null;
};

export type CountryPayrollEngine = {
  calculate: (params: CalculatePayrollItemParams) => Promise<PayrollCalculationResult>;
};
