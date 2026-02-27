import { getCountryEngine } from "./engines";
import type { CalculatePayrollItemParams, PayrollCalculationResult } from "../../types/payroll";

function countryEngineMissingMessage(countryCode: string | null): string {
  const normalizedCountryCode = countryCode?.trim().toUpperCase() || "UNKNOWN";

  return (
    `Country engine not yet enabled for ${normalizedCountryCode}. ` +
    "Set payroll_mode to contractor_usd_no_withholding or contact admin."
  );
}

export async function calculatePayrollItem(
  params: CalculatePayrollItemParams
): Promise<PayrollCalculationResult> {
  const payrollMode = params.employee.payroll_mode;

  if (payrollMode === "contractor_usd_no_withholding") {
    return {
      gross_amount: params.monthly_gross_amount,
      deductions: [],
      employer_contributions: [],
      total_deductions: 0,
      total_employer_contributions: 0,
      net_amount: params.monthly_gross_amount,
      withholding_applied: false,
      withholding_note: "Contractor. Taxes not withheld."
    };
  }

  if (payrollMode === "employee_local_withholding") {
    if (!params.employee.org_id) {
      throw new Error("Missing org_id for employee payroll calculation.");
    }

    const countryEngine = getCountryEngine(params.employee.country_code);

    if (!countryEngine) {
      throw new Error(countryEngineMissingMessage(params.employee.country_code));
    }

    return await countryEngine.calculate(params);
  }

  throw new Error(`Unsupported payroll_mode: ${payrollMode}`);
}
