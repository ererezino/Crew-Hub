import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logger } from "../../../../../../lib/logger";
import { createNotification } from "../../../../../../lib/notifications/service";
import { createOnboardingInstance } from "../../../../../../lib/onboarding/create-instance";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

const DEPARTURE_REASONS = [
  "resignation",
  "redundancy",
  "performance",
  "contract_end",
  "other"
] as const;

const offboardPayloadSchema = z.object({
  lastWorkingDay: z
    .string()
    .trim()
    .refine(
      (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
      "Last working day must be a valid date in YYYY-MM-DD format."
    ),
  reason: z.enum(DEPARTURE_REASONS, {
    message: "Select a valid reason for departure."
  }),
  confirmName: z
    .string()
    .trim()
    .min(1, "You must type the employee name to confirm.")
});

type OffboardResponseData = {
  profileId: string;
  instanceId: string | null;
  status: string;
};

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
        message: "Only Super Admin and HR Admin can initiate offboarding."
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

  const parsedBody = offboardPayloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid offboard payload."
      },
      meta: buildMeta()
    });
  }

  const { id: employeeId } = await context.params;

  if (!employeeId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Employee id is required." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch employee profile
  const { data: rawEmployee, error: employeeError } = await serviceClient
    .from("profiles")
    .select("id, full_name, status, country_code, department, manager_id, org_id")
    .eq("id", employeeId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (employeeError || !rawEmployee) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Employee not found." },
      meta: buildMeta()
    });
  }

  // Exact name match validation
  if (rawEmployee.full_name !== parsedBody.data.confirmName) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "The name you entered does not match the employee name exactly."
      },
      meta: buildMeta()
    });
  }

  // Prevent re-offboarding
  if (rawEmployee.status === "offboarding") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "ALREADY_OFFBOARDING",
        message: "This employee is already being offboarded."
      },
      meta: buildMeta()
    });
  }

  const oldStatus = rawEmployee.status;

  // Update profile: status = offboarding, notice_period_end_date
  const { error: updateError } = await serviceClient
    .from("profiles")
    .update({
      status: "offboarding",
      notice_period_end_date: parsedBody.data.lastWorkingDay
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

  // Cancel any active onboarding instance before creating offboarding
  const { data: activeOnboarding } = await serviceClient
    .from("onboarding_instances")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("org_id", profile.org_id)
    .eq("type", "onboarding")
    .eq("status", "active")
    .maybeSingle();

  if (activeOnboarding) {
    await serviceClient
      .from("onboarding_instances")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activeOnboarding.id)
      .eq("org_id", profile.org_id);

    await logAudit({
      action: "updated",
      tableName: "onboarding_instances",
      recordId: activeOnboarding.id,
      oldValue: { status: "active" },
      newValue: { status: "cancelled", reason: "offboarding_initiated" }
    }).catch(() => {});
  }

  // Find offboarding template
  let offboardTemplate: {
    id: string;
    name: string;
    type: "onboarding" | "offboarding";
    tasks: unknown;
  } | null = null;

  // 1. Org-specific offboarding template
  if (rawEmployee.department) {
    const { data: orgTemplate } = await serviceClient
      .from("onboarding_templates")
      .select("id, name, type, tasks")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .eq("type", "offboarding")
      .eq("department", rawEmployee.department)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orgTemplate && typeof orgTemplate.id === "string" && typeof orgTemplate.name === "string") {
      offboardTemplate = {
        id: orgTemplate.id,
        name: orgTemplate.name,
        type: orgTemplate.type as "onboarding" | "offboarding",
        tasks: orgTemplate.tasks
      };
    }
  }

  // 2. System default matching country
  if (!offboardTemplate && rawEmployee.country_code) {
    const { data: countryTemplate } = await serviceClient
      .from("onboarding_templates")
      .select("id, name, type, tasks")
      .is("org_id", null)
      .eq("is_system_default", true)
      .is("deleted_at", null)
      .eq("type", "offboarding")
      .eq("country_code", rawEmployee.country_code)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (countryTemplate && typeof countryTemplate.id === "string" && typeof countryTemplate.name === "string") {
      offboardTemplate = {
        id: countryTemplate.id,
        name: countryTemplate.name,
        type: countryTemplate.type as "onboarding" | "offboarding",
        tasks: countryTemplate.tasks
      };
    }
  }

  // 3. Universal offboarding default
  if (!offboardTemplate) {
    const { data: universalTemplate } = await serviceClient
      .from("onboarding_templates")
      .select("id, name, type, tasks")
      .is("org_id", null)
      .eq("is_system_default", true)
      .is("deleted_at", null)
      .eq("type", "offboarding")
      .is("country_code", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (universalTemplate && typeof universalTemplate.id === "string" && typeof universalTemplate.name === "string") {
      offboardTemplate = {
        id: universalTemplate.id,
        name: universalTemplate.name,
        type: universalTemplate.type as "onboarding" | "offboarding",
        tasks: universalTemplate.tasks
      };
    }
  }

  let instanceId: string | null = null;

  if (offboardTemplate) {
    try {
      const result = await createOnboardingInstance({
        supabase: serviceClient,
        orgId: profile.org_id,
        employee: {
          id: employeeId,
          fullName: rawEmployee.full_name
        },
        template: offboardTemplate,
        type: "offboarding",
        startedAt: new Date().toISOString(),
        anchorDate: parsedBody.data.lastWorkingDay,
        creatingAdminId: profile.id
      });

      instanceId = result.instance.id;
    } catch (error) {
      logger.error("Unable to create offboarding instance.", {
        employeeId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Notifications
  const notifications = [
    {
      userId: profile.id,
      title: "Offboarding initiated",
      body: `Offboarding has been initiated for ${rawEmployee.full_name}. Last working day: ${parsedBody.data.lastWorkingDay}.`
    },
    {
      userId: employeeId,
      title: "Offboarding process started",
      body: `Your offboarding process has begun. Your last working day is ${parsedBody.data.lastWorkingDay}.`
    }
  ];

  // Notify manager if exists
  if (rawEmployee.manager_id && rawEmployee.manager_id !== profile.id) {
    notifications.push({
      userId: rawEmployee.manager_id,
      title: "Team member offboarding",
      body: `${rawEmployee.full_name} is being offboarded. Last working day: ${parsedBody.data.lastWorkingDay}.`
    });
  }

  for (const notification of notifications) {
    await createNotification({
      orgId: profile.org_id,
      userId: notification.userId,
      type: "offboarding",
      title: notification.title,
      body: notification.body,
      link: instanceId ? `/onboarding/${instanceId}` : "/people"
    });
  }

  // Audit log
  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: employeeId,
    oldValue: { status: oldStatus },
    newValue: {
      status: "offboarding",
      notice_period_end_date: parsedBody.data.lastWorkingDay,
      reason: parsedBody.data.reason,
      offboardingInstanceId: instanceId,
      initiatedBy: profile.id
    }
  });

  return jsonResponse<OffboardResponseData>(200, {
    data: {
      profileId: employeeId,
      instanceId,
      status: "offboarding"
    },
    error: null,
    meta: buildMeta()
  });
}
