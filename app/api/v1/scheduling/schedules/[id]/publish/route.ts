import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { formatDateRange } from "../../../../../../../lib/datetime";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { sendSchedulePublishedEmail } from "../../../../../../../lib/notifications/email";
import { createBulkNotifications } from "../../../../../../../lib/notifications/service";
import { isSchedulingManager } from "../../../../../../../lib/scheduling";
import { isDepartmentScopedTeamLead } from "../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";
import {
  SCHEDULE_STATUSES,
  type SchedulingScheduleMutationResponseData
} from "../../../../../../../types/scheduling";

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string().nullable(),
  department: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  schedule_track: z.string().nullable(),
  status: z.enum(SCHEDULE_STATUSES),
  published_at: z.string().nullable(),
  published_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

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
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to publish schedules."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can publish schedules."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const scheduleId = params.id;

  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Schedule id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawExistingSchedule, error: existingScheduleError } = await supabase
    .from("schedules")
    .select(
      "id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at"
    )
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingScheduleError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_FETCH_FAILED",
        message: "Unable to load schedule."
      },
      meta: buildMeta()
    });
  }

  if (!rawExistingSchedule) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Schedule was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedExistingSchedule = scheduleRowSchema.safeParse(rawExistingSchedule);

  if (!parsedExistingSchedule.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PARSE_FAILED",
        message: "Schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (
    isDepartmentScopedTeamLead(session.profile.roles) &&
    !session.profile.department
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  if (
    isDepartmentScopedTeamLead(session.profile.roles) &&
    !areDepartmentsEqual(parsedExistingSchedule.data.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only publish schedules for their own department."
      },
      meta: buildMeta()
    });
  }

  if (parsedExistingSchedule.data.status === "locked") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SCHEDULE_LOCKED",
        message: "Locked schedules cannot be republished."
      },
      meta: buildMeta()
    });
  }

  const { data: rawShiftRows, error: shiftsError } = await supabase
    .from("shifts")
    .select("id, employee_id")
    .eq("org_id", session.profile.org_id)
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);

  if (shiftsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_SHIFTS_FETCH_FAILED",
        message: "Unable to load schedule shifts."
      },
      meta: buildMeta()
    });
  }

  if ((rawShiftRows ?? []).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "SCHEDULE_HAS_NO_SHIFTS",
        message: "Add at least one shift before publishing."
      },
      meta: buildMeta()
    });
  }

  const { data: rawPublishedSchedule, error: publishError } = await supabase
    .from("schedules")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: session.profile.id
    })
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at"
    )
    .single();

  if (publishError || !rawPublishedSchedule) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PUBLISH_FAILED",
        message: "Unable to publish schedule."
      },
      meta: buildMeta()
    });
  }

  const parsedPublishedSchedule = scheduleRowSchema.safeParse(rawPublishedSchedule);

  if (!parsedPublishedSchedule.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PUBLISHED_PARSE_FAILED",
        message: "Published schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const assignedUserIds = [
    ...new Set(
      (rawShiftRows ?? [])
        .map((row) => (typeof row.employee_id === "string" ? row.employee_id : null))
        .filter((value): value is string => Boolean(value))
    )
  ];

  const dateRange = formatDateRange(
    parsedPublishedSchedule.data.start_date,
    parsedPublishedSchedule.data.end_date
  );

  void createBulkNotifications({
    orgId: session.profile.org_id,
    userIds: assignedUserIds,
    type: "schedule_published",
    title: "New schedule published",
    body: `Check out your new work schedule for ${dateRange}.`,
    link: "/scheduling"
  });

  const scheduleStartDate = new Date(parsedPublishedSchedule.data.start_date + "T00:00:00Z");
  const scheduleMonth = scheduleStartDate.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const scheduleYear = String(scheduleStartDate.getUTCFullYear());

  for (const assignedUserId of assignedUserIds) {
    sendSchedulePublishedEmail({
      orgId: session.profile.org_id,
      userId: assignedUserId,
      scheduleName: parsedPublishedSchedule.data.name ?? "Work Schedule",
      month: scheduleMonth,
      year: scheduleYear
    }).catch((err) => console.error("Email send failed:", err));
  }

  void logAudit({
    action: "updated",
    tableName: "schedules",
    recordId: scheduleId,
    oldValue: {
      status: parsedExistingSchedule.data.status
    },
    newValue: {
      status: parsedPublishedSchedule.data.status
    }
  });

  const publisherName =
    parsedPublishedSchedule.data.published_by === session.profile.id
      ? session.profile.full_name
      : null;

  return jsonResponse<SchedulingScheduleMutationResponseData>(200, {
    data: {
      schedule: {
        id: parsedPublishedSchedule.data.id,
        orgId: parsedPublishedSchedule.data.org_id,
        name: parsedPublishedSchedule.data.name,
        department: parsedPublishedSchedule.data.department,
        startDate: parsedPublishedSchedule.data.start_date,
        endDate: parsedPublishedSchedule.data.end_date,
        scheduleTrack: (parsedPublishedSchedule.data.schedule_track === "weekend" ? "weekend" : "weekday") as "weekday" | "weekend",
        status: parsedPublishedSchedule.data.status,
        publishedAt: parsedPublishedSchedule.data.published_at,
        publishedBy: parsedPublishedSchedule.data.published_by,
        publishedByName: publisherName,
        createdAt: parsedPublishedSchedule.data.created_at,
        updatedAt: parsedPublishedSchedule.data.updated_at,
        shiftCount: rawShiftRows?.length ?? 0
      }
    },
    error: null,
    meta: buildMeta()
  });
}
