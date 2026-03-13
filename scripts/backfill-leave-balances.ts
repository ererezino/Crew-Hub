/**
 * Post-migration leave balance backfill script.
 *
 * Runs once after the SQL migration (20260313200000_fix_preloaded_employee_status.sql)
 * to create leave balances for employees whose status was corrected from
 * "onboarding" to "active". These employees need leave balances because the
 * API's status-transition logic won't fire for them (they're already "active").
 *
 * Usage:
 *   npx tsx scripts/backfill-leave-balances.ts
 *
 * Idempotent: checks for existing balances before inserting.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const currentYear = new Date().getUTCFullYear();
  let checkedCount = 0;
  let createdCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  // Find all employees who were corrected by the migration:
  // status = 'active', were created via bulk_upload or isNewEmployee=false
  const { data: correctedEmployees, error: fetchError } = await supabase
    .from("profiles")
    .select("id, full_name, email, country_code, org_id")
    .eq("status", "active")
    .is("deleted_at", null);

  if (fetchError) {
    console.error("Failed to fetch profiles:", fetchError.message);
    process.exit(1);
  }

  if (!correctedEmployees || correctedEmployees.length === 0) {
    console.log("No active employees found. Nothing to do.");
    return;
  }

  // Filter to only those created via bulk_upload or isNewEmployee=false
  // (the ones corrected by our migration)
  const { data: auditRecords, error: auditError } = await supabase
    .from("audit_log")
    .select("record_id, new_value")
    .eq("action", "created")
    .eq("table_name", "profiles");

  if (auditError) {
    console.error("Failed to fetch audit records:", auditError.message);
    process.exit(1);
  }

  const correctedIds = new Set<string>();
  for (const record of auditRecords ?? []) {
    const nv = record.new_value as Record<string, unknown> | null;
    if (!nv) continue;
    if (
      nv.source === "bulk_upload" ||
      String(nv.isNewEmployee) === "false"
    ) {
      correctedIds.add(record.record_id);
    }
  }

  const targetEmployees = correctedEmployees.filter((e) =>
    correctedIds.has(e.id)
  );

  console.log(
    `Found ${targetEmployees.length} corrected employees to check for leave balances.`
  );

  for (const employee of targetEmployees) {
    checkedCount++;

    if (!employee.country_code) {
      console.log(
        `  SKIP ${employee.full_name} (${employee.email}): no country_code`
      );
      skippedCount++;
      continue;
    }

    // Fetch leave policies for this employee's country
    const { data: policies, error: policyError } = await supabase
      .from("leave_policies")
      .select("leave_type, default_days_per_year, is_unlimited")
      .eq("org_id", employee.org_id)
      .eq("country_code", employee.country_code)
      .is("deleted_at", null);

    if (policyError) {
      const msg = `  ERROR ${employee.full_name}: failed to fetch policies - ${policyError.message}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    // Filter: skip unlimited and unpaid_personal_day (same logic as API)
    const balanceTypes = (policies ?? []).filter(
      (p) => !p.is_unlimited && p.leave_type !== "unpaid_personal_day"
    );

    if (balanceTypes.length === 0) {
      console.log(
        `  SKIP ${employee.full_name} (${employee.email}): no applicable leave policies for ${employee.country_code}`
      );
      skippedCount++;
      continue;
    }

    for (const policy of balanceTypes) {
      // Check if balance already exists (idempotent)
      const { data: existingBalance } = await supabase
        .from("leave_balances")
        .select("id")
        .eq("org_id", employee.org_id)
        .eq("employee_id", employee.id)
        .eq("year", currentYear)
        .eq("leave_type", policy.leave_type)
        .is("deleted_at", null)
        .maybeSingle();

      if (existingBalance) {
        continue; // Already exists, skip
      }

      // Determine total days (same logic as API lines 643-654)
      let totalDays = policy.leave_type === "annual_leave" ? 20 : 5;

      if (policy.default_days_per_year) {
        const policyDays =
          typeof policy.default_days_per_year === "string"
            ? Number.parseFloat(policy.default_days_per_year)
            : (policy.default_days_per_year as number);

        if (Number.isFinite(policyDays) && policyDays > 0) {
          totalDays = policyDays;
        }
      }

      const { error: insertError } = await supabase
        .from("leave_balances")
        .insert({
          org_id: employee.org_id,
          employee_id: employee.id,
          leave_type: policy.leave_type,
          year: currentYear,
          total_days: totalDays,
          used_days: 0,
          pending_days: 0,
          carried_days: 0,
        });

      if (insertError) {
        const msg = `  ERROR ${employee.full_name}: failed to create ${policy.leave_type} balance - ${insertError.message}`;
        console.error(msg);
        errors.push(msg);
      } else {
        createdCount++;
        console.log(
          `  CREATED ${employee.full_name}: ${policy.leave_type} = ${totalDays} days`
        );
      }
    }
  }

  console.log("\n--- Leave Balance Backfill Summary ---");
  console.log(`Employees checked: ${checkedCount}`);
  console.log(`Leave balances created: ${createdCount}`);
  console.log(`Employees skipped: ${skippedCount}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nError details:");
    for (const err of errors) {
      console.log(err);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
