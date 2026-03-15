import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createNotification } from "../../../../../../lib/notifications/service";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

const cancelPayloadSchema = z.object({
  confirmName: z
    .string()
    .trim()
    .min(1, "You must type the employee name to confirm.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  request: Request,
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
        message: "Only Super Admin and HR Admin can cancel offboarding."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsedBody = cancelPayloadSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payload."
      },
      meta: buildMeta()
    });
  }

  const { id: employeeId } = await context.params;
  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch employee
  const { data: employee, error: fetchError } = await serviceClient
    .from("profiles")
    .select("id, full_name, status, manager_id, org_id")
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

  // Name confirmation
  if (employee.full_name !== parsedBody.data.confirmName) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "The name you entered does not match the employee name exactly."
      },
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

  // 1. Transition profile back to active, clear notice_period_end_date
  const { error: updateError } = await serviceClient
    .from("profiles")
    .update({
      status: "active",
      notice_period_end_date: null
    })
    .eq("id", employeeId)
    .eq("org_id", profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPDATE_FAILED", message: "Unable to update employee status." },
      meta: buildMeta()
    });
  }

  // 2. Cancel the active offboarding instance (preserve history)
  const { data: activeOffboarding } = await serviceClient
    .from("onboarding_instances")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("org_id", profile.org_id)
    .eq("type", "offboarding")
    .eq("status", "active")
    .maybeSingle();

  if (activeOffboarding) {
    await serviceClient
      .from("onboarding_instances")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activeOffboarding.id)
      .eq("org_id", profile.org_id);
  }

  // 3. Audit log
  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: employeeId,
    oldValue: { status: "offboarding" },
    newValue: { status: "active", reason: "offboarding_cancelled" }
  });

  // 4. Notifications
  const notifications = [
    {
      userId: employeeId,
      title: "Offboarding cancelled",
      body: "Your offboarding has been cancelled. You remain an active member of the team."
    }
  ];

  if (employee.manager_id && employee.manager_id !== profile.id) {
    notifications.push({
      userId: employee.manager_id,
      title: "Offboarding cancelled",
      body: `${employee.full_name}'s offboarding has been cancelled.`
    });
  }

  for (const notification of notifications) {
    await createNotification({
      orgId: profile.org_id,
      userId: notification.userId,
      type: "offboarding",
      title: notification.title,
      body: notification.body,
      link: `/people/${employeeId}`
    });
  }

  return jsonResponse<{ profileId: string; status: string }>(200, {
    data: { profileId: employeeId, status: "active" },
    error: null,
    meta: buildMeta()
  });
}
