/**
 * Reset database: remove all dummy seed data and add the real Accrue team.
 *
 * Preserves Zino's Super Admin account. Creates 34 real team members
 * with status "onboarding" so Zino can activate them from the People page.
 *
 * Usage:  npx tsx scripts/seed/reset-to-real-team.ts
 */

/* ── Production safety guard ── */
const _ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname.split(".")[0];
if (_ref === "xmeruhyybvyosqxfleiu") { console.error("ABORT: Seed scripts cannot run against production."); process.exit(1); }

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ── Helpers ── */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function createServiceRoleClient(): SupabaseClient {
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/* ── Real team member data ── */

type RealMember = {
  fullName: string;
  email: string;
  title: string;
  department: string | null;
  countryCode: string;
  timezone: string;
};

const REAL_MEMBERS: RealMember[] = [
  { fullName: "Adesuwa", email: "adesuwa@useaccrue.com", title: "Co-founder, Marketing", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Aishat Akintola", email: "aishat@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Alan", email: "alan@useaccrue.com", title: "Product Manager", department: "Product", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Alex Omenye", email: "alex@useaccrue.com", title: "Product Marketer", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Antoinette Atolagbe", email: "antoinette@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Chantal Kimbi", email: "kimbi@useaccrue.com", title: "Growth Associate", department: "Marketing & Growth", countryCode: "CM", timezone: "Africa/Douala" },
  { fullName: "Chiamaka Ewa", email: "chiamaka@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Clinton Mbah", email: "clinton@useaccrue.com", title: "Co-founder", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Emmanuella Wamba", email: "emmanuella@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Eniibukunoluwa Oyesanya", email: "eniibukun@useaccrue.com", title: "Operations Associate", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Esse Udubrah", email: "esse@useaccrue.com", title: "Marketing Strategist", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Essilfie", email: "essilfie@useaccrue.com", title: "Backend Engineer", department: "Engineering", countryCode: "GH", timezone: "Africa/Accra" },
  { fullName: "Favour Nnadi", email: "favour.n@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Felix Akinnibi", email: "felix@useaccrue.com", title: "SEO Specialist", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Flore Keugwa", email: "flore@useaccrue.com", title: "Content Creator", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Gabriel Owusu", email: "gabby@useaccrue.com", title: "Software Engineer", department: "Engineering", countryCode: "GH", timezone: "Africa/Accra" },
  { fullName: "Ifeanyi", email: "ifeanyi@useaccrue.com", title: "Software Engineer", department: "Engineering", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Joy Omoruyi", email: "joy@useaccrue.com", title: "Marketing and Operations Intern", department: "Marketing & Growth", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Melon Lagoye", email: "melon@useaccrue.com", title: "Growth Marketer", department: "Marketing & Growth", countryCode: "BJ", timezone: "Africa/Porto-Novo" },
  { fullName: "Nureni", email: "nureni@useaccrue.com", title: "Cashramp A-Z", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Ogochukwu Ozongwu", email: "ogochukwu@useaccrue.com", title: "Compliance Officer", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Oyinkansola King", email: "oyinkansola@useaccrue.com", title: "Finance Associate", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Raphaela Rockson", email: "raphaela@useaccrue.com", title: "Customer Success Deputy Lead", department: "Customer Success", countryCode: "GH", timezone: "Africa/Accra" },
  { fullName: "Rayo Ailara", email: "rayo@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Richard Adaramola", email: "richard@useaccrue.com", title: "Design Lead", department: "Design", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Seun Adesoye", email: "seun@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Shalewa Oseni", email: "shalewa@useaccrue.com", title: "Customer Success Lead", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Sonia Ezeribe", email: "sonia@useaccrue.com", title: "Growth Marketing Associate", department: "Marketing & Growth", countryCode: "BJ", timezone: "Africa/Porto-Novo" },
  { fullName: "Stephanie Anene", email: "stephanie@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Sydney Dapilah", email: "sydney@useaccrue.com", title: "Software Engineer", department: "Engineering", countryCode: "GH", timezone: "Africa/Accra" },
  { fullName: "Tema Omame", email: "tema@useaccrue.com", title: "Associate Product Designer", department: "Product", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Tunmise Falade", email: "tunmise@useaccrue.com", title: "Customer Success Associate", department: "Customer Success", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Victor Sanusi", email: "victor.s@useaccrue.com", title: "Software Engineer", department: "Engineering", countryCode: "NG", timezone: "Africa/Lagos" },
  { fullName: "Wasiu Adesina", email: "wasiu@useaccrue.com", title: "Reconciliation Analyst", department: "Operations", countryCode: "NG", timezone: "Africa/Lagos" }
];

/* ── Step 1: Find Zino (must exist) ── */

async function getZinoProfile(client: SupabaseClient): Promise<{ id: string; org_id: string }> {
  const { data, error } = await client
    .from("profiles")
    .select("id, org_id")
    .eq("email", "zino@useaccrue.com")
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new Error("ABORT: Zino's profile (zino@useaccrue.com) not found. Cannot proceed.");
  }

  return { id: data.id, org_id: data.org_id };
}

/* ── Step 2: Get dummy profile IDs (everyone except Zino) ── */

async function getDummyProfileIds(client: SupabaseClient, orgId: string, zinoId: string): Promise<string[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .neq("id", zinoId)
    .is("deleted_at", null);

  if (error) throw new Error(`Failed to query profiles: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/* ── Step 3: Delete all org-scoped data ── */

async function deleteOrgData(client: SupabaseClient, orgId: string): Promise<void> {
  // Helper: delete from a table by org_id, silently ignore if table is empty
  async function del(table: string): Promise<void> {
    const { error } = await client.from(table).delete().eq("org_id", orgId);
    if (error) {
      console.warn(`  Warning: ${table} delete failed: ${error.message}`);
    } else {
      console.log(`  Cleared ${table}`);
    }
  }

  console.log("\nDeleting all org-scoped data...");

  // Payroll chain (children first)
  await del("payment_ledger");
  await del("payslips");
  await del("payroll_items");
  await del("payment_batches");
  await del("payroll_runs");

  // Finance
  await del("expenses");
  await del("employee_payment_details");
  await del("compensation_band_assignments");
  await del("benchmark_data");
  await del("compensation_bands");
  await del("compensation_records");
  await del("allowances");
  await del("equity_grants");
  await del("deduction_rules");

  // Performance
  await del("review_responses");
  await del("review_assignments");
  await del("review_templates");
  await del("review_cycles");

  // Surveys
  await del("survey_responses");
  await del("surveys");

  // E-signatures
  await del("signature_events");
  await del("signature_signers");
  await del("signature_requests");

  // Learning
  await del("course_assignments");
  await del("courses");

  // Scheduling
  await del("shift_swaps");
  await del("shifts");
  await del("schedules");
  await del("shift_templates");

  // Time & Attendance
  await del("time_entries");
  await del("timesheets");
  await del("time_policies");

  // Onboarding
  await del("onboarding_tasks");
  await del("onboarding_instances");
  await del("onboarding_templates");

  // Time Off
  await del("leave_requests");
  await del("leave_balances");
  await del("leave_policies");
  await del("holiday_calendars");

  // Compliance
  await del("compliance_deadlines");
  await del("compliance_items");

  // Documents
  await del("document_versions");
  await del("documents");

  // Announcements (reads have no org_id — delete via parent IDs)
  const { data: announcementRows } = await client
    .from("announcements")
    .select("id")
    .eq("org_id", orgId);
  const announcementIds = (announcementRows ?? []).map((r: { id: string }) => r.id);
  if (announcementIds.length > 0) {
    await client.from("announcement_reads").delete().in("announcement_id", announcementIds);
    console.log("  Cleared announcement_reads");
  }
  await del("announcements");

  // Notifications, config, audit
  await del("notifications");
  await del("navigation_access_config");
  await del("dashboard_widget_config");
  await del("audit_log");
}

/* ── Step 4: Delete dummy profiles and auth users ── */

async function deleteDummyProfiles(
  client: SupabaseClient,
  dummyIds: string[]
): Promise<void> {
  if (dummyIds.length === 0) {
    console.log("\nNo dummy profiles to delete.");
    return;
  }

  console.log(`\nDeleting ${dummyIds.length} dummy profiles...`);

  // Clear self-referencing manager_id first
  const { error: managerError } = await client
    .from("profiles")
    .update({ manager_id: null })
    .in("id", dummyIds);
  if (managerError) console.warn(`  Warning: clearing manager_id failed: ${managerError.message}`);

  // Delete profiles
  const { error: profileError } = await client
    .from("profiles")
    .delete()
    .in("id", dummyIds);
  if (profileError) throw new Error(`Failed to delete profiles: ${profileError.message}`);
  console.log(`  Deleted ${dummyIds.length} profiles`);

  // Delete auth users
  let authDeleted = 0;
  for (const userId of dummyIds) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) {
      console.warn(`  Warning: failed to delete auth user ${userId}: ${error.message}`);
    } else {
      authDeleted++;
    }
  }
  console.log(`  Deleted ${authDeleted} auth users`);
}

/* ── Step 5: Create real team members ── */

async function createRealTeam(
  client: SupabaseClient,
  orgId: string,
  password: string
): Promise<number> {
  console.log("\nCreating real team members...");
  let created = 0;

  for (const member of REAL_MEMBERS) {
    const normalizedEmail = member.email.toLowerCase();

    // Check if profile already exists (e.g., re-run safety)
    const { data: existingProfile } = await client
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingProfile) {
      console.log(`  Skipping ${member.fullName} (${normalizedEmail}) — already exists`);
      continue;
    }

    // Create auth user
    const { data: authData, error: authError } = await client.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: member.fullName }
    });

    if (authError || !authData.user) {
      console.error(`  FAILED auth for ${member.fullName}: ${authError?.message ?? "no user returned"}`);
      continue;
    }

    const userId = authData.user.id;

    // Insert profile
    const { error: profileError } = await client.from("profiles").insert({
      id: userId,
      org_id: orgId,
      email: normalizedEmail,
      full_name: member.fullName,
      roles: ["EMPLOYEE"],
      department: member.department,
      title: member.title,
      country_code: member.countryCode,
      timezone: member.timezone,
      employment_type: "contractor",
      payroll_mode: "contractor_usd_no_withholding",
      primary_currency: "USD",
      status: "onboarding",
      manager_id: null,
      notification_preferences: {}
    });

    if (profileError) {
      console.error(`  FAILED profile for ${member.fullName}: ${profileError.message}`);
      // Rollback auth user
      await client.auth.admin.deleteUser(userId).catch(() => undefined);
      continue;
    }

    console.log(`  Created ${member.fullName} (${normalizedEmail})`);
    created++;
  }

  return created;
}

/* ── Main ── */

async function main() {
  const client = createServiceRoleClient();
  const password = process.env.SEED_TEST_PASSWORD ?? "CrewHub123!";

  console.log("=== Reset to Real Team ===\n");

  // Step 1: Find Zino
  const zino = await getZinoProfile(client);
  console.log(`Found Zino: ${zino.id} (org: ${zino.org_id})`);

  // Step 2: Get dummy profile IDs
  const dummyIds = await getDummyProfileIds(client, zino.org_id, zino.id);
  console.log(`Found ${dummyIds.length} non-Zino profiles to remove`);

  // Step 3: Delete all org data
  await deleteOrgData(client, zino.org_id);

  // Step 4: Delete dummy profiles + auth users
  await deleteDummyProfiles(client, dummyIds);

  // Step 5: Create real team
  const created = await createRealTeam(client, zino.org_id, password);

  console.log(`\n=== Done! Created ${created}/${REAL_MEMBERS.length} team members ===`);
  console.log(`Password for all: ${password}`);
  console.log("All members have status 'onboarding'. Use the People page to activate them.");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
