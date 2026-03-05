import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { normalizeCourseCategory, normalizeNullableString } from "../../../../../../lib/learning";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  LEARNING_COURSE_CONTENT_TYPES,
  LEARNING_COURSE_DIFFICULTIES,
  LEARNING_COURSE_RECURRENCES,
  type LearningCourseMutationResponseData
} from "../../../../../../types/learning";
import {
  buildMeta,
  canManageLearning,
  courseRowSchema,
  jsonResponse,
  mapCourseRow,
  sanitizeModulesForEmployee
} from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const updateCourseSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    category: z.string().trim().max(60).optional(),
    contentType: z.enum(LEARNING_COURSE_CONTENT_TYPES).optional(),
    contentUrl: z.string().trim().url().optional(),
    contentFilePath: z.string().trim().max(500).optional(),
    thumbnailUrl: z.string().trim().url().optional(),
    modules: z.array(z.unknown()).optional(),
    durationMinutes: z.coerce.number().int().min(0).max(6000).optional(),
    difficulty: z.enum(LEARNING_COURSE_DIFFICULTIES).optional(),
    passingScore: z.coerce.number().int().min(0).max(100).optional(),
    autoAssignRules: z.array(z.unknown()).optional(),
    isMandatory: z.coerce.boolean().optional(),
    allowRetake: z.coerce.boolean().optional(),
    certificateTemplate: z.string().trim().max(5000).optional(),
    recurrence: z.enum(LEARNING_COURSE_RECURRENCES).optional(),
    isPublished: z.coerce.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view a course."
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

  const canManage = canManageLearning(session.profile.roles);
  const supabase = await createSupabaseServerClient();

  const { data: rawCourse, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (courseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_FETCH_FAILED",
        message: "Unable to load learning course."
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

  if (!canManage && !parsedCourse.data.is_published) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Learning course was not found."
      },
      meta: buildMeta()
    });
  }

  const course = mapCourseRow(parsedCourse.data);

  course.modules = sanitizeModulesForEmployee(
    course.modules,
    session.profile.roles
  );

  return jsonResponse<LearningCourseMutationResponseData>(200, {
    data: {
      course
    },
    error: null,
    meta: buildMeta()
  });
}

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
        message: "You must be logged in to update a course."
      },
      meta: buildMeta()
    });
  }

  if (!canManageLearning(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can update courses."
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

  const parsedBody = updateCourseSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid course update payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const courseId = parsedParams.data.id;

  const { data: existingRow, error: existingError } = await supabase
    .from("courses")
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("id", courseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_FETCH_FAILED",
        message: "Unable to load course before update."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = courseRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Learning course was not found."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;

  const { data: updatedRow, error: updateError } = await supabase
    .from("courses")
    .update({
      title: payload.title,
      description:
        payload.description !== undefined
          ? normalizeNullableString(payload.description)
          : undefined,
      category:
        payload.category !== undefined
          ? normalizeCourseCategory(payload.category)
          : undefined,
      content_type: payload.contentType,
      content_url:
        payload.contentUrl !== undefined
          ? normalizeNullableString(payload.contentUrl)
          : undefined,
      content_file_path:
        payload.contentFilePath !== undefined
          ? normalizeNullableString(payload.contentFilePath)
          : undefined,
      thumbnail_url:
        payload.thumbnailUrl !== undefined
          ? normalizeNullableString(payload.thumbnailUrl)
          : undefined,
      modules: payload.modules,
      duration_minutes: payload.durationMinutes,
      difficulty: payload.difficulty,
      passing_score: payload.passingScore,
      auto_assign_rules: payload.autoAssignRules,
      is_mandatory: payload.isMandatory,
      allow_retake: payload.allowRetake,
      certificate_template:
        payload.certificateTemplate !== undefined
          ? normalizeNullableString(payload.certificateTemplate)
          : undefined,
      recurrence: payload.recurrence,
      is_published: payload.isPublished
    })
    .eq("org_id", session.profile.org_id)
    .eq("id", courseId)
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_UPDATE_FAILED",
        message: "Unable to update learning course."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdated = courseRowSchema.safeParse(updatedRow);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COURSE_PARSE_FAILED",
        message: "Updated course is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const course = mapCourseRow(parsedUpdated.data);

  await logAudit({
    action: "updated",
    tableName: "courses",
    recordId: course.id,
    oldValue: {
      title: parsedExisting.data.title,
      category: parsedExisting.data.category,
      isPublished: parsedExisting.data.is_published
    },
    newValue: {
      title: course.title,
      category: course.category,
      isPublished: course.isPublished
    }
  });

  return jsonResponse<LearningCourseMutationResponseData>(200, {
    data: {
      course
    },
    error: null,
    meta: buildMeta()
  });
}
