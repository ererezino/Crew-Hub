import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { canManageLearningAssignments } from "../../../../../../../lib/learning";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { LearningAssignmentMutationResponseData } from "../../../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  jsonResponse,
  mapAssignmentRow,
  toUnknownRecord
} from "../../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const updateProgressSchema = z.object({
  progressPct: z.coerce.number().int().min(0).max(100),
  moduleProgress: z.record(z.string(), z.unknown()).optional()
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update assignment progress."
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
        message: "Assignment id must be a valid UUID."
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

  const parsedBody = updateProgressSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid assignment progress payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const assignmentId = parsedParams.data.id;

  const { data: existingRow, error: existingError } = await supabase
    .from("course_assignments")
    .select(
      "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
    )
    .eq("org_id", session.profile.org_id)
    .eq("id", assignmentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_FETCH_FAILED",
        message: "Unable to load assignment before updating progress."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = assignmentRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Learning assignment was not found."
      },
      meta: buildMeta()
    });
  }

  const existingAssignment = mapAssignmentRow(parsedExisting.data);

  const canManage = canManageLearningAssignments(session.profile.roles);
  const isSelf = existingAssignment.employeeId === session.profile.id;

  if (!isSelf && !canManage) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to update this assignment."
      },
      meta: buildMeta()
    });
  }

  const progressPct = parsedBody.data.progressPct;
  const nowIso = new Date().toISOString();

  const nextStatus =
    progressPct === 0
      ? "assigned"
      : progressPct < 100
        ? "in_progress"
        : existingAssignment.status === "completed"
          ? "completed"
          : "in_progress";

  const { data: updatedRow, error: updateError } = await supabase
    .from("course_assignments")
    .update({
      progress_pct: progressPct,
      module_progress:
        parsedBody.data.moduleProgress !== undefined
          ? parsedBody.data.moduleProgress
          : undefined,
      started_at:
        progressPct > 0 && existingAssignment.startedAt === null
          ? nowIso
          : existingAssignment.startedAt,
      status: nextStatus
    })
    .eq("org_id", session.profile.org_id)
    .eq("id", assignmentId)
    .select(
      "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
    )
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_PROGRESS_UPDATE_FAILED",
        message: "Unable to update assignment progress."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdated = assignmentRowSchema.safeParse(updatedRow);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_PARSE_FAILED",
        message: "Updated assignment is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const assignment = mapAssignmentRow(parsedUpdated.data);

  await logAudit({
    action: "updated",
    tableName: "course_assignments",
    recordId: assignment.id,
    oldValue: {
      status: existingAssignment.status,
      progressPct: existingAssignment.progressPct,
      moduleProgress: existingAssignment.moduleProgress
    },
    newValue: {
      status: assignment.status,
      progressPct: assignment.progressPct,
      moduleProgress: toUnknownRecord(parsedBody.data.moduleProgress)
    }
  });

  return jsonResponse<LearningAssignmentMutationResponseData>(200, {
    data: {
      assignment
    },
    error: null,
    meta: buildMeta()
  });
}
