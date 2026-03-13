import type { SupabaseClient } from "@supabase/supabase-js";

import { logAudit } from "../audit";
import { logger } from "../logger";
import { createNotification } from "../notifications/service";

/**
 * Auto-create leave balances for an employee when they transition to "active".
 * Non-blocking: logs errors but never throws.
 */
export async function createLeaveBalancesForActivation({
  supabase,
  orgId,
  employeeId,
  countryCode
}: {
  supabase: SupabaseClient;
  orgId: string;
  employeeId: string;
  countryCode: string | null;
}): Promise<void> {
  try {
    const currentYear = new Date().getUTCFullYear();

    const { data: policies } = await supabase
      .from("leave_policies")
      .select("leave_type, default_days_per_year, is_unlimited")
      .eq("org_id", orgId)
      .eq("country_code", countryCode ?? "")
      .is("deleted_at", null);

    const balanceTypes = (policies ?? []).filter(
      (p: { is_unlimited: boolean; leave_type: string }) =>
        !p.is_unlimited && p.leave_type !== "unpaid_personal_day"
    );

    for (const policy of balanceTypes) {
      const { data: existingBalance } = await supabase
        .from("leave_balances")
        .select("id")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("year", currentYear)
        .eq("leave_type", policy.leave_type)
        .is("deleted_at", null)
        .maybeSingle();

      if (!existingBalance) {
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

        const { error: balanceError } = await supabase
          .from("leave_balances")
          .insert({
            org_id: orgId,
            employee_id: employeeId,
            leave_type: policy.leave_type,
            year: currentYear,
            total_days: totalDays,
            used_days: 0,
            pending_days: 0,
            carried_days: 0
          });

        if (balanceError) {
          logger.error("Unable to auto-create leave balance on activation.", {
            employeeId,
            leaveType: policy.leave_type,
            year: currentYear,
            message: balanceError.message
          });
        }
      }
    }
  } catch (error) {
    logger.error("Leave balance auto-creation failed (non-blocking).", {
      employeeId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Handle onboarding completion: transition employee to active,
 * create leave balances, and send notifications.
 * Called when both employee and operations tracks reach 100%.
 */
export async function completeOnboarding({
  supabase,
  orgId,
  instanceId,
  employeeId,
  employeeName
}: {
  supabase: SupabaseClient;
  orgId: string;
  instanceId: string;
  employeeId: string;
  employeeName?: string;
}): Promise<void> {
  // 1. Mark instance as completed
  const { error: instanceUpdateError } = await supabase
    .from("onboarding_instances")
    .update({
      status: "completed",
      completed_at: new Date().toISOString()
    })
    .eq("id", instanceId)
    .eq("org_id", orgId);

  if (instanceUpdateError) {
    logger.error("Failed to mark onboarding instance as completed.", {
      error: instanceUpdateError.message,
      instanceId
    });
  }

  // 2. Transition profile from onboarding → active
  const { data: updatedProfile, error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ status: "active" })
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .eq("status", "onboarding")
    .select("country_code")
    .maybeSingle();

  if (profileUpdateError) {
    logger.error("Failed to transition employee to active.", {
      error: profileUpdateError.message,
      employeeId,
      instanceId
    });
  } else if (updatedProfile) {
    logger.info("Employee transitioned to active after onboarding completion.", {
      employeeId,
      instanceId
    });

    await logAudit({
      action: "updated",
      tableName: "profiles",
      recordId: employeeId,
      oldValue: { status: "onboarding" },
      newValue: { status: "active" }
    }).catch(() => {});

    // 3. Create leave balances
    await createLeaveBalancesForActivation({
      supabase,
      orgId,
      employeeId,
      countryCode: updatedProfile.country_code
    });
  }

  // 4. Send completion notifications
  const name = employeeName ?? "Employee";

  await createNotification({
    orgId,
    userId: employeeId,
    type: "onboarding_task",
    title: "Onboarding complete! 🎉",
    body: `Congratulations, ${name}! Your onboarding is complete. Welcome to the team!`,
    link: "/me/onboarding"
  }).catch(() => {});
}
