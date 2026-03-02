import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { isIsoDate } from "../../../../../../../lib/learning";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { LearningAssignmentsBulkMutationResponseData } from "../../../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  canManageLearning,
  courseRowSchema,
  jsonResponse,
  mapAssignmentRow
} from "../../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const assignSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1, "Select at least one employee.").max(200),
  dueDate: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || isIsoDate(value), "Due date must be YYYY-MM-DD.")
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to assign courses."
      },
      meta: buildMeta()
    });
  }

  if (!canManageLearning(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can assign courses."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Course id must be a valid UUID."
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

  const parsedBody = assignSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid course assignment payload."
      },
      meta: buildMeta()
    });
  }

  const { id: courseId } = parsedParams.data;
  const assignmentPayload = parsedBody.data;
  const employeeIds = [...new Set(assignmentPayload.employeeIds)];
  const profile = session.profile;
  const supabase = await createSupabaseServerClient();

  const { data: rawCourse, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("id", courseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (courseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_FETCH_FAILED",
        message: "Unable to load course for assignment."
      },
      meta: buildMeta()
    });
  }

  const parsedCourse = courseRowSchema.safeParse(rawCourse);

  if (!parsedCourse.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Learning course was not found."
      },
      meta: buildMeta()
    });
  }

  const { data: employeeRows, error: employeeError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", employeeIds);

  if (employeeError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEE_FETCH_FAILED",
        message: "Unable to load employees for assignment."
      },
      meta: buildMeta()
    });
  }

  const validEmployeeIds = new Set(
    (employeeRows ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((value): value is string => Boolean(value))
  );

  const missingEmployeeIds = employeeIds.filter((employeeId) => !validEmployeeIds.has(employeeId));

  if (missingEmployeeIds.length > 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more selected employees are not available in this organization."
      },
      meta: buildMeta()
    });
  }

  const upsertRows = employeeIds.map((employeeId) => ({
    org_id: profile.org_id,
    course_id: courseId,
    employee_id: employeeId,
    status: "assigned",
    progress_pct: 0,
    module_progress: {},
    quiz_score: null,
    quiz_attempts: 0,
    due_date: assignmentPayload.dueDate ?? null,
    started_at: null,
    completed_at: null,
    certificate_url: null,
    assigned_by: profile.id,
    deleted_at: null
  }));

  const { data: rawAssignmentRows, error: upsertError } = await supabase
    .from("course_assignments")
    .upsert(upsertRows, { onConflict: "course_id,employee_id" })
    .select(
      "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
    );

  if (upsertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENTS_UPSERT_FAILED",
        message: "Unable to assign course to selected employees."
      },
      meta: buildMeta()
    });
  }

  const parsedAssignments = z.array(assignmentRowSchema).safeParse(rawAssignmentRows ?? []);

  if (!parsedAssignments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENTS_PARSE_FAILED",
        message: "Assigned course data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const assignments = parsedAssignments.data.map((row) => mapAssignmentRow(row));

  await Promise.all(
    assignments.map((assignment) =>
      createNotification({
        orgId: assignment.orgId,
        userId: assignment.employeeId,
        type: "learning_assignment",
        title: "New learning assignment",
        body: `Crew Hub assigned \"${assignment.courseTitle}\" to you.`,
        link: `/learning/courses/${assignment.courseId}`
      })
    )
  );

  await logAudit({
    action: "created",
    tableName: "course_assignments",
    recordId: courseId,
    newValue: {
      courseTitle: parsedCourse.data.title,
      employeeCount: assignments.length,
      dueDate: assignmentPayload.dueDate ?? null
    }
  });

  return jsonResponse<LearningAssignmentsBulkMutationResponseData>(200, {
    data: {
      assignments
    },
    error: null,
    meta: buildMeta()
  });
}
