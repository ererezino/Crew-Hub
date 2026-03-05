import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { DOCUMENT_BUCKET_NAME, sanitizeFileName } from "../../../../../../../lib/documents";
import { canManageLearningAssignments } from "../../../../../../../lib/learning";
import { renderLearningCertificatePdf } from "../../../../../../../lib/learning/certificate-pdf";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type {
  LearningAssignmentMutationResponseData,
  LearningModuleProgressResponseData
} from "../../../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  jsonResponse,
  mapAssignmentRow,
  parseOptionalInteger,
  toUnknownRecord
} from "../../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const updateProgressSchema = z.object({
  progressPct: z.coerce.number().int().min(0).max(100),
  moduleProgress: z.record(z.string(), z.unknown()).optional()
});

const moduleProgressSchema = z.object({
  moduleId: z.string().min(1),
  status: z.enum(["completed", "in_progress"]),
  quizAnswers: z.record(z.string(), z.number()).optional()
});

const courseModulesSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  modules: z.unknown(),
  passing_score: z.union([z.number(), z.string()]).nullable(),
  allow_retake: z.boolean(),
  certificate_template: z.string().nullable()
});

const assignmentSelectCols =
  "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)";

type ParsedModule = {
  id: string;
  title: string;
  type: string;
  questions?: Array<{
    id: string;
    text: string;
    options: string[];
    correctAnswer: number;
  }>;
};

function parseModules(raw: unknown): ParsedModule[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item)
    )
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      title: typeof item.title === "string" ? item.title : "Untitled",
      type: typeof item.type === "string" ? item.type : "content",
      questions: Array.isArray(item.questions)
        ? (item.questions as ParsedModule["questions"])
        : undefined
    }));
}

type ModuleProgressEntry = {
  status: string;
  startedAt?: string;
  completedAt?: string;
};

function parseModuleProgress(raw: unknown): Record<string, ModuleProgressEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: Record<string, ModuleProgressEntry> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = value as Record<string, unknown>;
      result[key] = {
        status: typeof entry.status === "string" ? entry.status : "locked",
        startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
        completedAt: typeof entry.completedAt === "string" ? entry.completedAt : undefined
      };
    }
  }

  return result;
}

function completionDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(value);
}

export const runtime = "nodejs";

// ── PUT — Simple percentage-based progress update ──

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
    .select(assignmentSelectCols)
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
    .select(assignmentSelectCols)
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

// ── POST — Module-level progress with quiz validation ──

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
        message: "You must be logged in to update module progress."
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

  const parsedBody = moduleProgressSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid module progress payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const assignmentId = parsedParams.data.id;
  const orgId = session.profile.org_id;

  // Fetch assignment
  const { data: existingRow, error: existingError } = await supabase
    .from("course_assignments")
    .select(assignmentSelectCols)
    .eq("org_id", orgId)
    .eq("id", assignmentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_FETCH_FAILED",
        message: "Unable to load assignment."
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

  // Fetch course with modules
  const { data: rawCourse, error: courseError } = await supabase
    .from("courses")
    .select("id, title, modules, passing_score, allow_retake, certificate_template")
    .eq("org_id", orgId)
    .eq("id", existingAssignment.courseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (courseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_FETCH_FAILED",
        message: "Unable to load course data."
      },
      meta: buildMeta()
    });
  }

  const parsedCourse = courseModulesSchema.safeParse(rawCourse);

  if (!parsedCourse.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Course was not found."
      },
      meta: buildMeta()
    });
  }

  const modules = parseModules(parsedCourse.data.modules);

  if (modules.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "This course has no modules configured."
      },
      meta: buildMeta()
    });
  }

  const targetModuleIndex = modules.findIndex((m) => m.id === parsedBody.data.moduleId);

  if (targetModuleIndex === -1) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Module was not found in this course."
      },
      meta: buildMeta()
    });
  }

  const targetModule = modules[targetModuleIndex];
  const currentProgress = parseModuleProgress(existingAssignment.moduleProgress);
  const nowIso = new Date().toISOString();
  const now = new Date();
  const passingScore = parseOptionalInteger(parsedCourse.data.passing_score);

  // Check sequential unlock: module N requires module N-1 to be completed
  if (targetModuleIndex > 0) {
    const prevModule = modules[targetModuleIndex - 1];
    const prevStatus = currentProgress[prevModule.id]?.status;

    if (prevStatus !== "completed") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Complete the previous module first to unlock this one."
        },
        meta: buildMeta()
      });
    }
  }

  // ── Handle quiz answers ──
  let quizResult: LearningModuleProgressResponseData["quizResult"] = null;

  if (parsedBody.data.quizAnswers && targetModule.type === "quiz" && targetModule.questions) {
    const questions = targetModule.questions;

    if (questions.length === 0) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "This quiz module has no questions."
        },
        meta: buildMeta()
      });
    }

    let correctCount = 0;

    for (const question of questions) {
      const userAnswer = parsedBody.data.quizAnswers[question.id];

      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount += 1;
      }
    }

    const quizScore = Math.round((correctCount / questions.length) * 100);
    const passed = passingScore === null || quizScore >= passingScore;

    quizResult = {
      score: quizScore,
      passed,
      totalQuestions: questions.length,
      correctCount,
      passingScore,
      allowRetake: parsedCourse.data.allow_retake
    };

    if (!passed) {
      // Update quiz score and attempts but do NOT mark module complete
      const nextQuizAttempts = existingAssignment.quizAttempts + 1;

      const { data: failedRow, error: failedError } = await supabase
        .from("course_assignments")
        .update({
          quiz_score: quizScore,
          quiz_attempts: nextQuizAttempts,
          status: "failed",
          started_at: existingAssignment.startedAt ?? nowIso
        })
        .eq("org_id", orgId)
        .eq("id", assignmentId)
        .select(assignmentSelectCols)
        .single();

      if (failedError || !failedRow) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "QUIZ_SUBMIT_FAILED",
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

      await logAudit({
        action: "rejected",
        tableName: "course_assignments",
        recordId: assignmentId,
        oldValue: {
          quizScore: existingAssignment.quizScore,
          quizAttempts: existingAssignment.quizAttempts
        },
        newValue: {
          quizScore,
          quizAttempts: nextQuizAttempts
        }
      });

      return jsonResponse<LearningModuleProgressResponseData>(200, {
        data: {
          assignment: mapAssignmentRow(parsedFailed.data),
          quizResult
        },
        error: null,
        meta: buildMeta()
      });
    }

    // Quiz passed — fall through to mark module complete
  }

  // ── Update module_progress JSONB ──
  const updatedProgress = { ...currentProgress };

  if (parsedBody.data.status === "completed") {
    updatedProgress[parsedBody.data.moduleId] = {
      status: "completed",
      completedAt: nowIso
    };
  } else {
    updatedProgress[parsedBody.data.moduleId] = {
      status: "in_progress",
      startedAt: nowIso
    };
  }

  // Recalculate progress_pct = (completed modules / total modules) × 100
  const completedCount = modules.filter((m) => updatedProgress[m.id]?.status === "completed").length;
  const progressPct = Math.round((completedCount / modules.length) * 100);
  const allComplete = completedCount === modules.length;

  // Determine next status
  let nextStatus: string;

  if (allComplete) {
    nextStatus = "completed";
  } else if (completedCount > 0 || parsedBody.data.status === "in_progress") {
    nextStatus = "in_progress";
  } else {
    nextStatus = existingAssignment.status;
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    module_progress: updatedProgress,
    progress_pct: progressPct,
    status: nextStatus,
    started_at: existingAssignment.startedAt ?? nowIso
  };

  if (quizResult) {
    updatePayload.quiz_score = quizResult.score;
    updatePayload.quiz_attempts = existingAssignment.quizAttempts + 1;
  }

  if (allComplete) {
    updatePayload.completed_at = nowIso;
  }

  // ── Generate certificate if all modules complete and certificate_template is set ──
  let certificatePath: string | null = existingAssignment.certificateUrl;

  if (allComplete && parsedCourse.data.certificate_template) {
    try {
      const certIdSuffix = now.getTime();
      const certificateId = `${assignmentId}-${certIdSuffix}`;
      const safeCourseTitle = sanitizeFileName(
        existingAssignment.courseTitle.toLowerCase().replace(/\s+/g, "-")
      );
      const certificateFileName = `${safeCourseTitle}-${certificateId}.pdf`;
      certificatePath = `${orgId}/learning/certificates/${certificateFileName}`;

      const certificatePdf = await renderLearningCertificatePdf({
        orgName: session.org?.name ?? "Crew Hub",
        employeeName: existingAssignment.employeeName,
        courseTitle: existingAssignment.courseTitle,
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

      updatePayload.certificate_url = certificatePath;
    } catch (error) {
      console.error("Unable to generate learning certificate PDF.", {
        assignmentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // ── Persist update ──
  const { data: updatedRow, error: updateError } = await supabase
    .from("course_assignments")
    .update(updatePayload)
    .eq("org_id", orgId)
    .eq("id", assignmentId)
    .select(assignmentSelectCols)
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "MODULE_PROGRESS_UPDATE_FAILED",
        message: "Unable to update module progress."
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

  const updatedAssignment = mapAssignmentRow(parsedUpdated.data);

  // ── Notifications on completion ──
  if (allComplete) {
    await createNotification({
      orgId,
      userId: updatedAssignment.employeeId,
      type: "certificate_ready",
      title: "Your certificate is ready",
      body: `Your certificate for "${updatedAssignment.courseTitle}" is ready.`,
      link: "/learning?tab=certificates"
    });
  }

  await logAudit({
    action: allComplete ? "submitted" : "updated",
    tableName: "course_assignments",
    recordId: assignmentId,
    oldValue: {
      status: existingAssignment.status,
      progressPct: existingAssignment.progressPct,
      moduleProgress: existingAssignment.moduleProgress
    },
    newValue: {
      status: updatedAssignment.status,
      progressPct: updatedAssignment.progressPct,
      moduleProgress: updatedProgress
    }
  });

  return jsonResponse<LearningModuleProgressResponseData>(200, {
    data: {
      assignment: updatedAssignment,
      quizResult
    },
    error: null,
    meta: buildMeta()
  });
}
