import { NextResponse } from "next/server";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logger } from "../../../../../../lib/logger";
import { completeOffboarding } from "../../../../../../lib/onboarding/auto-transition";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (
    !hasRole(profile.roles, "SUPER_ADMIN") &&
    !hasRole(profile.roles, "HR_ADMIN")
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin and HR Admin can finalise offboarding."
      },
      meta: buildMeta()
    });
  }

  const { id: employeeId } = await context.params;
  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch employee
  const { data: employee, error: fetchError } = await serviceClient
    .from("profiles")
    .select("id, full_name, status, notice_period_end_date, org_id")
    .eq("id", employeeId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !employee) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Employee not found." },
      meta: buildMeta()
    });
  }

  // Must be in offboarding status
  if (employee.status !== "offboarding") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "NOT_OFFBOARDING",
        message: "This employee is not currently being offboarded."
      },
      meta: buildMeta()
    });
  }

  // Gate 1: Check date — today >= notice_period_end_date
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const lastDay = employee.notice_period_end_date as string | null;

  if (!lastDay || today < lastDay) {
    const formattedDate = lastDay ?? "not set";
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "DATE_GATE_NOT_MET",
        message: `Cannot finalise before the last working day (${formattedDate}). Today is ${today}.`
      },
      meta: buildMeta()
    });
  }

  // Gate 2: Check all offboarding tasks are complete
  const { data: activeInstance } = await serviceClient
    .from("onboarding_instances")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("org_id", profile.org_id)
    .eq("type", "offboarding")
    .eq("status", "active")
    .maybeSingle();

  if (!activeInstance) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "NO_ACTIVE_INSTANCE",
        message: "No active offboarding instance found for this employee."
      },
      meta: buildMeta()
    });
  }

  // Query tasks from the onboarding_tasks table
  const { data: tasks } = await serviceClient
    .from("onboarding_tasks")
    .select("id, status")
    .eq("instance_id", activeInstance.id)
    .is("deleted_at", null);

  const allTasks = tasks ?? [];
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === "completed").length;

  if (totalTasks === 0 || completedTasks < totalTasks) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TASKS_INCOMPLETE",
        message: `Not all offboarding tasks are complete (${completedTasks}/${totalTasks}).`
      },
      meta: buildMeta()
    });
  }

  // Both gates passed — finalise
  try {
    await completeOffboarding({
      supabase: serviceClient,
      orgId: profile.org_id,
      instanceId: activeInstance.id,
      employeeId,
      employeeName: employee.full_name
    });

    await logAudit({
      action: "updated",
      tableName: "profiles",
      recordId: employeeId,
      oldValue: { status: "offboarding" },
      newValue: { status: "inactive" },
      userId: profile.id,
      orgId: profile.org_id,
      metadata: {
        trigger: "manual_finalise_offboarding",
        instanceId: activeInstance.id,
        employeeName: employee.full_name
      }
    });

    logger.info("Offboarding finalised manually.", {
      employeeId,
      instanceId: activeInstance.id,
      finalisedBy: profile.id
    });

    return jsonResponse<{ profileId: string; status: string }>(200, {
      data: { profileId: employeeId, status: "inactive" },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    logger.error("Failed to finalise offboarding.", {
      employeeId,
      instanceId: activeInstance.id,
      message: error instanceof Error ? error.message : String(error)
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "FINALISE_FAILED",
        message: "Unable to finalise offboarding. Please try again."
      },
      meta: buildMeta()
    });
  }
}
