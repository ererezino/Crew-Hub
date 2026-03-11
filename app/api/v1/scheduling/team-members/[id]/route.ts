import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../lib/department";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole, isDepartmentScopedTeamLead } from "../../../../../../lib/roles";
import { isSchedulingManager } from "../../../../../../lib/scheduling";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

const paramsSchema = z.object({
  id: z.string().uuid("Team member id must be a valid UUID.")
});

const updateTeamMemberSchema = z.object({
  scheduleType: z.enum([
    "weekday",
    "weekend_primary",
    "weekend_rotation",
    "flexible"
  ]),
  weekendShiftHours: z.enum(["2", "3", "4", "8"]).nullable().optional()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  department: z.string().nullable(),
  schedule_type: z.string().nullable(),
  weekend_shift_hours: z.string().nullable()
});

type TeamMemberSchedulingResponseData = {
  personId: string;
  scheduleType: "weekday" | "weekend_primary" | "weekend_rotation" | "flexible";
  weekendShiftHours: "2" | "3" | "4" | "8" | null;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canManageTeamSetupForDepartmentScopedRole(
  actorRoles: readonly UserRole[]
): boolean {
  return (
    hasRole(actorRoles, "TEAM_LEAD") ||
    hasRole(actorRoles, "MANAGER")
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update team setup."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only scheduling managers can update team setup."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid team member id."
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
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = updateTeamMemberSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedBody.error.issues[0]?.message ?? "Invalid team setup payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = createSupabaseServiceRoleClient();
  const personId = parsedParams.data.id;
  const actorIsAdmin =
    hasRole(session.profile.roles, "SUPER_ADMIN") ||
    hasRole(session.profile.roles, "HR_ADMIN");
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);
  const actorRequiresDepartmentScope =
    !actorIsAdmin &&
    (isScopedTeamLead ||
      canManageTeamSetupForDepartmentScopedRole(session.profile.roles));

  if (actorRequiresDepartmentScope && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "DEPARTMENT_REQUIRED",
        message: "Your profile needs a department to manage team setup."
      },
      meta: buildMeta()
    });
  }

  const { data: rawProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, department, schedule_type, weekend_shift_hours")
    .eq("id", personId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to load team member profile."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = profileRowSchema.safeParse(rawProfile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Team member profile was not found."
      },
      meta: buildMeta()
    });
  }

  if (
    !actorIsAdmin &&
    actorRequiresDepartmentScope &&
    !areDepartmentsEqual(
      parsedProfile.data.department,
      session.profile.department
    )
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You can only update team setup for your own department."
      },
      meta: buildMeta()
    });
  }

  const nextScheduleType = parsedBody.data.scheduleType;
  const shouldUseWeekendHours =
    nextScheduleType === "weekend_primary" ||
    nextScheduleType === "weekend_rotation";

  const nextWeekendHours = shouldUseWeekendHours
    ? (parsedBody.data.weekendShiftHours ??
      (parsedProfile.data.weekend_shift_hours as
        | "2"
        | "3"
        | "4"
        | "8"
        | null) ??
      "8")
    : null;

  const { data: updatedRawProfile, error: updateError } = await supabase
    .from("profiles")
    .update({
      schedule_type: nextScheduleType,
      weekend_shift_hours: nextWeekendHours
    })
    .eq("id", personId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select("id, org_id, department, schedule_type, weekend_shift_hours")
    .maybeSingle();

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to update team setup."
      },
      meta: buildMeta()
    });
  }

  const updatedProfile = profileRowSchema.safeParse(updatedRawProfile);

  if (!updatedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Updated team member profile is invalid."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: personId,
    oldValue: {
      schedule_type: parsedProfile.data.schedule_type,
      weekend_shift_hours: parsedProfile.data.weekend_shift_hours
    },
    newValue: {
      schedule_type: updatedProfile.data.schedule_type,
      weekend_shift_hours: updatedProfile.data.weekend_shift_hours
    }
  });

  return jsonResponse<TeamMemberSchedulingResponseData>(200, {
    data: {
      personId,
      scheduleType: (updatedProfile.data.schedule_type ??
        "weekday") as TeamMemberSchedulingResponseData["scheduleType"],
      weekendShiftHours:
        (updatedProfile.data.weekend_shift_hours as
          | "2"
          | "3"
          | "4"
          | "8"
          | null) ?? null
    },
    error: null,
    meta: buildMeta()
  });
}
