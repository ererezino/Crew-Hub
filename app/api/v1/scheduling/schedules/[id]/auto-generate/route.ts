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
  slots: z.array(slotSchema).min(1, "At least one slot is required.").optional(),
  scheduleType: z.enum(["weekday", "weekend", "holiday"]).optional(),
  employeeIds: z.array(z.string().uuid()).optional(),
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
  start_date: z.string(),
  end_date: z.string(),
  schedule_track: z.string().nullable(),
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

type EnrichedAssignment = GeneratedAssignment & {
  employeeName: string;
};

type AutoGeneratePreviewResponseData = {
  assignments: EnrichedAssignment[];
  warnings?: string[];
};

type AutoGenerateConfirmResponseData = {
  assignments: GeneratedAssignment[];
  savedCount: number;
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

  const supabase = createSupabaseServiceRoleClient();

  // -----------------------------------------------------------------------
  // Fetch the schedule
  // -----------------------------------------------------------------------

  const { data: rawSchedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("id, org_id, department, start_date, end_date, schedule_track, status")
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

    return jsonResponse<AutoGenerateConfirmResponseData>(201, {
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

  const scheduleType = parsedBody.data.scheduleType ?? (schedule.schedule_track === "weekend" ? "weekend" : "weekday");

  // -----------------------------------------------------------------------
  // Fetch crew — prefer roster, fall back to explicit IDs or department
  // -----------------------------------------------------------------------

  const { data: rosterRows } = await supabase
    .from("schedule_roster")
    .select("employee_id, weekend_hours")
    .eq("schedule_id", scheduleId);

  const rosterEmployeeIds = (rosterRows ?? []).map((r) =>
    typeof r.employee_id === "string" ? r.employee_id : ""
  ).filter(Boolean);

  const weekendHoursOverrides = new Map<string, string>();
  for (const r of rosterRows ?? []) {
    if (typeof r.employee_id === "string" && typeof r.weekend_hours === "string") {
      weekendHoursOverrides.set(r.employee_id, r.weekend_hours);
    }
  }

  const { employeeIds } = parsedBody.data;

  let employeesQuery = supabase
    .from("profiles")
    .select("id, full_name, schedule_type, weekend_shift_hours")
    .eq("org_id", session.profile.org_id)
    .eq("status", "active")
    .is("deleted_at", null);

  if (rosterEmployeeIds.length > 0) {
    employeesQuery = employeesQuery.in("id", rosterEmployeeIds);
  } else if (employeeIds && employeeIds.length > 0) {
    employeesQuery = employeesQuery.in("id", employeeIds);
  } else if (schedule.department) {
    employeesQuery = employeesQuery.ilike("department", schedule.department);
  }

  const { data: rawEmployees, error: employeesError } = await employeesQuery;

  if (employeesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEES_FETCH_FAILED",
        message: "Unable to load crew members for scheduling."
      },
      meta: buildMeta()
    });
  }

  if (!rawEmployees || rawEmployees.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "NO_ELIGIBLE_EMPLOYEES",
        message: "No active crew members found for this schedule."
      },
      meta: buildMeta()
    });
  }

  // -----------------------------------------------------------------------
  // Fetch leave and holidays as blocked dates
  // -----------------------------------------------------------------------

  const { data: rawLeaves, error: leavesError } = await supabase
    .from("leave_requests")
    .select("employee_id, start_date, end_date")
    .eq("org_id", session.profile.org_id)
    .eq("status", "approved")
    .is("deleted_at", null)
    .lte("start_date", schedule.end_date)
    .gte("end_date", schedule.start_date);

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

  const { data: rawHolidays, error: holidaysError } = await supabase
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .gte("date", schedule.start_date)
    .lte("date", schedule.end_date);

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

  const blockedByEmployee = new Map<string, string[]>();

  for (const leave of rawLeaves ?? []) {
    const empId = typeof leave.employee_id === "string" ? leave.employee_id : null;
    const startStr = typeof leave.start_date === "string" ? leave.start_date : null;
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
    const rawType = typeof emp.schedule_type === "string" ? emp.schedule_type : "weekday";
    const schedType = VALID_SCHEDULE_TYPES.has(rawType)
      ? (rawType as EmployeeScheduleInfo["scheduleType"])
      : "weekday";

    const profileWeekendHours = typeof emp.weekend_shift_hours === "string" ? emp.weekend_shift_hours : "full";
    const effectiveWeekendHours = weekendHoursOverrides.get(empId) ?? profileWeekendHours;

    return {
      id: empId,
      fullName,
      scheduleType: schedType,
      blockedDates: blockedByEmployee.get(empId) ?? [],
      weekendHours: effectiveWeekendHours as "full" | "part"
    };
  });

  // Resolve slots: use provided or auto-resolve from templates
  let typedSlots: ShiftSlot[];

  if (parsedBody.data.slots && parsedBody.data.slots.length > 0) {
    typedSlots = parsedBody.data.slots.map((s) => ({
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime
    }));
  } else {
    const { data: templates } = await supabase
      .from("shift_templates")
      .select("name, start_time, end_time")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null);

    if (!templates || templates.length === 0) {
      typedSlots = scheduleType === "weekend"
        ? [{ name: "Weekend Shift", startTime: "09:00", endTime: "17:00" }]
        : [{ name: "Day Shift", startTime: "09:00", endTime: "17:00" }];
    } else {
      typedSlots = templates.map((t) => {
        const startRaw = typeof t.start_time === "string" ? t.start_time : "09:00";
        const endRaw = typeof t.end_time === "string" ? t.end_time : "17:00";
        const startTime = startRaw.includes("T") ? startRaw.slice(11, 16) : startRaw;
        const endTime = endRaw.includes("T") ? endRaw.slice(11, 16) : endRaw;
        return {
          name: typeof t.name === "string" ? t.name : "Shift",
          startTime,
          endTime
        };
      });
    }
  }

  const assignments = autoGenerateSchedule({
    employees,
    slots: typedSlots,
    startDate: schedule.start_date,
    endDate: schedule.end_date,
    scheduleType
  });

  const nameMap = new Map<string, string>();
  for (const emp of employees) {
    nameMap.set(emp.id, emp.fullName);
  }

  const enriched: EnrichedAssignment[] = assignments.map((a) => ({
    ...a,
    employeeName: nameMap.get(a.employeeId) ?? "Unknown"
  }));

  const warnings: string[] = [];
  const dates = (() => {
    const result: string[] = [];
    const cur = new Date(`${schedule.start_date}T00:00:00Z`);
    const last = new Date(`${schedule.end_date}T00:00:00Z`);
    while (cur <= last) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return result;
  })();

  for (const date of dates) {
    for (const slot of typedSlots) {
      const filled = assignments.some(
        (a) => a.shiftDate === date && a.slotName === slot.name
      );
      if (!filled) {
        warnings.push(`${date}: no one available for ${slot.name}`);
      }
    }
  }

  return jsonResponse<AutoGeneratePreviewResponseData>(200, {
    data: {
      assignments: enriched,
      ...(warnings.length > 0 ? { warnings } : {})
    },
    error: null,
    meta: buildMeta()
  });
}
