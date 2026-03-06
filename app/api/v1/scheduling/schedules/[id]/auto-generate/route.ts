import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { isSchedulingManager } from "../../../../../../../lib/scheduling";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import {
  autoGenerateSchedule,
  type EmployeeScheduleInfo,
  type GeneratedAssignment,
  type ShiftSlot
} from "../../../../../../../lib/scheduling/auto-scheduler";
import type { ApiResponse } from "../../../../../../../types/auth";
import { SCHEDULE_STATUSES } from "../../../../../../../types/scheduling";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const slotSchema = z.object({
  name: z.string().min(1),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:MM"),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "endTime must be HH:MM")
});

const confirmBodySchema = z.object({
  confirm: z.literal(true),
  assignments: z.array(
    z.object({
      employeeId: z.string().uuid(),
      shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slotName: z.string().min(1),
      startTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:MM"),
      endTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "endTime must be HH:MM")
    })
  )
});

const generateBodySchema = z.object({
  slots: z.array(slotSchema).min(1, "At least one slot is required."),
  scheduleType: z.enum(["weekday", "weekend", "holiday"]).default("weekday"),
  confirm: z.literal(true).optional(),
  assignments: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slotName: z.string().min(1),
        startTime: z.string(),
        endTime: z.string()
      })
    )
    .optional()
});

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  department: z.string().nullable(),
  week_start: z.string(),
  week_end: z.string(),
  status: z.enum(SCHEDULE_STATUSES)
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

type AutoGenerateResponseData = {
  assignments: GeneratedAssignment[];
  savedCount?: number;
};

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to auto-generate schedules."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can auto-generate schedules."
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

  // Parse body
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

  // Use service-role client to bypass RLS for cross-table lookups
  const supabase = createSupabaseServiceRoleClient();

  // -----------------------------------------------------------------------
  // Fetch the schedule
  // -----------------------------------------------------------------------

  const { data: rawSchedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("id, org_id, department, week_start, week_end, status")
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (scheduleError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_FETCH_FAILED",
        message: "Unable to load schedule."
      },
      meta: buildMeta()
    });
  }

  if (!rawSchedule) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Schedule was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedSchedule = scheduleRowSchema.safeParse(rawSchedule);

  if (!parsedSchedule.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PARSE_FAILED",
        message: "Schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const schedule = parsedSchedule.data;

  if (schedule.status === "locked") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SCHEDULE_LOCKED",
        message: "Cannot auto-generate for a locked schedule."
      },
      meta: buildMeta()
    });
  }

  // -----------------------------------------------------------------------
  // Confirm mode: save previously-generated assignments
  // -----------------------------------------------------------------------

  const confirmParse = confirmBodySchema.safeParse(body);

  if (confirmParse.success) {
    const { assignments } = confirmParse.data;

    if (assignments.length === 0) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "No assignments to save."
        },
        meta: buildMeta()
      });
    }

    const shiftRows = assignments.map((a) => ({
      org_id: session.profile!.org_id,
      schedule_id: scheduleId,
      employee_id: a.employeeId,
      shift_date: a.shiftDate,
      start_time: `${a.shiftDate}T${a.startTime}:00.000Z`,
      end_time: `${a.shiftDate}T${a.endTime}:00.000Z`,
      break_minutes: 0,
      status: "scheduled" as const,
      notes: `Auto-generated: ${a.slotName}`
    }));

    const { error: insertError } = await supabase
      .from("shifts")
      .insert(shiftRows);

    if (insertError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_INSERT_FAILED",
          message: "Unable to save auto-generated shifts."
        },
        meta: buildMeta()
      });
    }

    void logAudit({
      action: "created",
      tableName: "shifts",
      recordId: scheduleId,
      oldValue: null,
      newValue: {
        auto_generated: true,
        count: assignments.length
      }
    });

    return jsonResponse<AutoGenerateResponseData>(201, {
      data: {
        assignments,
        savedCount: assignments.length
      },
      error: null,
      meta: buildMeta()
    });
  }

  // -----------------------------------------------------------------------
  // Generate mode: produce draft assignments (does not save)
  // -----------------------------------------------------------------------

  const parsedBody = generateBodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedBody.error.issues[0]?.message ?? "Invalid auto-generate payload."
      },
      meta: buildMeta()
    });
  }

  const { slots, scheduleType } = parsedBody.data;

  // -----------------------------------------------------------------------
  // Fetch employees in the schedule's department
  // -----------------------------------------------------------------------

  let employeesQuery = supabase
    .from("profiles")
    .select("id, full_name, schedule_type")
    .eq("org_id", session.profile.org_id)
    .eq("status", "active")
    .is("deleted_at", null);

  if (schedule.department) {
    employeesQuery = employeesQuery.ilike("department", schedule.department);
  }

  const { data: rawEmployees, error: employeesError } = await employeesQuery;

  if (employeesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEES_FETCH_FAILED",
        message: "Unable to load employees for scheduling."
      },
      meta: buildMeta()
    });
  }

  if (!rawEmployees || rawEmployees.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "NO_ELIGIBLE_EMPLOYEES",
        message: "No active employees found for this department."
      },
      meta: buildMeta()
    });
  }

  // -----------------------------------------------------------------------
  // Fetch approved leave requests for the date range as blocked dates
  // -----------------------------------------------------------------------

  const { data: rawLeaves, error: leavesError } = await supabase
    .from("leave_requests")
    .select("employee_id, start_date, end_date")
    .eq("org_id", session.profile.org_id)
    .eq("status", "approved")
    .is("deleted_at", null)
    .lte("start_date", schedule.week_end)
    .gte("end_date", schedule.week_start);

  if (leavesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEAVE_REQUESTS_FETCH_FAILED",
        message: "Unable to load leave requests."
      },
      meta: buildMeta()
    });
  }

  // Fetch holidays for the date range
  const { data: rawHolidays, error: holidaysError } = await supabase
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .gte("date", schedule.week_start)
    .lte("date", schedule.week_end);

  if (holidaysError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "HOLIDAYS_FETCH_FAILED",
        message: "Unable to load holiday calendar."
      },
      meta: buildMeta()
    });
  }

  const holidayDates = new Set(
    (rawHolidays ?? []).map((h) => {
      const val = h.date;
      return typeof val === "string" ? val : "";
    })
  );

  // Build blocked dates per employee
  const blockedByEmployee = new Map<string, string[]>();

  for (const leave of rawLeaves ?? []) {
    const empId =
      typeof leave.employee_id === "string" ? leave.employee_id : null;
    const startStr =
      typeof leave.start_date === "string" ? leave.start_date : null;
    const endStr = typeof leave.end_date === "string" ? leave.end_date : null;

    if (!empId || !startStr || !endStr) continue;

    const current = new Date(`${startStr}T00:00:00Z`);
    const last = new Date(`${endStr}T00:00:00Z`);
    const dates: string[] = [];

    while (current <= last) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    const existing = blockedByEmployee.get(empId) ?? [];
    blockedByEmployee.set(empId, [...existing, ...dates]);
  }

  // Add holiday dates as blocked for all employees
  for (const emp of rawEmployees) {
    const empId = typeof emp.id === "string" ? emp.id : "";
    const existing = blockedByEmployee.get(empId) ?? [];
    blockedByEmployee.set(empId, [...existing, ...holidayDates]);
  }

  // -----------------------------------------------------------------------
  // Build employee info and run auto-scheduler
  // -----------------------------------------------------------------------

  const VALID_SCHEDULE_TYPES = new Set([
    "weekday",
    "weekend_primary",
    "weekend_rotation",
    "flexible"
  ]);

  const employees: EmployeeScheduleInfo[] = rawEmployees.map((emp) => {
    const empId = typeof emp.id === "string" ? emp.id : "";
    const fullName = typeof emp.full_name === "string" ? emp.full_name : "";
    const rawType =
      typeof emp.schedule_type === "string" ? emp.schedule_type : "weekday";
    const schedType = VALID_SCHEDULE_TYPES.has(rawType)
      ? (rawType as EmployeeScheduleInfo["scheduleType"])
      : "weekday";

    return {
      id: empId,
      fullName,
      scheduleType: schedType,
      blockedDates: blockedByEmployee.get(empId) ?? []
    };
  });

  const typedSlots: ShiftSlot[] = slots.map((s) => ({
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime
  }));

  const assignments = autoGenerateSchedule({
    employees,
    slots: typedSlots,
    startDate: schedule.week_start,
    endDate: schedule.week_end,
    scheduleType
  });

  return jsonResponse<AutoGenerateResponseData>(200, {
    data: { assignments },
    error: null,
    meta: buildMeta()
  });
}
