import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { parseBigIntValue } from "./compensation";
import {
  COMPENSATION_BAND_LOCATION_TYPES,
  type BenchmarkDataRecord,
  type CompensationBandAlertRecord,
  type CompensationBandAssignmentRecord,
  type CompensationBandEmployeeOption,
  type CompensationBandRecord,
  type CompensationBandsResponseData
} from "../types/compensation-bands";
import { COMPENSATION_EMPLOYMENT_TYPES } from "../types/compensation";

const profileStatuses = ["active", "inactive", "onboarding", "offboarding"] as const;

const bandRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  title: z.string(),
  level: z.string().nullable(),
  department: z.string().nullable(),
  location_type: z.enum(COMPENSATION_BAND_LOCATION_TYPES),
  location_value: z.string().nullable(),
  currency: z.string().length(3),
  min_salary_amount: z.union([z.number(), z.string()]),
  mid_salary_amount: z.union([z.number(), z.string()]),
  max_salary_amount: z.union([z.number(), z.string()]),
  equity_min: z.number().nullable(),
  equity_max: z.number().nullable(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const benchmarkRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  source: z.string(),
  title: z.string(),
  level: z.string().nullable(),
  location: z.string().nullable(),
  currency: z.string().length(3),
  p25: z.union([z.number(), z.string()]).nullable(),
  p50: z.union([z.number(), z.string()]).nullable(),
  p75: z.union([z.number(), z.string()]).nullable(),
  p90: z.union([z.number(), z.string()]).nullable(),
  imported_at: z.string()
});

const assignmentRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  band_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  assigned_at: z.string()
});

const employeeRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  employment_type: z.enum(COMPENSATION_EMPLOYMENT_TYPES),
  status: z.enum(profileStatuses)
});

const compensationRowSchema = z.object({
  employee_id: z.string().uuid(),
  base_salary_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  created_at: z.string()
});

function parseNullableBigInt(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return parseBigIntValue(value);
}

export function formatCompensationBandLabel(band: {
  title: string;
  level: string | null;
  locationType: string;
  locationValue: string | null;
}): string {
  const levelPart = band.level ? ` ${band.level}` : "";
  const locationPart =
    band.locationType === "global"
      ? "Global"
      : band.locationValue ?? band.locationType;

  return `${band.title}${levelPart} (${locationPart})`;
}

function mapBandRow(row: z.infer<typeof bandRowSchema>, assignedEmployeeCount: number): CompensationBandRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    level: row.level,
    department: row.department,
    locationType: row.location_type,
    locationValue: row.location_value,
    currency: row.currency,
    minSalaryAmount: parseBigIntValue(row.min_salary_amount),
    midSalaryAmount: parseBigIntValue(row.mid_salary_amount),
    maxSalaryAmount: parseBigIntValue(row.max_salary_amount),
    equityMin: row.equity_min,
    equityMax: row.equity_max,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedEmployeeCount
  };
}

function mapBenchmarkRow(row: z.infer<typeof benchmarkRowSchema>): BenchmarkDataRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    source: row.source,
    title: row.title,
    level: row.level,
    location: row.location,
    currency: row.currency,
    p25: parseNullableBigInt(row.p25),
    p50: parseNullableBigInt(row.p50),
    p75: parseNullableBigInt(row.p75),
    p90: parseNullableBigInt(row.p90),
    importedAt: row.imported_at
  };
}

function assignmentComparator(
  left: Pick<z.infer<typeof assignmentRowSchema>, "effective_from" | "assigned_at">,
  right: Pick<z.infer<typeof assignmentRowSchema>, "effective_from" | "assigned_at">
): number {
  const leftEffective = new Date(`${left.effective_from}T00:00:00.000Z`).getTime();
  const rightEffective = new Date(`${right.effective_from}T00:00:00.000Z`).getTime();

  if (leftEffective !== rightEffective) {
    return rightEffective - leftEffective;
  }

  return new Date(right.assigned_at).getTime() - new Date(left.assigned_at).getTime();
}

function toIsoDate(dateValue: Date): string {
  return dateValue.toISOString().slice(0, 10);
}

function isActiveWindow(
  effectiveFrom: string,
  effectiveTo: string | null,
  referenceDate: string
): boolean {
  if (effectiveFrom > referenceDate) {
    return false;
  }

  if (effectiveTo && effectiveTo < referenceDate) {
    return false;
  }

  return true;
}

function mapAssignmentRows({
  rows,
  bandById,
  employeeNameById
}: {
  rows: z.infer<typeof assignmentRowSchema>[];
  bandById: ReadonlyMap<string, CompensationBandRecord>;
  employeeNameById: ReadonlyMap<string, string>;
}): CompensationBandAssignmentRecord[] {
  return rows.map((row) => {
    const band = bandById.get(row.band_id);

    return {
      id: row.id,
      orgId: row.org_id,
      bandId: row.band_id,
      employeeId: row.employee_id,
      employeeName: employeeNameById.get(row.employee_id) ?? "Unknown employee",
      bandLabel: band
        ? formatCompensationBandLabel({
            title: band.title,
            level: band.level,
            locationType: band.locationType,
            locationValue: band.locationValue
          })
        : "Unknown band",
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      assignedAt: row.assigned_at
    };
  });
}

function buildAlerts({
  assignmentRows,
  bandById,
  employeeById,
  salaryByEmployeeId
}: {
  assignmentRows: z.infer<typeof assignmentRowSchema>[];
  bandById: ReadonlyMap<string, CompensationBandRecord>;
  employeeById: ReadonlyMap<string, CompensationBandEmployeeOption>;
  salaryByEmployeeId: ReadonlyMap<string, { amount: number; currency: string }>;
}): CompensationBandAlertRecord[] {
  const today = toIsoDate(new Date());
  const activeRows = assignmentRows
    .filter((row) => isActiveWindow(row.effective_from, row.effective_to, today))
    .sort(assignmentComparator);

  const activeByEmployee = new Map<string, z.infer<typeof assignmentRowSchema>>();

  for (const row of activeRows) {
    if (!activeByEmployee.has(row.employee_id)) {
      activeByEmployee.set(row.employee_id, row);
    }
  }

  const alerts: CompensationBandAlertRecord[] = [];

  for (const [employeeId, assignment] of activeByEmployee) {
    const employee = employeeById.get(employeeId);
    const band = bandById.get(assignment.band_id);

    if (!employee || !band) {
      continue;
    }

    const salary = salaryByEmployeeId.get(employeeId);

    if (!salary) {
      alerts.push({
        employeeId,
        employeeName: employee.fullName,
        employeeTitle: employee.title,
        employeeDepartment: employee.department,
        countryCode: employee.countryCode,
        bandId: band.id,
        bandLabel: formatCompensationBandLabel({
          title: band.title,
          level: band.level,
          locationType: band.locationType,
          locationValue: band.locationValue
        }),
        currency: band.currency,
        currentSalaryAmount: null,
        minSalaryAmount: band.minSalaryAmount,
        midSalaryAmount: band.midSalaryAmount,
        maxSalaryAmount: band.maxSalaryAmount,
        compaRatio: null,
        status: "missing_salary"
      });
      continue;
    }

    if (salary.amount < band.minSalaryAmount || salary.amount > band.maxSalaryAmount) {
      alerts.push({
        employeeId,
        employeeName: employee.fullName,
        employeeTitle: employee.title,
        employeeDepartment: employee.department,
        countryCode: employee.countryCode,
        bandId: band.id,
        bandLabel: formatCompensationBandLabel({
          title: band.title,
          level: band.level,
          locationType: band.locationType,
          locationValue: band.locationValue
        }),
        currency: salary.currency,
        currentSalaryAmount: salary.amount,
        minSalaryAmount: band.minSalaryAmount,
        midSalaryAmount: band.midSalaryAmount,
        maxSalaryAmount: band.maxSalaryAmount,
        compaRatio: band.midSalaryAmount > 0 ? salary.amount / band.midSalaryAmount : null,
        status: salary.amount < band.minSalaryAmount ? "below_band" : "above_band"
      });
    }
  }

  return alerts.sort((left, right) => left.employeeName.localeCompare(right.employeeName));
}

export async function fetchCompensationBandsData({
  supabase,
  orgId
}: {
  supabase: SupabaseClient;
  orgId: string;
}): Promise<CompensationBandsResponseData> {
  const [{ data: rawBandRows, error: bandError }, { data: rawBenchmarkRows, error: benchmarkError }, { data: rawAssignmentRows, error: assignmentError }, { data: rawEmployeeRows, error: employeeError }] = await Promise.all([
    supabase
      .from("compensation_bands")
      .select(
        "id, org_id, title, level, department, location_type, location_value, currency, min_salary_amount, mid_salary_amount, max_salary_amount, equity_min, equity_max, effective_from, effective_to, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("title", { ascending: true }),
    supabase
      .from("benchmark_data")
      .select(
        "id, org_id, source, title, level, location, currency, p25, p50, p75, p90, imported_at"
      )
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("imported_at", { ascending: false }),
    supabase
      .from("compensation_band_assignments")
      .select("id, org_id, band_id, employee_id, effective_from, effective_to, assigned_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, title, department, country_code, employment_type, status")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
  ]);

  if (bandError || benchmarkError || assignmentError || employeeError) {
    throw new Error(
      bandError?.message ??
        benchmarkError?.message ??
        assignmentError?.message ??
        employeeError?.message ??
        "Unable to load compensation bands."
    );
  }

  const parsedBands = z.array(bandRowSchema).safeParse(rawBandRows ?? []);
  const parsedBenchmarks = z.array(benchmarkRowSchema).safeParse(rawBenchmarkRows ?? []);
  const parsedAssignments = z.array(assignmentRowSchema).safeParse(rawAssignmentRows ?? []);
  const parsedEmployees = z.array(employeeRowSchema).safeParse(rawEmployeeRows ?? []);

  if (
    !parsedBands.success ||
    !parsedBenchmarks.success ||
    !parsedAssignments.success ||
    !parsedEmployees.success
  ) {
    throw new Error("Compensation band data is not in the expected shape.");
  }

  const activeAssignmentCountByBand = new Map<string, number>();

  for (const row of parsedAssignments.data) {
    if (row.effective_to === null) {
      activeAssignmentCountByBand.set(
        row.band_id,
        (activeAssignmentCountByBand.get(row.band_id) ?? 0) + 1
      );
    }
  }

  const bands = parsedBands.data.map((row) =>
    mapBandRow(row, activeAssignmentCountByBand.get(row.id) ?? 0)
  );

  const benchmarks = parsedBenchmarks.data.map(mapBenchmarkRow);

  const employeeOptions: CompensationBandEmployeeOption[] = parsedEmployees.data.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    title: row.title,
    department: row.department,
    countryCode: row.country_code,
    employmentType: row.employment_type,
    status: row.status
  }));

  const employeeNameById = new Map(employeeOptions.map((row) => [row.id, row.fullName]));
  const employeeById = new Map(employeeOptions.map((row) => [row.id, row]));
  const bandById = new Map(bands.map((row) => [row.id, row]));

  const assignments = mapAssignmentRows({
    rows: parsedAssignments.data,
    bandById,
    employeeNameById
  });

  const assignedEmployeeIds = [...new Set(parsedAssignments.data.map((row) => row.employee_id))];

  let salaryByEmployeeId = new Map<string, { amount: number; currency: string }>();

  if (assignedEmployeeIds.length > 0) {
    const { data: rawCompensationRows, error: compensationError } = await supabase
      .from("compensation_records")
      .select("employee_id, base_salary_amount, currency, effective_from, effective_to, created_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("employee_id", assignedEmployeeIds)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false });

    if (compensationError) {
      throw new Error(`Unable to load compensation records: ${compensationError.message}`);
    }

    const parsedCompensationRows = z.array(compensationRowSchema).safeParse(rawCompensationRows ?? []);

    if (!parsedCompensationRows.success) {
      throw new Error("Compensation records are not in the expected shape.");
    }

    const today = toIsoDate(new Date());
    const rowsByEmployee = new Map<string, z.infer<typeof compensationRowSchema>[]>();

    for (const row of parsedCompensationRows.data) {
      const currentRows = rowsByEmployee.get(row.employee_id) ?? [];
      currentRows.push(row);
      rowsByEmployee.set(row.employee_id, currentRows);
    }

    salaryByEmployeeId = new Map(
      [...rowsByEmployee.entries()].flatMap(([employeeId, rows]) => {
        const activeRow = rows.find((row) => isActiveWindow(row.effective_from, row.effective_to, today));
        const selectedRow = activeRow ?? rows[0];

        if (!selectedRow) {
          return [];
        }

        return [
          [
            employeeId,
            {
              amount: parseBigIntValue(selectedRow.base_salary_amount),
              currency: selectedRow.currency
            }
          ] as const
        ];
      })
    );
  }

  const alerts = buildAlerts({
    assignmentRows: parsedAssignments.data,
    bandById,
    employeeById,
    salaryByEmployeeId
  });

  return {
    bands,
    benchmarks,
    assignments,
    employeeOptions,
    alerts
  };
}
