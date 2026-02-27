import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ALLOWANCE_TYPES,
  COMPENSATION_EMPLOYMENT_TYPES,
  COMPENSATION_PAY_FREQUENCIES,
  EQUITY_GRANT_STATUSES,
  EQUITY_GRANT_TYPES,
  type AdminCompensationEmployeeOption,
  type AllowanceRecord,
  type CompensationEmployeeSummary,
  type CompensationRecord,
  type EquityGrantRecord
} from "../types/compensation";
import { parseBigIntValue, parseNumericValue } from "./compensation";

const employeeSummaryRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  title: z.string().nullable(),
  country_code: z.string().nullable(),
  employment_type: z.enum(COMPENSATION_EMPLOYMENT_TYPES),
  payroll_mode: z.string(),
  primary_currency: z.string().length(3)
});

const compensationRecordRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  base_salary_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  pay_frequency: z.enum(COMPENSATION_PAY_FREQUENCIES),
  employment_type: z.enum(COMPENSATION_EMPLOYMENT_TYPES),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const allowanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  type: z.enum(ALLOWANCE_TYPES),
  label: z.string(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  is_taxable: z.boolean(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const equityGrantRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  grant_type: z.enum(EQUITY_GRANT_TYPES),
  number_of_shares: z.union([z.number(), z.string()]),
  exercise_price_cents: z.union([z.number(), z.string()]).nullable(),
  grant_date: z.string(),
  vesting_start_date: z.string(),
  cliff_months: z.number(),
  vesting_duration_months: z.number(),
  schedule: z.literal("monthly"),
  status: z.enum(EQUITY_GRANT_STATUSES),
  approved_by: z.string().uuid().nullable(),
  board_approval_date: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const actorRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const employeeOptionRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

type SnapshotResult = {
  employee: CompensationEmployeeSummary;
  salaryRecords: CompensationRecord[];
  allowances: AllowanceRecord[];
  equityGrants: EquityGrantRecord[];
};

function actorNameByIdMap(rows: z.infer<typeof actorRowSchema>[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

export async function fetchCompensationSnapshot({
  supabase,
  orgId,
  employeeId
}: {
  supabase: SupabaseClient;
  orgId: string;
  employeeId: string;
}): Promise<SnapshotResult | null> {
  const { data: rawEmployee, error: employeeError } = await supabase
    .from("profiles")
    .select(
      "id, full_name, department, title, country_code, employment_type, payroll_mode, primary_currency"
    )
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .is("deleted_at", null)
    .maybeSingle();

  if (employeeError) {
    throw new Error(`Unable to load employee profile: ${employeeError.message}`);
  }

  const parsedEmployee = employeeSummaryRowSchema.safeParse(rawEmployee);

  if (!parsedEmployee.success) {
    return null;
  }

  const [
    { data: rawSalaryRecords, error: salaryError },
    { data: rawAllowances, error: allowanceError },
    { data: rawEquityGrants, error: equityError }
  ] = await Promise.all([
    supabase
      .from("compensation_records")
      .select(
        "id, employee_id, org_id, base_salary_amount, currency, pay_frequency, employment_type, effective_from, effective_to, approved_by, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("effective_from", { ascending: false }),
    supabase
      .from("allowances")
      .select(
        "id, employee_id, org_id, type, label, amount, currency, is_taxable, effective_from, effective_to, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("effective_from", { ascending: false }),
    supabase
      .from("equity_grants")
      .select(
        "id, employee_id, org_id, grant_type, number_of_shares, exercise_price_cents, grant_date, vesting_start_date, cliff_months, vesting_duration_months, schedule, status, approved_by, board_approval_date, notes, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("grant_date", { ascending: false })
  ]);

  if (salaryError || allowanceError || equityError) {
    throw new Error(
      salaryError?.message ??
        allowanceError?.message ??
        equityError?.message ??
        "Unable to load compensation details."
    );
  }

  const parsedSalaryRecords = z.array(compensationRecordRowSchema).safeParse(rawSalaryRecords ?? []);
  const parsedAllowances = z.array(allowanceRowSchema).safeParse(rawAllowances ?? []);
  const parsedEquityGrants = z.array(equityGrantRowSchema).safeParse(rawEquityGrants ?? []);

  if (!parsedSalaryRecords.success || !parsedAllowances.success || !parsedEquityGrants.success) {
    throw new Error("Compensation data is not in the expected shape.");
  }

  const approverIds = [
    ...new Set(
      [
        ...parsedSalaryRecords.data
          .map((row) => row.approved_by)
          .filter((value): value is string => Boolean(value)),
        ...parsedEquityGrants.data
          .map((row) => row.approved_by)
          .filter((value): value is string => Boolean(value))
      ]
    )
  ];

  let actorMap = new Map<string, string>();

  if (approverIds.length > 0) {
    const { data: rawActors, error: actorError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", approverIds);

    if (actorError) {
      throw new Error(`Unable to load approver metadata: ${actorError.message}`);
    }

    const parsedActors = z.array(actorRowSchema).safeParse(rawActors ?? []);

    if (!parsedActors.success) {
      throw new Error("Approver data is not in the expected shape.");
    }

    actorMap = actorNameByIdMap(parsedActors.data);
  }

  const salaryRecords: CompensationRecord[] = parsedSalaryRecords.data.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    orgId: row.org_id,
    baseSalaryAmount: parseBigIntValue(row.base_salary_amount),
    currency: row.currency,
    payFrequency: row.pay_frequency,
    employmentType: row.employment_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by ? actorMap.get(row.approved_by) ?? "Unknown user" : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const allowances: AllowanceRecord[] = parsedAllowances.data.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    orgId: row.org_id,
    type: row.type,
    label: row.label,
    amount: parseBigIntValue(row.amount),
    currency: row.currency,
    isTaxable: row.is_taxable,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const equityGrants: EquityGrantRecord[] = parsedEquityGrants.data.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    orgId: row.org_id,
    grantType: row.grant_type,
    numberOfShares: parseNumericValue(row.number_of_shares),
    exercisePriceCents:
      row.exercise_price_cents === null ? null : parseBigIntValue(row.exercise_price_cents),
    grantDate: row.grant_date,
    vestingStartDate: row.vesting_start_date,
    cliffMonths: row.cliff_months,
    vestingDurationMonths: row.vesting_duration_months,
    schedule: row.schedule,
    status: row.status,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by ? actorMap.get(row.approved_by) ?? "Unknown user" : null,
    boardApprovalDate: row.board_approval_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return {
    employee: {
      id: parsedEmployee.data.id,
      fullName: parsedEmployee.data.full_name,
      department: parsedEmployee.data.department,
      title: parsedEmployee.data.title,
      countryCode: parsedEmployee.data.country_code,
      employmentType: parsedEmployee.data.employment_type,
      payrollMode: parsedEmployee.data.payroll_mode,
      primaryCurrency: parsedEmployee.data.primary_currency
    },
    salaryRecords,
    allowances,
    equityGrants
  };
}

export async function fetchAdminCompensationEmployees({
  supabase,
  orgId
}: {
  supabase: SupabaseClient;
  orgId: string;
}): Promise<AdminCompensationEmployeeOption[]> {
  const { data: rawEmployees, error } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load employee list: ${error.message}`);
  }

  const parsedEmployees = z.array(employeeOptionRowSchema).safeParse(rawEmployees ?? []);

  if (!parsedEmployees.success) {
    throw new Error("Employee selector data is not in the expected shape.");
  }

  return parsedEmployees.data.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    department: row.department,
    countryCode: row.country_code
  }));
}
