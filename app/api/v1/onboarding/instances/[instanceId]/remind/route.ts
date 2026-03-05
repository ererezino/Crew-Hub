import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import type { UserRole } from "../../../../../../../lib/navigation";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { hasRole } from "../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";

const paramsSchema = z.object({
  instanceId: z.string().uuid()
});

const instanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  status: z.string()
});

type RemindResponseData = {
  sent: boolean;
};

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canSendReminder(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ instanceId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to send onboarding reminders."
      },
      meta: buildMeta()
    });
  }

  if (!canSendReminder(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can send onboarding reminders."
      },
      meta: buildMeta()
    });
  }

  const resolvedParams = await context.params;
  const parsedParams = paramsSchema.safeParse(resolvedParams);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Instance ID must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const { instanceId } = parsedParams.data;
  const supabase = await createSupabaseServerClient();

  const { data: instanceRow, error: instanceError } = await supabase
    .from("onboarding_instances")
    .select("id, employee_id, status")
    .eq("id", instanceId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (instanceError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_FETCH_FAILED",
        message: "Unable to load onboarding instance."
      },
      meta: buildMeta()
    });
  }

  if (!instanceRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Onboarding instance not found."
      },
      meta: buildMeta()
    });
  }

  const parsedInstance = instanceRowSchema.safeParse(instanceRow);

  if (!parsedInstance.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_PARSE_FAILED",
        message: "Onboarding instance data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedInstance.data.status !== "active") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Reminders can only be sent for active onboarding instances."
      },
      meta: buildMeta()
    });
  }

  await createNotification({
    orgId: session.profile.org_id,
    userId: parsedInstance.data.employee_id,
    type: "onboarding_reminder",
    title: "Onboarding reminder",
    body: "Your onboarding tasks need attention. Please review and complete any outstanding items.",
    link: `/onboarding/${instanceId}`,
    skipIfUnreadDuplicate: true
  });

  await logAudit({
    action: "created",
    tableName: "notifications",
    recordId: instanceId,
    newValue: {
      type: "onboarding_reminder",
      employeeId: parsedInstance.data.employee_id,
      sentBy: session.profile.id
    }
  });

  return jsonResponse<RemindResponseData>(200, {
    data: { sent: true },
    error: null,
    meta: buildMeta()
  });
}
