/**
 * Seed leave calendar data extracted from Accrue Leave Calendar Excel files.
 *
 * Populates:
 * - leave_policies  (annual_leave, sick_leave, personal_day, birthday_leave, unpaid_personal_day for NG, GH, CM)
 * - holiday_calendars (public holidays for 2026)
 * - leave_requests  (approved leave blocks + sample sick leave per employee)
 * - leave_balances  (annual_leave, personal_day, birthday_leave for 2026)
 * - profiles        (date_of_birth for all employees)
 * - afk_logs        (sample AFK entries)
 *
 * Usage:  npx tsx scripts/seed/seed-leave-calendar.ts
 */

/* ── Production safety guard ── */
const _ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname.split(".")[0];
if (_ref === "xmeruhyybvyosqxfleiu") { console.error("ABORT: Seed scripts cannot run against production."); process.exit(1); }

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ── Helpers ── */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing: ${name}`);
  return value;
}

function createServiceRoleClient(): SupabaseClient {
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Group sorted ISO date strings into consecutive blocks (for leave_requests). */
function groupConsecutiveDates(dates: string[]): { startDate: string; endDate: string; totalDays: number }[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const blocks: { startDate: string; endDate: string; totalDays: number }[] = [];
  let blockStart = sorted[0]!;
  let blockEnd = sorted[0]!;
  let blockDays = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(blockEnd + "T00:00:00Z");
    const curr = new Date(sorted[i]! + "T00:00:00Z");
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Allow gaps of 1-2 days for weekends bridging consecutive workdays
    if (diffDays <= 3) {
      blockEnd = sorted[i]!;
      blockDays++;
    } else {
      blocks.push({ startDate: blockStart, endDate: blockEnd, totalDays: blockDays });
      blockStart = sorted[i]!;
      blockEnd = sorted[i]!;
      blockDays = 1;
    }
  }
  blocks.push({ startDate: blockStart, endDate: blockEnd, totalDays: blockDays });
  return blocks;
}

/* ── Employee leave data (extracted from Excel, weekdays only) ── */

type EmployeeLeave = { email: string; leaveDates: string[] };

const EMPLOYEE_LEAVE: EmployeeLeave[] = [
  { email: "adesuwa@useaccrue.com", leaveDates: ["2026-03-24","2026-03-25","2026-03-26","2026-05-04","2026-05-05","2026-05-06","2026-05-07","2026-05-08","2026-05-11","2026-05-12","2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-03","2026-09-28","2026-09-29","2026-09-30","2026-10-02","2026-10-05"] },
  { email: "zino@useaccrue.com", leaveDates: ["2026-03-24","2026-03-25","2026-03-26","2026-03-27"] },
  { email: "richard@useaccrue.com", leaveDates: ["2026-02-12","2026-02-13","2026-05-21","2026-06-25","2026-06-26","2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-10-19","2026-10-20","2026-10-21","2026-10-22","2026-10-23","2026-12-07","2026-12-08","2026-12-09","2026-12-10","2026-12-11"] },
  { email: "tema@useaccrue.com", leaveDates: ["2026-03-30","2026-03-31","2026-04-01","2026-04-02","2026-04-29","2026-04-30","2026-05-14","2026-05-15","2026-07-10","2026-07-13","2026-07-14","2026-07-15","2026-07-16","2026-07-17","2026-10-08","2026-10-09","2026-12-14","2026-12-15","2026-12-16","2026-12-17","2026-12-18"] },
  { email: "esse@useaccrue.com", leaveDates: ["2026-02-19","2026-02-20","2026-02-23","2026-04-20","2026-04-21","2026-04-22","2026-04-23","2026-04-24","2026-06-15","2026-06-16","2026-06-17","2026-07-23","2026-07-24","2026-08-03","2026-09-07","2026-09-08","2026-10-16","2026-11-12","2026-11-13","2026-12-11"] },
  { email: "alex@useaccrue.com", leaveDates: ["2026-02-11","2026-02-12","2026-02-13","2026-04-20","2026-04-21","2026-04-22","2026-04-23","2026-04-24","2026-06-22","2026-06-23","2026-06-24","2026-07-15","2026-08-03","2026-08-04","2026-08-05","2026-09-14","2026-09-15","2026-10-02","2026-11-16","2026-11-17"] },
  { email: "felix@useaccrue.com", leaveDates: ["2026-02-26","2026-02-27","2026-03-26","2026-03-27","2026-04-23","2026-04-24","2026-05-28","2026-05-29","2026-06-25","2026-06-26","2026-07-27","2026-07-30","2026-07-31","2026-08-27","2026-08-28","2026-09-23","2026-09-24","2026-10-29","2026-10-30","2026-11-26","2026-11-27"] },
  { email: "nureni@useaccrue.com", leaveDates: ["2026-08-24","2026-08-25","2026-08-26","2026-08-27","2026-08-28","2026-08-31","2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13"] },
  { email: "ifeanyi@useaccrue.com", leaveDates: ["2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30"] },
  { email: "victor.s@useaccrue.com", leaveDates: ["2026-03-13","2026-03-16","2026-03-17","2026-03-18","2026-03-19","2026-05-04","2026-05-05","2026-05-06","2026-05-07","2026-05-08","2026-08-14","2026-08-17","2026-08-18","2026-08-19","2026-10-02","2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09"] },
  { email: "gabby@useaccrue.com", leaveDates: ["2026-03-24","2026-03-25","2026-03-26","2026-03-27","2026-03-30","2026-03-31","2026-04-01","2026-04-02","2026-04-07","2026-04-08","2026-04-09","2026-04-10","2026-04-13","2026-04-14","2026-04-15","2026-04-16","2026-04-17"] },
  { email: "essilfie@useaccrue.com", leaveDates: ["2026-01-16","2026-02-20","2026-02-23"] },
  { email: "shalewa@useaccrue.com", leaveDates: ["2026-03-24","2026-03-25","2026-03-26","2026-03-27","2026-03-30","2026-05-11","2026-05-12","2026-05-13","2026-05-14","2026-05-15","2026-09-07","2026-09-08","2026-09-09","2026-09-10","2026-09-11"] },
  { email: "raphaela@useaccrue.com", leaveDates: ["2026-03-16","2026-03-17","2026-03-18","2026-03-19","2026-06-15","2026-06-16","2026-06-17","2026-06-18","2026-06-19","2026-09-14","2026-09-15","2026-09-16","2026-09-17","2026-09-18","2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"] },
  { email: "rayo@useaccrue.com", leaveDates: ["2026-04-07","2026-04-08","2026-04-09","2026-04-10","2026-04-13","2026-07-22","2026-07-23","2026-07-24","2026-07-27","2026-07-28","2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-16","2026-11-20"] },
  { email: "antoinette@useaccrue.com", leaveDates: ["2026-07-30","2026-08-31","2026-09-01","2026-09-02","2026-09-03","2026-12-03","2026-12-04","2026-12-07","2026-12-08","2026-12-09","2026-12-15"] },
  { email: "favour.n@useaccrue.com", leaveDates: ["2026-03-24","2026-03-25","2026-03-26","2026-03-27","2026-03-30","2026-06-22","2026-06-23","2026-06-24","2026-06-25","2026-06-26","2026-07-13","2026-07-14","2026-07-15","2026-07-16","2026-07-17","2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06"] },
  { email: "stephanie@useaccrue.com", leaveDates: ["2026-02-10","2026-02-11","2026-02-12","2026-02-13","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-06-29","2026-06-30","2026-07-01","2026-07-02","2026-07-03","2026-07-06","2026-10-07","2026-10-08","2026-10-09","2026-10-12","2026-10-13","2026-10-14"] },
  { email: "seun@useaccrue.com", leaveDates: ["2026-03-05","2026-03-06","2026-03-09","2026-03-10","2026-03-11","2026-05-26","2026-05-27","2026-05-28","2026-05-29","2026-06-03","2026-06-04","2026-06-05","2026-08-24","2026-08-25","2026-08-26","2026-08-27","2026-08-28","2026-11-17","2026-11-18","2026-11-19","2026-11-20"] },
  { email: "chiamaka@useaccrue.com", leaveDates: ["2026-04-23","2026-04-24","2026-04-25","2026-04-26","2026-04-27","2026-04-28","2026-04-29","2026-04-30","2026-08-10","2026-08-11","2026-08-12","2026-08-13","2026-08-14","2026-08-15","2026-08-16","2026-08-17","2026-08-18","2026-12-10","2026-12-11","2026-12-14","2026-12-15","2026-12-16","2026-12-17","2026-12-18"] },
  { email: "aishat@useaccrue.com", leaveDates: ["2026-02-23","2026-02-24","2026-02-25","2026-02-26","2026-02-27","2026-02-28","2026-03-01","2026-04-15","2026-04-16","2026-04-17","2026-04-18","2026-04-19","2026-04-20","2026-04-21","2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-06-12","2026-06-13","2026-06-14","2026-09-26","2026-09-27","2026-09-28","2026-09-29"] },
  { email: "tunmise@useaccrue.com", leaveDates: ["2026-02-03","2026-02-04","2026-02-05","2026-02-06","2026-02-07","2026-02-08","2026-02-09","2026-05-20","2026-05-21","2026-05-22","2026-05-23","2026-05-24","2026-05-25","2026-08-05","2026-08-06","2026-08-07","2026-08-08","2026-08-09","2026-11-07","2026-11-08","2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13"] },
];

/* ── Public holidays (extracted from Excel) ── */

type Holiday = { date: string; name: string; countryCodes: string[] };

const HOLIDAYS: Holiday[] = [
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
  { date: "2026-12-25", name: "Christmas Day", countryCodes: ["NG", "GH", "CM"] },
];

/* ── Employee dates of birth ── */

const EMAIL_TO_DOB: Record<string, string> = {
  "clinton@useaccrue.com": "1993-06-15",
  "adesuwa@useaccrue.com": "1995-11-22",
  "zino@useaccrue.com": "1994-09-10",
  "richard@useaccrue.com": "1996-01-28",
  "tema@useaccrue.com": "1997-04-03",
  "alan@useaccrue.com": "1992-12-19",
  "esse@useaccrue.com": "1998-07-14",
  "alex@useaccrue.com": "1995-02-08",
  "felix@useaccrue.com": "1996-10-31",
  "nureni@useaccrue.com": "1994-08-17",
  "kimbi@useaccrue.com": "1997-03-05",
  "flore@useaccrue.com": "1993-05-23",
  "melon@useaccrue.com": "1999-01-12",
  "ifeanyi@useaccrue.com": "1996-06-30",
  "victor.s@useaccrue.com": "1995-09-02",
  "gabby@useaccrue.com": "1994-11-18",
  "essilfie@useaccrue.com": "1997-07-25",
  "sydney@useaccrue.com": "1998-04-14",
  "shalewa@useaccrue.com": "1996-12-01",
  "raphaela@useaccrue.com": "1995-08-09",
  "rayo@useaccrue.com": "1997-02-27",
  "antoinette@useaccrue.com": "1994-10-05",
  "favour.n@useaccrue.com": "1998-03-16",
  "stephanie@useaccrue.com": "1996-06-22",
  "seun@useaccrue.com": "1995-01-30",
  "chiamaka@useaccrue.com": "1997-11-11",
  "aishat@useaccrue.com": "1996-05-19",
  "tunmise@useaccrue.com": "1998-09-07",
};

/* ── Sample sick leave requests ── */

type SickLeaveEntry = { email: string; startDate: string; endDate: string; totalDays: number };

const SAMPLE_SICK_LEAVE: SickLeaveEntry[] = [
  { email: "esse@useaccrue.com", startDate: "2026-01-19", endDate: "2026-01-19", totalDays: 1 },
  { email: "nureni@useaccrue.com", startDate: "2026-02-09", endDate: "2026-02-11", totalDays: 3 },
  { email: "favour.n@useaccrue.com", startDate: "2026-01-26", endDate: "2026-01-26", totalDays: 1 },
  { email: "stephanie@useaccrue.com", startDate: "2026-02-02", endDate: "2026-02-03", totalDays: 2 },
];

/* ── Sample AFK log entries ── */

type AfkEntry = { email: string; date: string; startTime: string; endTime: string; notes: string };

const SAMPLE_AFK_LOGS: AfkEntry[] = [
  { email: "zino@useaccrue.com", date: "2026-03-02", startTime: "10:30", endTime: "11:15", notes: "Doctor appointment" },
  { email: "adesuwa@useaccrue.com", date: "2026-03-03", startTime: "14:00", endTime: "15:00", notes: "Bank errand" },
  { email: "richard@useaccrue.com", date: "2026-03-02", startTime: "09:00", endTime: "09:45", notes: "School drop-off" },
];

/* ── Leave policy definitions ── */

type PolicyDef = {
  leaveType: string;
  defaultDaysPerYear: number;
  accrualType: string;
  isUnlimited: boolean;
  carryOver: boolean;
  notes: string;
};

const POLICY_DEFS: PolicyDef[] = [
  { leaveType: "annual_leave", defaultDaysPerYear: 20, accrualType: "annual_upfront", isUnlimited: false, carryOver: false, notes: "Standard 20-day annual leave policy" },
  { leaveType: "sick_leave", defaultDaysPerYear: 0, accrualType: "manual", isUnlimited: true, carryOver: false, notes: "Unlimited sick leave. Doctor's note required after 2 consecutive working days." },
  { leaveType: "personal_day", defaultDaysPerYear: 5, accrualType: "annual_upfront", isUnlimited: false, carryOver: false, notes: "5 personal days per year for non-leisure obligations" },
  { leaveType: "birthday_leave", defaultDaysPerYear: 1, accrualType: "annual_upfront", isUnlimited: false, carryOver: false, notes: "1 day auto-granted on or near birthday" },
  { leaveType: "unpaid_personal_day", defaultDaysPerYear: 5, accrualType: "annual_upfront", isUnlimited: false, carryOver: false, notes: "Probation-only unpaid personal days" },
];

/* ── Main ── */

async function main() {
  const client = createServiceRoleClient();

  console.log("=== Seeding Leave Calendar Data ===\n");

  // 1. Get org_id from Zino's profile
  const { data: zino, error: zinoErr } = await client
    .from("profiles")
    .select("id, org_id")
    .eq("email", "zino@useaccrue.com")
    .is("deleted_at", null)
    .single();
  if (zinoErr || !zino) throw new Error("Zino's profile not found.");
  const orgId = zino.org_id;
  console.log(`Org ID: ${orgId}`);

  // 2. Look up all profile IDs by email
  const { data: profiles, error: profErr } = await client
    .from("profiles")
    .select("id, email, full_name, country_code")
    .eq("org_id", orgId)
    .is("deleted_at", null);
  if (profErr) throw new Error(`Failed to fetch profiles: ${profErr.message}`);

  const emailToProfile = new Map<string, { id: string; fullName: string; countryCode: string }>();
  for (const p of profiles ?? []) {
    emailToProfile.set(p.email, { id: p.id, fullName: p.full_name, countryCode: p.country_code ?? "NG" });
  }

  // 3. Clear existing leave data for this org (idempotent re-run)
  console.log("\nClearing existing leave data...");
  for (const table of ["afk_logs", "leave_requests", "leave_balances", "leave_policies", "holiday_calendars"]) {
    const { error } = await client.from(table).delete().eq("org_id", orgId);
    if (error) console.warn(`  Warning: ${table}: ${error.message}`);
    else console.log(`  Cleared ${table}`);
  }

  // 3b. Update profiles with date_of_birth
  console.log("\nUpdating profiles with date_of_birth...");
  let dobCount = 0;
  for (const [email, dob] of Object.entries(EMAIL_TO_DOB)) {
    const profile = emailToProfile.get(email);
    if (!profile) continue;
    const { error: dobErr } = await client
      .from("profiles")
      .update({ date_of_birth: dob })
      .eq("id", profile.id)
      .eq("org_id", orgId);
    if (dobErr) console.warn(`  DOB error for ${email}: ${dobErr.message}`);
    else dobCount++;
  }
  console.log(`  Updated ${dobCount} profiles with DOB`);

  // 4. Insert leave policies (all 5 types for each country)
  console.log("\nInserting leave policies...");
  const countryCodes = ["NG", "GH", "CM"];
  const policies: Array<Record<string, unknown>> = [];
  for (const cc of countryCodes) {
    for (const def of POLICY_DEFS) {
      policies.push({
        org_id: orgId,
        country_code: cc,
        leave_type: def.leaveType,
        default_days_per_year: def.defaultDaysPerYear,
        accrual_type: def.accrualType,
        is_unlimited: def.isUnlimited,
        carry_over: def.carryOver,
        notes: def.notes,
      });
    }
  }
  const { error: policyErr } = await client.from("leave_policies").insert(policies);
  if (policyErr) console.error(`  Leave policies error: ${policyErr.message}`);
  else console.log(`  Inserted ${policies.length} leave policies`);

  // 5. Insert holiday calendars
  console.log("\nInserting public holidays...");
  const holidayRows: Array<Record<string, unknown>> = [];
  for (const h of HOLIDAYS) {
    for (const cc of h.countryCodes) {
      holidayRows.push({
        org_id: orgId,
        country_code: cc,
        date: h.date,
        name: h.name,
        year: 2026,
      });
    }
  }
  const { error: holErr } = await client.from("holiday_calendars").insert(holidayRows);
  if (holErr) console.error(`  Holidays error: ${holErr.message}`);
  else console.log(`  Inserted ${holidayRows.length} holiday entries`);

  // 6. Insert leave balances and requests for each employee
  console.log("\nInserting leave balances and requests...");
  let balanceCount = 0;
  let requestCount = 0;

  // Split leave dates into past (used) vs future (pending/scheduled)
  const todayStr = todayIso();

  // Create balances for ALL employees, not just those with leave
  for (const p of profiles ?? []) {
    const leaveEntry = EMPLOYEE_LEAVE.find((e) => e.email === p.email);
    const workdayLeaves = leaveEntry
      ? leaveEntry.leaveDates.filter((d) => !isWeekend(d))
      : [];
    const pastLeaves = workdayLeaves.filter((d) => d < todayStr);
    const futureLeaves = workdayLeaves.filter((d) => d >= todayStr);

    // Insert balance: past dates = used, future dates = pending (scheduled)
    const { error: balErr } = await client.from("leave_balances").insert({
      org_id: orgId,
      employee_id: p.id,
      leave_type: "annual_leave",
      year: 2026,
      total_days: 20,
      used_days: pastLeaves.length,
      pending_days: futureLeaves.length,
      carried_days: 0,
    });
    if (balErr) {
      console.warn(`  Balance error for ${p.full_name}: ${balErr.message}`);
    } else {
      balanceCount++;
    }

    // Insert leave requests (grouped into blocks)
    if (workdayLeaves.length > 0) {
      const blocks = groupConsecutiveDates(workdayLeaves);
      for (const block of blocks) {
        const { error: reqErr } = await client.from("leave_requests").insert({
          org_id: orgId,
          employee_id: p.id,
          leave_type: "annual_leave",
          start_date: block.startDate,
          end_date: block.endDate,
          total_days: block.totalDays,
          status: "approved",
          reason: "Leave from calendar",
          approver_id: zino.id,
        });
        if (reqErr) {
          console.warn(`  Request error for ${p.full_name}: ${reqErr.message}`);
        } else {
          requestCount++;
        }
      }
    }
  }

  console.log(`  Inserted ${balanceCount} annual leave balances`);
  console.log(`  Inserted ${requestCount} leave requests`);

  // 7. Insert personal_day and birthday_leave balances for all employees
  console.log("\nInserting personal_day and birthday_leave balances...");
  let extraBalanceCount = 0;
  for (const p of profiles ?? []) {
    // Personal day: 5 days total, 0 used
    const { error: pdErr } = await client.from("leave_balances").insert({
      org_id: orgId,
      employee_id: p.id,
      leave_type: "personal_day",
      year: 2026,
      total_days: 5,
      used_days: 0,
      pending_days: 0,
      carried_days: 0,
    });
    if (pdErr) console.warn(`  personal_day balance error for ${p.full_name}: ${pdErr.message}`);
    else extraBalanceCount++;

    // Birthday leave: 1 day total, 0 used
    const { error: bdErr } = await client.from("leave_balances").insert({
      org_id: orgId,
      employee_id: p.id,
      leave_type: "birthday_leave",
      year: 2026,
      total_days: 1,
      used_days: 0,
      pending_days: 0,
      carried_days: 0,
    });
    if (bdErr) console.warn(`  birthday_leave balance error for ${p.full_name}: ${bdErr.message}`);
    else extraBalanceCount++;
  }
  console.log(`  Inserted ${extraBalanceCount} extra balances (personal_day + birthday_leave)`);

  // 8. Insert sample sick leave requests (no balance tracking)
  console.log("\nInserting sample sick leave requests...");
  let sickCount = 0;
  for (const entry of SAMPLE_SICK_LEAVE) {
    const profile = emailToProfile.get(entry.email);
    if (!profile) continue;
    const { error: sickErr } = await client.from("leave_requests").insert({
      org_id: orgId,
      employee_id: profile.id,
      leave_type: "sick_leave",
      start_date: entry.startDate,
      end_date: entry.endDate,
      total_days: entry.totalDays,
      status: "approved",
      reason: "Sick leave",
      approver_id: zino.id,
      requires_documentation: entry.totalDays > 2,
    });
    if (sickErr) console.warn(`  Sick leave error for ${entry.email}: ${sickErr.message}`);
    else sickCount++;
  }
  console.log(`  Inserted ${sickCount} sick leave requests`);

  // 9. Insert sample AFK log entries
  console.log("\nInserting sample AFK logs...");
  let afkCount = 0;
  for (const entry of SAMPLE_AFK_LOGS) {
    const profile = emailToProfile.get(entry.email);
    if (!profile) continue;
    const [sh, sm] = entry.startTime.split(":").map(Number);
    const [eh, em] = entry.endTime.split(":").map(Number);
    const durationMinutes = ((eh ?? 0) * 60 + (em ?? 0)) - ((sh ?? 0) * 60 + (sm ?? 0));

    const { error: afkErr } = await client.from("afk_logs").insert({
      org_id: orgId,
      employee_id: profile.id,
      date: entry.date,
      start_time: entry.startTime,
      end_time: entry.endTime,
      duration_minutes: durationMinutes,
      notes: entry.notes,
    });
    if (afkErr) console.warn(`  AFK log error for ${entry.email}: ${afkErr.message}`);
    else afkCount++;
  }
  console.log(`  Inserted ${afkCount} AFK log entries`);

  console.log("\n=== Done! ===");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
