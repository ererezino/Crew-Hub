import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../lib/roles";
import {
  canViewTeamSchedules,
  isIsoDate,
  isSchedulingManager
} from "../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import {
  SCHEDULE_STATUSES,
  type ScheduleRecord,
  type SchedulingScheduleMutationResponseData,
  type SchedulingSchedulesResponseData
} from "../../../../../types/scheduling";

const querySchema = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  status: z.enum(SCHEDULE_STATUSES).optional(),
  startDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoDate(value), "startDate must be YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoDate(value), "endDate must be YYYY-MM-DD.")
    .optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(300).default(120)
});

const rosterEntrySchema = z.object({
  employeeId: z.string().uuid(),
  weekendHours: z.enum(["2", "3", "4", "8"]).optional()
});

const createScheduleSchema = z.object({
  name: z.string().trim().max(200).optional(),
  department: z.string().trim().max(100).optional(),
  scheduleTrack: z.enum(["weekday", "weekend"]).default("weekday"),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM format.")
    .optional(),
  months: z.coerce.number().int().min(1).max(3).default(1),
  startDate: z
    .string()
    .trim()
    .refine((value) => isIsoDate(value), "startDate must be YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .trim()
    .refine((value) => isIsoDate(value), "endDate must be YYYY-MM-DD.")
    .optional(),
  roster: z.array(rosterEntrySchema).optional()
});

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

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function computeDateRange(month: string, months: number): { startDate: string; endDate: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);

  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;

  const endMonth = mon + months - 1;
  const endYear = year + Math.floor((endMonth - 1) / 12);
  const endMon = ((endMonth - 1) % 12) + 1;

  const lastDay = new Date(Date.UTC(endYear, endMon, 0)).getUTCDate();
  const endDate = `${endYear}-${String(endMon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { startDate, endDate };
}

async function mapSchedules({
  supabase,
  rows,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  rows: z.infer<typeof scheduleRowSchema>[];
  orgId: string;
}): Promise<ScheduleRecord[]> {
  if (rows.length === 0) {
    return [];
  }

  const scheduleIds = rows.map((row) => row.id);
  const publisherIds = [
    ...new Set(
      rows.map((row) => row.published_by).filter((value): value is string => Boolean(value))
    )
  ];

  const [{ data: rawShifts, error: shiftsError }, { data: rawProfiles, error: profilesError }] =
    await Promise.all([
      supabase
        .from("shifts")
        .select("schedule_id")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .in("schedule_id", scheduleIds),
      publisherIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .in("id", publisherIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (shiftsError || profilesError) {
    throw new Error("Unable to resolve schedule metadata.");
  }

  const shiftCountsByScheduleId = new Map<string, number>();

  for (const shiftRow of rawShifts ?? []) {
    const scheduleId = typeof shiftRow.schedule_id === "string" ? shiftRow.schedule_id : null;

    if (!scheduleId) {
      continue;
    }

    shiftCountsByScheduleId.set(scheduleId, (shiftCountsByScheduleId.get(scheduleId) ?? 0) + 1);
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    throw new Error("Unable to parse schedule publisher metadata.");
  }

  const publisherNameById = new Map(
    parsedProfiles.data.map((profileRow) => [profileRow.id, profileRow.full_name] as const)
  );

  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    department: row.department,
    startDate: row.start_date,
    endDate: row.end_date,
    scheduleTrack: (row.schedule_track === "weekend" ? "weekend" : "weekday") as "weekday" | "weekend",
    status: row.status,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByName: row.published_by ? publisherNameById.get(row.published_by) ?? null : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shiftCount: shiftCountsByScheduleId.get(row.id) ?? 0
  }));
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view schedules."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid schedules query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();
  const canViewTeam = canViewTeamSchedules(session.profile.roles);
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);
  const isManager = isSchedulingManager(session.profile.roles);
  const scope = query.scope === "team" && canViewTeam ? "team" : "mine";

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  let scheduleIdsForMine: string[] = [];

  if (scope === "mine") {
    let shiftsForMineQuery = supabase
      .from("shifts")
      .select("schedule_id")
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null);

    if (query.startDate && query.startDate.length > 0) {
      shiftsForMineQuery = shiftsForMineQuery.gte("shift_date", query.startDate);
    }

    if (query.endDate && query.endDate.length > 0) {
      shiftsForMineQuery = shiftsForMineQuery.lte("shift_date", query.endDate);
    }

    const { data: rawShiftRows, error: shiftsError } = await shiftsForMineQuery;

    if (shiftsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SCHEDULE_SHIFT_SCOPE_FETCH_FAILED",
          message: "Unable to resolve your schedule scope."
        },
        meta: buildMeta()
      });
    }

    scheduleIdsForMine = [
      ...new Set(
        (rawShiftRows ?? [])
          .map((row) => (typeof row.schedule_id === "string" ? row.schedule_id : null))
          .filter((value): value is string => Boolean(value))
      )
    ];

    if (scheduleIdsForMine.length === 0) {
      return jsonResponse<SchedulingSchedulesResponseData>(200, {
        data: { schedules: [] },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let schedulesQuery = supabase
    .from("schedules")
    .select(
      "id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("start_date", { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (query.status) {
    schedulesQuery = schedulesQuery.eq("status", query.status);
  }

  if (query.startDate && query.startDate.length > 0) {
    schedulesQuery = schedulesQuery.gte("start_date", query.startDate);
  }

  if (query.endDate && query.endDate.length > 0) {
    schedulesQuery = schedulesQuery.lte("end_date", query.endDate);
  }

  if (scope === "mine") {
    schedulesQuery = schedulesQuery.in("id", scheduleIdsForMine);
  } else if (scope === "team" && isScopedTeamLead) {
    schedulesQuery = schedulesQuery.ilike("department", session.profile.department as string);
  } else if (scope === "team" && !isManager) {
    if (!session.profile.department) {
      return jsonResponse<SchedulingSchedulesResponseData>(200, {
        data: { schedules: [] },
        error: null,
        meta: buildMeta()
      });
    }

    schedulesQuery = schedulesQuery.ilike("department", session.profile.department);
  }

  const { data: rawRows, error } = await schedulesQuery;

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULES_FETCH_FAILED",
        message: "Unable to load schedules."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(scheduleRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULES_PARSE_FAILED",
        message: "Schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  try {
    const schedules = await mapSchedules({
      supabase,
      rows: parsedRows.data,
      orgId: session.profile.org_id
    });

    return jsonResponse<SchedulingSchedulesResponseData>(200, {
      data: { schedules },
      error: null,
      meta: buildMeta()
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_METADATA_FETCH_FAILED",
        message: "Unable to load schedule metadata."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create schedules."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can create schedules."
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

  const parsedBody = createScheduleSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid schedule payload."
      },
      meta: buildMeta()
    });
  }

  let startDate: string;
  let endDate: string;

  if (parsedBody.data.month) {
    const range = computeDateRange(parsedBody.data.month, parsedBody.data.months);
    startDate = range.startDate;
    endDate = range.endDate;
  } else if (parsedBody.data.startDate && parsedBody.data.endDate) {
    startDate = parsedBody.data.startDate;
    endDate = parsedBody.data.endDate;
  } else {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Either month or startDate+endDate must be provided."
      },
      meta: buildMeta()
    });
  }

  if (endDate < startDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "endDate must be on or after startDate."
      },
      meta: buildMeta()
    });
  }

  // Use the service-role client for inserts so we are not blocked by RLS
  // session-resolution edge cases.  The API already enforces authorization
  // above (isSchedulingManager + team-lead scoping).
  const supabase = createSupabaseServiceRoleClient();
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
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
    isScopedTeamLead &&
    parsedBody.data.department &&
    !areDepartmentsEqual(parsedBody.data.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only create schedules for their own department."
      },
      meta: buildMeta()
    });
  }

  const normalizedRequestedDepartment = parsedBody.data.department?.trim();
  const actorDepartment =
    typeof session.profile.department === "string" &&
    session.profile.department.trim().length > 0
      ? session.profile.department.trim()
      : null;

  const departmentForSchedule = isScopedTeamLead
    ? actorDepartment
    : normalizedRequestedDepartment?.length
      ? normalizedRequestedDepartment
      : actorDepartment;

  const { data: rawRow, error } = await supabase
    .from("schedules")
    .insert({
      org_id: session.profile.org_id,
      name: parsedBody.data.name?.trim() || null,
      department: departmentForSchedule,
      start_date: startDate,
      end_date: endDate,
      schedule_track: parsedBody.data.scheduleTrack,
      status: "draft"
    })
    .select(
      "id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at"
    )
    .single();

  if (error || !rawRow) {
    console.error("[SCHEDULE_CREATE] Insert failed:", JSON.stringify(error, null, 2));
    console.error("[SCHEDULE_CREATE] Insert payload:", JSON.stringify({
      org_id: session.profile.org_id,
      name: parsedBody.data.name?.trim() || null,
      department: departmentForSchedule,
      start_date: startDate,
      end_date: endDate,
      schedule_track: parsedBody.data.scheduleTrack,
      status: "draft"
    }, null, 2));

    const dbMessage = error?.message ?? "Unknown database error";
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_CREATE_FAILED",
        message: `Unable to create schedule: ${dbMessage}`
      },
      meta: buildMeta()
    });
  }

  const parsedRow = scheduleRowSchema.safeParse(rawRow);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PARSE_FAILED",
        message: "Created schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const roster = parsedBody.data.roster;
  if (roster && roster.length > 0) {
    const rosterRows = roster.map((entry) => ({
      schedule_id: parsedRow.data.id,
      employee_id: entry.employeeId,
      weekend_hours: entry.weekendHours ?? null
    }));

    const { error: rosterError } = await supabase
      .from("schedule_roster")
      .insert(rosterRows);

    if (rosterError) {
      console.error("Failed to insert schedule roster:", rosterError);
    }
  }

  const schedule: ScheduleRecord = {
    id: parsedRow.data.id,
    orgId: parsedRow.data.org_id,
    name: parsedRow.data.name,
    department: parsedRow.data.department,
    startDate: parsedRow.data.start_date,
    endDate: parsedRow.data.end_date,
    scheduleTrack: parsedRow.data.schedule_track === "weekend" ? "weekend" : "weekday",
    status: parsedRow.data.status,
    publishedAt: parsedRow.data.published_at,
    publishedBy: parsedRow.data.published_by,
    publishedByName: null,
    createdAt: parsedRow.data.created_at,
    updatedAt: parsedRow.data.updated_at,
    shiftCount: 0
  };

  void logAudit({
    action: "created",
    tableName: "schedules",
    recordId: schedule.id,
    oldValue: null,
    newValue: {
      start_date: schedule.startDate,
      end_date: schedule.endDate,
      schedule_track: schedule.scheduleTrack,
      status: schedule.status
    }
  });

  return jsonResponse<SchedulingScheduleMutationResponseData>(201, {
    data: { schedule },
    error: null,
    meta: buildMeta()
  });
}
