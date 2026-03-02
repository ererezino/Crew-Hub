import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { DOCUMENT_BUCKET_NAME, sanitizeFileName } from "../../../../../../../lib/documents";
import { canManageLearningAssignments } from "../../../../../../../lib/learning";
import { renderLearningCertificatePdf } from "../../../../../../../lib/learning/certificate-pdf";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { LearningAssignmentMutationResponseData } from "../../../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  jsonResponse,
  mapAssignmentRow,
  parseOptionalInteger
} from "../../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const completeSchema = z.object({
  quizScore: z.coerce.number().int().min(0).max(100).optional()
});

const completionCourseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  passing_score: z.union([z.number(), z.string()]).nullable(),
  allow_retake: z.boolean()
});

function completionDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(value);
}

export const runtime = "nodejs";

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
        message: "You must be logged in to complete an assignment."
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

  const parsedBody = completeSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid completion payload."
      },
      meta: buildMeta()
    });
  }

  const assignmentId = parsedParams.data.id;
  const supabase = await createSupabaseServerClient();

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
        message: "Unable to load assignment before completion."
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

  const assignment = mapAssignmentRow(parsedExisting.data);
  const canManage = canManageLearningAssignments(session.profile.roles);
  const isSelf = assignment.employeeId === session.profile.id;

  if (!isSelf && !canManage) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to complete this assignment."
      },
      meta: buildMeta()
    });
  }

  const { data: rawCourse, error: courseError } = await supabase
    .from("courses")
    .select("id, title, passing_score, allow_retake")
    .eq("org_id", session.profile.org_id)
    .eq("id", assignment.courseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (courseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_FETCH_FAILED",
        message: "Unable to load course completion settings."
      },
      meta: buildMeta()
    });
  }

  const parsedCourse = completionCourseSchema.safeParse(rawCourse);

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

  if (assignment.status === "completed" && !parsedCourse.data.allow_retake) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "ALREADY_COMPLETED",
        message: "This course is already completed and does not allow retakes."
      },
      meta: buildMeta()
    });
  }

  const passingScore = parseOptionalInteger(parsedCourse.data.passing_score);
  const quizScore = parsedBody.data.quizScore ?? null;
  const nextQuizAttempts = quizScore === null ? assignment.quizAttempts : assignment.quizAttempts + 1;

  if (passingScore !== null && quizScore !== null && quizScore < passingScore) {
    const { data: failedRow, error: failedError } = await supabase
      .from("course_assignments")
      .update({
        status: "failed",
        quiz_score: quizScore,
        quiz_attempts: nextQuizAttempts,
        completed_at: null,
        certificate_url: null
      })
      .eq("org_id", session.profile.org_id)
      .eq("id", assignmentId)
      .select(
        "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
      )
      .single();

    if (failedError || !failedRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ASSIGNMENT_COMPLETE_FAILED",
          message: "Unable to submit quiz result."
        },
        meta: buildMeta()
      });
    }

    const parsedFailed = assignmentRowSchema.safeParse(failedRow);

    if (!parsedFailed.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ASSIGNMENT_PARSE_FAILED",
          message: "Updated assignment is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const failedAssignment = mapAssignmentRow(parsedFailed.data);

    await logAudit({
      action: "rejected",
      tableName: "course_assignments",
      recordId: failedAssignment.id,
      oldValue: {
        status: assignment.status,
        quizScore: assignment.quizScore,
        quizAttempts: assignment.quizAttempts
      },
      newValue: {
        status: failedAssignment.status,
        quizScore: failedAssignment.quizScore,
        quizAttempts: failedAssignment.quizAttempts
      }
    });

    return jsonResponse<LearningAssignmentMutationResponseData>(200, {
      data: {
        assignment: failedAssignment
      },
      error: null,
      meta: buildMeta()
    });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const certIdSuffix = now.getTime();
  const certificateId = `${assignment.id}-${certIdSuffix}`;
  const safeCourseTitle = sanitizeFileName(assignment.courseTitle.toLowerCase().replace(/\s+/g, "-"));
  const certificateFileName = `${safeCourseTitle}-${certificateId}.pdf`;
  const certificatePath = `${assignment.orgId}/learning/certificates/${certificateFileName}`;

  try {
    const certificatePdf = await renderLearningCertificatePdf({
      orgName: session.org?.name ?? "Crew Hub",
      employeeName: assignment.employeeName,
      courseTitle: assignment.courseTitle,
      completionDateLabel: completionDateLabel(now),
      certificateId
    });

    const serviceRoleClient = createSupabaseServiceRoleClient();
    const { error: uploadError } = await serviceRoleClient.storage
      .from(DOCUMENT_BUCKET_NAME)
      .upload(certificatePath, certificatePdf, {
        upsert: true,
        contentType: "application/pdf"
      });

    if (uploadError) {
      console.error("Unable to upload learning certificate PDF.", {
        assignmentId,
        message: uploadError.message
      });
    }
  } catch (error) {
    console.error("Unable to generate learning certificate PDF.", {
      assignmentId,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const { data: completedRow, error: completedError } = await supabase
    .from("course_assignments")
    .update({
      status: "completed",
      progress_pct: 100,
      quiz_score: quizScore,
      quiz_attempts: nextQuizAttempts,
      started_at: assignment.startedAt ?? nowIso,
      completed_at: nowIso,
      certificate_url: certificatePath
    })
    .eq("org_id", session.profile.org_id)
    .eq("id", assignmentId)
    .select(
      "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
    )
    .single();

  if (completedError || !completedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_COMPLETE_FAILED",
        message: "Unable to mark assignment as completed."
      },
      meta: buildMeta()
    });
  }

  const parsedCompleted = assignmentRowSchema.safeParse(completedRow);

  if (!parsedCompleted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_PARSE_FAILED",
        message: "Completed assignment is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const completedAssignment = mapAssignmentRow(parsedCompleted.data);

  await createNotification({
    orgId: completedAssignment.orgId,
    userId: completedAssignment.employeeId,
    type: "learning_completed",
    title: "Course completed",
    body: `Crew Hub marked "${completedAssignment.courseTitle}" as completed.`,
    link: "/learning/certificates"
  });

  await logAudit({
    action: "submitted",
    tableName: "course_assignments",
    recordId: completedAssignment.id,
    oldValue: {
      status: assignment.status,
      progressPct: assignment.progressPct,
      quizScore: assignment.quizScore,
      quizAttempts: assignment.quizAttempts
    },
    newValue: {
      status: completedAssignment.status,
      progressPct: completedAssignment.progressPct,
      quizScore: completedAssignment.quizScore,
      quizAttempts: completedAssignment.quizAttempts,
      certificateUrl: completedAssignment.certificateUrl
    }
  });

  return jsonResponse<LearningAssignmentMutationResponseData>(200, {
    data: {
      assignment: completedAssignment
    },
    error: null,
    meta: buildMeta()
  });
}
