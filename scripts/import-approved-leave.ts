/**
 * Import approved annual leave from workbook calendars into real leave_requests rows.
 *
 * Dry run by default:
 *   npx tsx scripts/import-approved-leave.ts /path/to/file.xlsx [...]
 *
 * Apply changes:
 *   npx tsx scripts/import-approved-leave.ts --apply /path/to/file.xlsx [...]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { addIsoDays, calculateWorkingDays, isoDateToUtcDate, parseNumeric } from "../lib/time-off";

const IMPORT_REASON = "Historical approved leave import (Accrue leave calendar)";
const DEFAULT_ORG_EMAIL = "zino@useaccrue.com";
const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";
const PRODUCTION_ORG_ID = "0c0e516f-5896-4f3b-a163-42e8460e5faa";
const HELPER_SCRIPT_PATH = path.resolve(process.cwd(), "scripts/extract-approved-leave-workbooks.py");

type ParsedWorkbookEmployee = {
  name: string;
  row: number;
  dates: string[];
};

type ParsedWorkbook = {
  sourcePath: string;
  sheetName: string;
  employees: ParsedWorkbookEmployee[];
};

type ImportedEmployee = {
  importedName: string;
  normalizedImportedName: string;
  sourcePaths: string[];
  sheetNames: string[];
  dates: string[];
};

type ProfileRow = {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  country_code: string | null;
  status: string;
};

type ResolvedImportedEmployee = ImportedEmployee & {
  profile: ProfileRow;
  leaveBlocks: LeaveBlock[];
};

type LeaveBlock = {
  startDate: string;
  endDate: string;
  totalDays: number;
};

type LeavePolicySeed = {
  leaveType: string;
  defaultDaysPerYear: number;
  accrualType: string;
  carryOver: boolean;
  isUnlimited: boolean;
  notes: string;
};

type HolidaySeed = {
  date: string;
  name: string;
  countryCodes: string[];
};

const STANDARD_POLICIES: LeavePolicySeed[] = [
  {
    leaveType: "annual_leave",
    defaultDaysPerYear: 20,
    accrualType: "annual_upfront",
    carryOver: false,
    isUnlimited: false,
    notes: "20 paid annual leave days per calendar year. Unused days expire at year end."
  },
  {
    leaveType: "sick_leave",
    defaultDaysPerYear: 0,
    accrualType: "manual",
    carryOver: false,
    isUnlimited: true,
    notes: "Unlimited sick leave. Doctor's note required after 2+ consecutive working days."
  },
  {
    leaveType: "personal_days",
    defaultDaysPerYear: 5,
    accrualType: "annual_upfront",
    carryOver: false,
    isUnlimited: false,
    notes: "5 personal days per calendar year for non-leisure obligations."
  },
  {
    leaveType: "birthday_leave",
    defaultDaysPerYear: 1,
    accrualType: "annual_upfront",
    carryOver: false,
    isUnlimited: false,
    notes: "1 paid birthday leave day each year."
  },
  {
    leaveType: "unpaid_personal_day",
    defaultDaysPerYear: 5,
    accrualType: "annual_upfront",
    carryOver: false,
    isUnlimited: false,
    notes: "Up to 5 unpaid personal days during probation or internship."
  }
];

const HOLIDAYS_2026: HolidaySeed[] = [
  { date: "2026-01-01", name: "New Year's Day", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-01-07", name: "Constitution Day", countryCodes: ["GH"] },
  { date: "2026-03-06", name: "Independence Day", countryCodes: ["GH"] },
  { date: "2026-03-20", name: "Eid al-Fitr", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-03-23", name: "Eid al-Fitr Holiday", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-04-03", name: "Good Friday", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-04-06", name: "Easter Monday", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-05-01", name: "Workers' Day", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-06-01", name: "Eid al-Adha", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-06-02", name: "Eid al-Adha Holiday", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-06-12", name: "Democracy Day", countryCodes: ["NG"] },
  { date: "2026-07-01", name: "Republic Day", countryCodes: ["GH"] },
  { date: "2026-09-21", name: "Kwame Nkrumah Memorial Day", countryCodes: ["GH"] },
  { date: "2026-09-25", name: "Eid-ul-Mawlid", countryCodes: ["NG", "GH", "CM"] },
  { date: "2026-10-01", name: "Independence Day", countryCodes: ["NG"] },
  { date: "2026-12-04", name: "Farmers' Day", countryCodes: ["GH"] },
  { date: "2026-12-25", name: "Christmas Day", countryCodes: ["NG", "GH", "CM"] }
];

const EMPLOYEE_EMAIL_ALIASES = new Map<string, string>([
  ["adesuwa omoruyi", "adesuwa@useaccrue.com"],
  ["zino asamaige", "zino@useaccrue.com"],
  ["richard adaramola", "richard@useaccrue.com"],
  ["temabo omame", "tema@useaccrue.com"],
  ["tema omame", "tema@useaccrue.com"],
  ["esse oghene emma udubrah", "esse@useaccrue.com"],
  ["esse udubrah", "esse@useaccrue.com"],
  ["alex omenye", "alex@useaccrue.com"],
  ["felix akinnibi", "felix@useaccrue.com"],
  ["nureni imam", "nureni@useaccrue.com"],
  ["nureni", "nureni@useaccrue.com"],
  ["ifeanyichukwu obinna onuoha", "ifeanyi@useaccrue.com"],
  ["ifeanyi", "ifeanyi@useaccrue.com"],
  ["victor sanusi", "victor.s@useaccrue.com"],
  ["gabriel kofi owusu", "gabby@useaccrue.com"],
  ["gabriel owusu", "gabby@useaccrue.com"],
  ["benjamin essilfie ofori quansah", "essilfie@useaccrue.com"],
  ["essilfie", "essilfie@useaccrue.com"],
  ["shalewa oseni", "shalewa@useaccrue.com"],
  ["raphaela rockson", "raphaela@useaccrue.com"],
  ["ailara motunrayo", "rayo@useaccrue.com"],
  ["rayo ailara", "rayo@useaccrue.com"],
  ["antoinette atolagbe", "antoinette@useaccrue.com"],
  ["favour nnadi", "favour.n@useaccrue.com"],
  ["stephanie anene", "stephanie@useaccrue.com"],
  ["oluwaseun adesoye", "seun@useaccrue.com"],
  ["seun adesoye", "seun@useaccrue.com"],
  ["chiamaka ufedo ewa", "chiamaka@useaccrue.com"],
  ["chiamaka ewa", "chiamaka@useaccrue.com"],
  ["aishat akintola", "aishat@useaccrue.com"],
  ["tunmise falade", "tunmise@useaccrue.com"]
]);

const FALLBACK_TOTAL_DAYS_BY_LEAVE_TYPE = new Map<string, number>([
  ["annual_leave", 20],
  ["personal_days", 5],
  ["birthday_leave", 1],
  ["unpaid_personal_day", 5]
]);

const MANUAL_LAST_DAY_REMOVALS = new Map<string, number>([
  ["adesuwa@useaccrue.com", 1],
  ["rayo@useaccrue.com", 1],
  ["felix@useaccrue.com", 1],
  ["tema@useaccrue.com", 1]
]);

const EXCLUDED_IMPORT_EMAILS = new Set<string>(["felix@useaccrue.com"]);

function loadEnvFile(filePath: string, overwrite = false) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);

    if (overwrite || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv(targetEnv: "staging" | "production") {
  if (targetEnv === "production") {
    loadEnvFile(path.resolve(process.cwd(), ".env"), true);
    return;
  }

  loadEnvFile(path.resolve(process.cwd(), ".env.local"), true);
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isWeekendIso(isoDate: string): boolean {
  const utcDate = isoDateToUtcDate(isoDate);

  if (!utcDate) {
    return false;
  }

  const day = utcDate.getUTCDay();
  return day === 0 || day === 6;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseArgs(argv: string[]) {
  const filePaths: string[] = [];
  let apply = false;
  let confirm = false;
  let orgEmail = DEFAULT_ORG_EMAIL;
  let targetEnv: "staging" | "production" = "staging";

  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }

    if (argument === "--confirm") {
      confirm = true;
      continue;
    }

    if (argument.startsWith("--org-email=")) {
      orgEmail = argument.slice("--org-email=".length).trim().toLowerCase();
      continue;
    }

    if (argument === "--env=production") {
      targetEnv = "production";
      continue;
    }

    if (argument === "--env=staging") {
      targetEnv = "staging";
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    filePaths.push(path.resolve(argument));
  }

  if (filePaths.length === 0) {
    throw new Error("Provide at least one workbook path.");
  }

  return { apply, confirm, filePaths, orgEmail, targetEnv };
}

function createServiceRoleClient(): SupabaseClient {
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function ensureSafeProjectTarget({
  targetEnv,
  apply,
  confirm
}: {
  targetEnv: "staging" | "production";
  apply: boolean;
  confirm: boolean;
}) {
  const projectRef = new URL(requiredEnv("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];

  if (targetEnv === "production" && projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error("Production target selected, but the loaded Supabase URL is not production.");
  }

  if (targetEnv === "staging" && projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error("Staging target selected, but the loaded Supabase URL is production.");
  }

  if (projectRef === PRODUCTION_PROJECT_REF && apply && !confirm) {
    throw new Error("Applying to production requires --confirm.");
  }
}

function extractWorkbooks(filePaths: string[]): ParsedWorkbook[] {
  if (!fs.existsSync(HELPER_SCRIPT_PATH)) {
    throw new Error(`Workbook helper not found at ${HELPER_SCRIPT_PATH}`);
  }

  const result = spawnSync("python3", [HELPER_SCRIPT_PATH, ...filePaths], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Workbook extraction failed.");
  }

  const payload = JSON.parse(result.stdout) as ParsedWorkbook[];
  return payload;
}

function consolidateImportedEmployees(workbooks: ParsedWorkbook[]): ImportedEmployee[] {
  const importedEmployees = new Map<string, ImportedEmployee>();

  for (const workbook of workbooks) {
    for (const employee of workbook.employees) {
      const normalizedImportedName = normalizeName(employee.name);
      const existing = importedEmployees.get(normalizedImportedName);

      if (!existing) {
        importedEmployees.set(normalizedImportedName, {
          importedName: employee.name.trim(),
          normalizedImportedName,
          sourcePaths: [workbook.sourcePath],
          sheetNames: [workbook.sheetName],
          dates: uniqueSorted(employee.dates)
        });
        continue;
      }

      existing.sourcePaths = uniqueSorted([...existing.sourcePaths, workbook.sourcePath]);
      existing.sheetNames = uniqueSorted([...existing.sheetNames, workbook.sheetName]);
      existing.dates = uniqueSorted([...existing.dates, ...employee.dates]);
    }
  }

  return [...importedEmployees.values()].sort((left, right) =>
    left.importedName.localeCompare(right.importedName)
  );
}

async function getAnchorProfile(client: SupabaseClient, email: string): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .select("id, org_id, full_name, email, country_code, status")
    .eq("email", email)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new Error(`Unable to find anchor profile for ${email}.`);
  }

  return data as ProfileRow;
}

async function getOrgProfiles(client: SupabaseClient, orgId: string): Promise<ProfileRow[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, org_id, full_name, email, country_code, status")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("full_name");

  if (error) {
    throw new Error(`Unable to load profiles: ${error.message}`);
  }

  return (data ?? []) as ProfileRow[];
}

function resolveImportedEmployees(
  importedEmployees: ImportedEmployee[],
  profiles: ProfileRow[]
): { resolved: ResolvedImportedEmployee[]; missing: ImportedEmployee[] } {
  const byEmail = new Map<string, ProfileRow>();
  const byName = new Map<string, ProfileRow>();

  for (const profile of profiles) {
    byEmail.set(profile.email.toLowerCase(), profile);
    byName.set(normalizeName(profile.full_name), profile);
  }

  const resolved: ResolvedImportedEmployee[] = [];
  const missing: ImportedEmployee[] = [];

  for (const importedEmployee of importedEmployees) {
    const aliasEmail = EMPLOYEE_EMAIL_ALIASES.get(importedEmployee.normalizedImportedName);
    const exactNameMatch = byName.get(importedEmployee.normalizedImportedName) ?? null;
    const aliasEmailMatch = aliasEmail ? byEmail.get(aliasEmail) ?? null : null;
    const fuzzyMatches = profiles.filter((profile) => {
      const normalizedProfileName = normalizeName(profile.full_name);
      return (
        normalizedProfileName.includes(importedEmployee.normalizedImportedName) ||
        importedEmployee.normalizedImportedName.includes(normalizedProfileName)
      );
    });

    const profile =
      exactNameMatch ??
      aliasEmailMatch ??
      (fuzzyMatches.length === 1 ? fuzzyMatches[0] : null);

    if (!profile) {
      missing.push(importedEmployee);
      continue;
    }

    if (EXCLUDED_IMPORT_EMAILS.has(profile.email.toLowerCase())) {
      continue;
    }

    resolved.push({
      ...importedEmployee,
      profile,
      leaveBlocks: []
    });
  }

  return { resolved, missing };
}

async function ensureOrgWidePolicies(client: SupabaseClient, orgId: string) {
  const { data: existingPolicies, error: existingPoliciesError } = await client
    .from("leave_policies")
    .select("leave_type")
    .eq("org_id", orgId)
    .is("country_code", null)
    .is("deleted_at", null)
    .in(
      "leave_type",
      STANDARD_POLICIES.map((policy) => policy.leaveType)
    );

  if (existingPoliciesError) {
    throw new Error(`Unable to load leave policies: ${existingPoliciesError.message}`);
  }

  const existingTypes = new Set((existingPolicies ?? []).map((policy) => String(policy.leave_type)));
  const missingPolicies = STANDARD_POLICIES.filter((policy) => !existingTypes.has(policy.leaveType));

  if (missingPolicies.length === 0) {
    return;
  }

  const { error: insertError } = await client.from("leave_policies").insert(
    missingPolicies.map((policy) => ({
      org_id: orgId,
      country_code: null,
      leave_type: policy.leaveType,
      default_days_per_year: policy.defaultDaysPerYear,
      accrual_type: policy.accrualType,
      carry_over: policy.carryOver,
      is_unlimited: policy.isUnlimited,
      notes: policy.notes
    }))
  );

  if (insertError) {
    throw new Error(`Unable to insert leave policies: ${insertError.message}`);
  }
}

async function ensureHolidayCalendars(client: SupabaseClient, orgId: string) {
  const rows = HOLIDAYS_2026.flatMap((holiday) =>
    holiday.countryCodes.map((countryCode) => ({
      org_id: orgId,
      country_code: countryCode,
      date: holiday.date,
      name: holiday.name,
      year: 2026
    }))
  );

  const { error } = await client
    .from("holiday_calendars")
    .upsert(rows, { onConflict: "org_id,country_code,date" });

  if (error) {
    throw new Error(`Unable to upsert holiday calendars: ${error.message}`);
  }
}

async function getHolidayDateKeysByCountry(
  client: SupabaseClient,
  orgId: string
): Promise<Map<string, Set<string>>> {
  const { data, error } = await client
    .from("holiday_calendars")
    .select("country_code, date")
    .eq("org_id", orgId)
    .eq("year", 2026)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Unable to load holiday calendars: ${error.message}`);
  }

  const holidayDateKeysByCountry = new Map<string, Set<string>>();

  for (const row of data ?? []) {
    const countryCode = String(row.country_code ?? "").toUpperCase();
    const date = String(row.date ?? "");

    if (!countryCode || !date) {
      continue;
    }

    if (!holidayDateKeysByCountry.has(countryCode)) {
      holidayDateKeysByCountry.set(countryCode, new Set<string>());
    }

    holidayDateKeysByCountry.get(countryCode)?.add(date);
  }

  for (const holiday of HOLIDAYS_2026) {
    for (const countryCode of holiday.countryCodes) {
      if (!holidayDateKeysByCountry.has(countryCode)) {
        holidayDateKeysByCountry.set(countryCode, new Set<string>());
      }

      holidayDateKeysByCountry.get(countryCode)?.add(holiday.date);
    }
  }

  return holidayDateKeysByCountry;
}

function buildLeaveBlocks(dates: string[], holidayDateKeys: ReadonlySet<string>): LeaveBlock[] {
  const uniqueDates = uniqueSorted(
    dates.filter((date) => !isWeekendIso(date) && !holidayDateKeys.has(date))
  );

  if (uniqueDates.length === 0) {
    return [];
  }

  const blocks: LeaveBlock[] = [];
  let blockDates = [uniqueDates[0] as string];

  for (const currentDate of uniqueDates.slice(1)) {
    const previousDate = blockDates[blockDates.length - 1] as string;
    let cursorDate = addIsoDays(previousDate, 1);
    let shouldBridge = true;

    while (cursorDate < currentDate) {
      if (!isWeekendIso(cursorDate) && !holidayDateKeys.has(cursorDate)) {
        shouldBridge = false;
        break;
      }

      cursorDate = addIsoDays(cursorDate, 1);
    }

    if (shouldBridge) {
      blockDates.push(currentDate);
      continue;
    }

    blocks.push({
      startDate: blockDates[0] as string,
      endDate: blockDates[blockDates.length - 1] as string,
      totalDays: calculateWorkingDays(
        blockDates[0] as string,
        blockDates[blockDates.length - 1] as string,
        holidayDateKeys
      )
    });

    blockDates = [currentDate];
  }

  blocks.push({
    startDate: blockDates[0] as string,
    endDate: blockDates[blockDates.length - 1] as string,
    totalDays: calculateWorkingDays(
      blockDates[0] as string,
      blockDates[blockDates.length - 1] as string,
      holidayDateKeys
    )
  });

  return blocks;
}

function applyManualDateRemovals(profile: ProfileRow, dates: string[]): string[] {
  const removalCount = MANUAL_LAST_DAY_REMOVALS.get(profile.email.toLowerCase()) ?? 0;

  if (removalCount <= 0) {
    return dates;
  }

  return dates.slice(0, Math.max(0, dates.length - removalCount));
}

function getDefaultDaysForLeaveType(leaveType: string): number {
  return FALLBACK_TOTAL_DAYS_BY_LEAVE_TYPE.get(leaveType) ?? 0;
}

async function ensureFiniteBalances(
  client: SupabaseClient,
  orgId: string,
  profiles: ProfileRow[],
  year: number
) {
  const { data: policyRows, error: policyError } = await client
    .from("leave_policies")
    .select("leave_type, default_days_per_year, is_unlimited")
    .eq("org_id", orgId)
    .is("country_code", null)
    .is("deleted_at", null);

  if (policyError) {
    throw new Error(`Unable to load finite leave policies: ${policyError.message}`);
  }

  const finitePolicies = (policyRows ?? []).filter(
    (policy) => !policy.is_unlimited && policy.leave_type !== "unpaid_personal_day"
  );

  const finiteLeaveTypes = uniqueSorted(finitePolicies.map((policy) => String(policy.leave_type)));

  if (finiteLeaveTypes.length === 0) {
    return;
  }

  const { data: existingBalances, error: balanceError } = await client
    .from("leave_balances")
    .select("employee_id, leave_type")
    .eq("org_id", orgId)
    .eq("year", year)
    .is("deleted_at", null)
    .in("leave_type", finiteLeaveTypes);

  if (balanceError) {
    throw new Error(`Unable to load leave balances: ${balanceError.message}`);
  }

  const existingKeys = new Set(
    (existingBalances ?? []).map((row) => `${row.employee_id}:${row.leave_type}`)
  );

  const rowsToInsert = profiles.flatMap((profile) =>
    finitePolicies
      .filter((policy) => !existingKeys.has(`${profile.id}:${policy.leave_type}`))
      .map((policy) => ({
        org_id: orgId,
        employee_id: profile.id,
        leave_type: String(policy.leave_type),
        year,
        total_days:
          parseNumeric(policy.default_days_per_year) || getDefaultDaysForLeaveType(String(policy.leave_type)),
        used_days: 0,
        pending_days: 0,
        carried_days: 0
      }))
  );

  if (rowsToInsert.length === 0) {
    return;
  }

  const { error: insertError } = await client.from("leave_balances").insert(rowsToInsert);

  if (insertError) {
    throw new Error(`Unable to create leave balances: ${insertError.message}`);
  }
}

async function softDeleteExistingImportedRequests(
  client: SupabaseClient,
  orgId: string,
  employeeIds: string[],
  year: number
) {
  if (employeeIds.length === 0) {
    return;
  }

  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  const { error } = await client
    .from("leave_requests")
    .update({
      deleted_at: new Date().toISOString()
    })
    .eq("org_id", orgId)
    .eq("leave_type", "annual_leave")
    .eq("reason", IMPORT_REASON)
    .gte("start_date", startDate)
    .lt("start_date", endDate)
    .is("deleted_at", null)
    .in("employee_id", employeeIds);

  if (error) {
    throw new Error(`Unable to clear prior imported leave requests: ${error.message}`);
  }
}

async function getExistingAnnualLeaveKeys(
  client: SupabaseClient,
  orgId: string,
  employeeIds: string[],
  year: number
): Promise<Set<string>> {
  if (employeeIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await client
    .from("leave_requests")
    .select("employee_id, start_date, end_date, status, leave_type")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("employee_id", employeeIds)
    .in("leave_type", ["annual_leave", "annual"])
    .gte("start_date", `${year}-01-01`)
    .lt("start_date", `${year + 1}-01-01`);

  if (error) {
    throw new Error(`Unable to load existing leave requests: ${error.message}`);
  }

  return new Set(
    (data ?? []).map((row) => `${row.employee_id}:${row.start_date}:${row.end_date}:${row.status}`)
  );
}

async function insertImportedRequests(
  client: SupabaseClient,
  approverId: string,
  orgId: string,
  employees: ResolvedImportedEmployee[],
  year: number
) {
  const existingKeys = await getExistingAnnualLeaveKeys(
    client,
    orgId,
    employees.map((employee) => employee.profile.id),
    year
  );

  const requestRows: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];

  for (const employee of employees) {
    for (const block of employee.leaveBlocks) {
      const requestKey = `${employee.profile.id}:${block.startDate}:${block.endDate}:approved`;

      if (existingKeys.has(requestKey)) {
        continue;
      }

      requestRows.push({
        org_id: orgId,
        employee_id: employee.profile.id,
        leave_type: "annual_leave",
        start_date: block.startDate,
        end_date: block.endDate,
        total_days: block.totalDays,
        status: "approved",
        reason: IMPORT_REASON,
        approver_id: approverId
      });
    }
  }

  if (requestRows.length === 0) {
    return { insertedCount: 0 };
  }

  const { data: insertedRequests, error: insertError } = await client
    .from("leave_requests")
    .insert(requestRows)
    .select("id, employee_id, start_date, end_date, total_days");

  if (insertError) {
    throw new Error(`Unable to insert imported leave requests: ${insertError.message}`);
  }

  const employeeById = new Map(employees.map((employee) => [employee.profile.id, employee]));

  for (const request of insertedRequests ?? []) {
    const employee = employeeById.get(String(request.employee_id));

    auditRows.push({
      org_id: orgId,
      actor_user_id: approverId,
      action: "import",
      table_name: "leave_requests",
      record_id: request.id,
      old_value: null,
      new_value: {
        status: "approved",
        source: employee?.sourcePaths.map((sourcePath) => path.basename(sourcePath)) ?? [],
        imported_name: employee?.importedName ?? null,
        start_date: request.start_date,
        end_date: request.end_date,
        total_days: request.total_days
      }
    });
  }

  if (auditRows.length > 0) {
    const { error: auditError } = await client.from("audit_log").insert(auditRows);

    if (auditError) {
      throw new Error(`Unable to write audit log for imported leave: ${auditError.message}`);
    }
  }

  return { insertedCount: insertedRequests?.length ?? 0 };
}

async function reconcileAnnualLeaveBalances(
  client: SupabaseClient,
  orgId: string,
  profiles: ProfileRow[],
  year: number
) {
  const { data: policyRow, error: policyError } = await client
    .from("leave_policies")
    .select("default_days_per_year")
    .eq("org_id", orgId)
    .eq("leave_type", "annual_leave")
    .is("country_code", null)
    .is("deleted_at", null)
    .maybeSingle();

  if (policyError) {
    throw new Error(`Unable to load annual leave policy: ${policyError.message}`);
  }

  const defaultAnnualDays =
    parseNumeric(policyRow?.default_days_per_year ?? 0) || getDefaultDaysForLeaveType("annual_leave");

  const { data: balanceRows, error: balanceError } = await client
    .from("leave_balances")
    .select("employee_id, total_days, used_days, pending_days, carried_days")
    .eq("org_id", orgId)
    .eq("leave_type", "annual_leave")
    .eq("year", year)
    .is("deleted_at", null);

  if (balanceError) {
    throw new Error(`Unable to load annual leave balances: ${balanceError.message}`);
  }

  const { data: requestRows, error: requestError } = await client
    .from("leave_requests")
    .select("employee_id, total_days, status, leave_type")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("leave_type", ["annual_leave", "annual"])
    .gte("start_date", `${year}-01-01`)
    .lt("start_date", `${year + 1}-01-01`);

  if (requestError) {
    throw new Error(`Unable to load annual leave requests for reconciliation: ${requestError.message}`);
  }

  const balancesByEmployeeId = new Map(
    (balanceRows ?? []).map((row) => [
      String(row.employee_id),
      {
        totalDays: parseNumeric(row.total_days),
        carriedDays: parseNumeric(row.carried_days)
      }
    ])
  );

  const usageByEmployeeId = new Map<string, { usedDays: number; pendingDays: number }>();

  for (const request of requestRows ?? []) {
    const employeeId = String(request.employee_id);
    const current = usageByEmployeeId.get(employeeId) ?? { usedDays: 0, pendingDays: 0 };
    const totalDays = parseNumeric(request.total_days);

    if (request.status === "approved") {
      current.usedDays += totalDays;
    } else if (request.status === "pending") {
      current.pendingDays += totalDays;
    }

    usageByEmployeeId.set(employeeId, current);
  }

  const rowsToUpsert = profiles.map((profile) => {
    const existingBalance = balancesByEmployeeId.get(profile.id);
    const usage = usageByEmployeeId.get(profile.id) ?? { usedDays: 0, pendingDays: 0 };

    return {
      org_id: orgId,
      employee_id: profile.id,
      leave_type: "annual_leave",
      year,
      total_days: existingBalance?.totalDays || defaultAnnualDays,
      used_days: usage.usedDays,
      pending_days: usage.pendingDays,
      carried_days: existingBalance?.carriedDays ?? 0
    };
  });

  const { error: upsertError } = await client
    .from("leave_balances")
    .upsert(rowsToUpsert, { onConflict: "employee_id,leave_type,year" });

  if (upsertError) {
    throw new Error(`Unable to reconcile annual leave balances: ${upsertError.message}`);
  }
}

function describeImportedEmployees(employees: ResolvedImportedEmployee[]) {
  return employees.map((employee) => ({
    importedName: employee.importedName,
    profileName: employee.profile.full_name,
    email: employee.profile.email,
    countryCode: employee.profile.country_code,
    leaveBlockCount: employee.leaveBlocks.length,
    totalApprovedDays: employee.leaveBlocks.reduce((total, block) => total + block.totalDays, 0),
    leaveBlocks: employee.leaveBlocks
  }));
}

async function main() {
  const { apply, confirm, filePaths, orgEmail, targetEnv } = parseArgs(process.argv.slice(2));
  loadEnv(targetEnv);
  ensureSafeProjectTarget({ targetEnv, apply, confirm });
  const client = createServiceRoleClient();
  const anchorProfile = await getAnchorProfile(client, orgEmail);

  if (targetEnv === "production" && anchorProfile.org_id !== PRODUCTION_ORG_ID) {
    throw new Error(
      `Production org mismatch. Expected ${PRODUCTION_ORG_ID}, received ${anchorProfile.org_id}.`
    );
  }

  const profiles = await getOrgProfiles(client, anchorProfile.org_id);
  const workbooks = extractWorkbooks(filePaths);
  const importedEmployees = consolidateImportedEmployees(workbooks);
  const { resolved, missing } = resolveImportedEmployees(importedEmployees, profiles);
  const holidayDateKeysByCountry = await getHolidayDateKeysByCountry(client, anchorProfile.org_id);

  for (const employee of resolved) {
    const countryCode = (employee.profile.country_code ?? "NG").toUpperCase();
    const holidayDateKeys = holidayDateKeysByCountry.get(countryCode) ?? new Set<string>();
    const effectiveDates = applyManualDateRemovals(employee.profile, employee.dates);
    employee.leaveBlocks = buildLeaveBlocks(effectiveDates, holidayDateKeys);
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    targetEnv,
    orgId: anchorProfile.org_id,
    anchorEmail: orgEmail,
    workbookCount: workbooks.length,
    importedEmployeeCount: importedEmployees.length,
    matchedProfileCount: resolved.length,
    missingProfileCount: missing.length,
    missingProfiles: missing.map((employee) => ({
      importedName: employee.importedName,
      sourceFiles: employee.sourcePaths.map((sourcePath) => path.basename(sourcePath))
    })),
    employees: describeImportedEmployees(resolved)
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    return;
  }

  if (missing.length > 0) {
    throw new Error("Import aborted because one or more employees could not be matched to profiles.");
  }

  await ensureOrgWidePolicies(client, anchorProfile.org_id);
  await ensureHolidayCalendars(client, anchorProfile.org_id);
  await ensureFiniteBalances(client, anchorProfile.org_id, profiles, 2026);
  await softDeleteExistingImportedRequests(
    client,
    anchorProfile.org_id,
    resolved.map((employee) => employee.profile.id),
    2026
  );
  const insertResult = await insertImportedRequests(
    client,
    anchorProfile.id,
    anchorProfile.org_id,
    resolved,
    2026
  );
  await reconcileAnnualLeaveBalances(client, anchorProfile.org_id, profiles, 2026);

  console.log(
    JSON.stringify(
      {
        applied: true,
        insertedRequestCount: insertResult.insertedCount,
        reconciledProfileCount: profiles.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
