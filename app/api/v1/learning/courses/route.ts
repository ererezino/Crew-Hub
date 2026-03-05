import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { normalizeCourseCategory, normalizeNullableString } from "../../../../../lib/learning";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  LEARNING_COURSE_CONTENT_TYPES,
  LEARNING_COURSE_DIFFICULTIES,
  LEARNING_COURSE_RECURRENCES,
  type LearningCourseMutationResponseData,
  type LearningCoursesResponseData
} from "../../../../../types/learning";
import {
  buildMeta,
  canManageLearning,
  courseRowSchema,
  jsonResponse,
  mapCourseRow,
  sanitizeLearningModulesForViewer
} from "../_helpers";

const querySchema = z.object({
  includeDraft: z.coerce.boolean().default(false),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(200)
});

const createCourseSchema = z.object({
  title: z.string().trim().min(1, "Course title is required.").max(200),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(60).optional(),
  contentType: z.enum(LEARNING_COURSE_CONTENT_TYPES),
  contentUrl: z.string().trim().url("Content URL must be valid.").optional(),
  contentFilePath: z.string().trim().max(500).optional(),
  thumbnailUrl: z.string().trim().url("Thumbnail URL must be valid.").optional(),
  modules: z.array(z.unknown()).default([]),
  durationMinutes: z.coerce.number().int().min(0).max(6000).optional(),
  difficulty: z.enum(LEARNING_COURSE_DIFFICULTIES).optional(),
  passingScore: z.coerce.number().int().min(0).max(100).optional(),
  autoAssignRules: z.array(z.unknown()).default([]),
  isMandatory: z.coerce.boolean().default(false),
  allowRetake: z.coerce.boolean().default(true),
  certificateTemplate: z.string().trim().max(5000).optional(),
  recurrence: z.enum(LEARNING_COURSE_RECURRENCES).optional(),
  isPublished: z.coerce.boolean().default(false)
});

type CourseCountRow = {
  course_id: string;
  status: string;
};

function jsonResponseWith<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponseWith<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to browse learning courses."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponseWith<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid course query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();
  const viewerRoles = session.profile.roles;
  const canManage = canManageLearning(viewerRoles);

  let coursesQuery = supabase
    .from("courses")
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(query.limit);

  const categoryFilter = normalizeCourseCategory(query.category);

  if (categoryFilter) {
    coursesQuery = coursesQuery.eq("category", categoryFilter);
  }

  if (!canManage || !query.includeDraft) {
    coursesQuery = coursesQuery.eq("is_published", true);
  }

  const { data: rawCourses, error: coursesError } = await coursesQuery;

  if (coursesError) {
    return jsonResponseWith<null>(500, {
      data: null,
      error: {
        code: "COURSES_FETCH_FAILED",
        message: "Unable to load learning courses."
      },
      meta: buildMeta()
    });
  }

  const parsedCourses = z.array(courseRowSchema).safeParse(rawCourses ?? []);

  if (!parsedCourses.success) {
    return jsonResponseWith<null>(500, {
      data: null,
      error: {
        code: "COURSES_PARSE_FAILED",
        message: "Learning courses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const courseIds = parsedCourses.data.map((row) => row.id);
  const countByCourseId = new Map<string, { total: number; completed: number }>();

  if (courseIds.length > 0) {
    const { data: rawCountRows, error: countError } = await supabase
      .from("course_assignments")
      .select("course_id, status")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("course_id", courseIds);

    if (countError) {
      return jsonResponseWith<null>(500, {
        data: null,
        error: {
          code: "COURSE_COUNTS_FETCH_FAILED",
          message: "Unable to load course assignment counts."
        },
        meta: buildMeta()
      });
    }

    for (const row of (rawCountRows ?? []) as CourseCountRow[]) {
      if (!row.course_id) {
        continue;
      }

      const currentValue = countByCourseId.get(row.course_id) ?? { total: 0, completed: 0 };
      currentValue.total += 1;

      if (row.status === "completed") {
        currentValue.completed += 1;
      }

      countByCourseId.set(row.course_id, currentValue);
    }
  }

  const courses = parsedCourses.data.map((row) => {
    const counts = countByCourseId.get(row.id) ?? { total: 0, completed: 0 };
    const course = mapCourseRow({
      ...row,
      assignment_count: counts.total,
      completion_count: counts.completed
    });

    course.modules = sanitizeLearningModulesForViewer(course.modules, viewerRoles);
    return course;
  });

  return jsonResponse<LearningCoursesResponseData>(200, {
    data: {
      courses
    },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponseWith<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create courses."
      },
      meta: buildMeta()
    });
  }

  if (!canManageLearning(session.profile.roles)) {
    return jsonResponseWith<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can create courses."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponseWith<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = createCourseSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponseWith<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid course payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const supabase = await createSupabaseServerClient();

  const { data: insertedRow, error: insertError } = await supabase
    .from("courses")
    .insert({
      org_id: session.profile.org_id,
      title: payload.title,
      description: normalizeNullableString(payload.description),
      category: normalizeCourseCategory(payload.category),
      content_type: payload.contentType,
      content_url: normalizeNullableString(payload.contentUrl),
      content_file_path: normalizeNullableString(payload.contentFilePath),
      thumbnail_url: normalizeNullableString(payload.thumbnailUrl),
      modules: payload.modules,
      duration_minutes: payload.durationMinutes ?? null,
      difficulty: payload.difficulty ?? null,
      passing_score: payload.passingScore ?? null,
      auto_assign_rules: payload.autoAssignRules,
      is_mandatory: payload.isMandatory,
      allow_retake: payload.allowRetake,
      certificate_template: normalizeNullableString(payload.certificateTemplate),
      recurrence: payload.recurrence ?? null,
      created_by: session.profile.id,
      is_published: payload.isPublished
    })
    .select(
      "id, org_id, title, description, category, content_type, content_url, content_file_path, thumbnail_url, modules, duration_minutes, difficulty, passing_score, auto_assign_rules, is_mandatory, allow_retake, certificate_template, recurrence, created_by, is_published, created_at, updated_at"
    )
    .single();

  if (insertError || !insertedRow) {
    return jsonResponseWith<null>(500, {
      data: null,
      error: {
        code: "COURSE_CREATE_FAILED",
        message: "Unable to create learning course."
      },
      meta: buildMeta()
    });
  }

  const parsedInserted = courseRowSchema.safeParse(insertedRow);

  if (!parsedInserted.success) {
    return jsonResponseWith<null>(500, {
      data: null,
      error: {
        code: "COURSE_PARSE_FAILED",
        message: "Created course is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const course = mapCourseRow(parsedInserted.data);

  await logAudit({
    action: "created",
    tableName: "courses",
    recordId: course.id,
    newValue: {
      title: course.title,
      category: course.category,
      contentType: course.contentType,
      isPublished: course.isPublished
    }
  });

  return jsonResponse<LearningCourseMutationResponseData>(201, {
    data: {
      course
    },
    error: null,
    meta: buildMeta()
  });
}
