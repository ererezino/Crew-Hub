import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import type { ApiResponse } from "../../../../types/auth";
import {
  LEARNING_ASSIGNMENT_STATUSES,
  LEARNING_COURSE_CONTENT_TYPES,
  LEARNING_COURSE_DIFFICULTIES,
  LEARNING_COURSE_RECURRENCES,
  type LearningAssignmentRecord,
  type LearningCourseRecord
} from "../../../../types/learning";

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canManageLearning(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export function canViewLearningReports(roles: readonly UserRole[]): boolean {
  return canManageLearning(roles);
}

export function canViewTeamLearning(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

const QUIZ_SENSITIVE_FIELD_NAMES = new Set([
  "correct_answer",
  "is_correct",
  "answer_key",
  "correctAnswer",
  "isCorrect",
  "answerKey"
]);

function sanitizeLearningValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLearningValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, currentValue] of Object.entries(record)) {
    if (QUIZ_SENSITIVE_FIELD_NAMES.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeLearningValue(currentValue);
  }

  return sanitized;
}

export function sanitizeLearningModulesForViewer(
  modules: unknown[],
  roles: readonly UserRole[]
): unknown[] {
  if (canManageLearning(roles)) {
    return modules;
  }

  return modules.map((module) => sanitizeLearningValue(module));
}

export function parseInteger(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  return 0;
}

export function parseOptionalInteger(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseInteger(value);
}

export function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toUnknownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export const courseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  content_type: z.enum(LEARNING_COURSE_CONTENT_TYPES),
  content_url: z.string().nullable(),
  content_file_path: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  modules: z.unknown().optional(),
  duration_minutes: z.union([z.number(), z.string()]).nullable(),
  difficulty: z.enum(LEARNING_COURSE_DIFFICULTIES).nullable().optional(),
  passing_score: z.union([z.number(), z.string()]).nullable(),
  auto_assign_rules: z.unknown().optional(),
  is_mandatory: z.boolean(),
  allow_retake: z.boolean(),
  certificate_template: z.string().nullable(),
  recurrence: z.enum(LEARNING_COURSE_RECURRENCES).nullable().optional(),
  created_by: z.string().uuid().nullable(),
  is_published: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  assignment_count: z.union([z.number(), z.string()]).optional(),
  completion_count: z.union([z.number(), z.string()]).optional()
});

export const assignmentRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  course_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  status: z.enum(LEARNING_ASSIGNMENT_STATUSES),
  progress_pct: z.union([z.number(), z.string()]),
  module_progress: z.unknown().optional(),
  quiz_score: z.union([z.number(), z.string()]).nullable(),
  quiz_attempts: z.union([z.number(), z.string()]),
  due_date: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  certificate_url: z.string().nullable(),
  assigned_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  course: z
    .object({
      title: z.string(),
      category: z.string().nullable(),
      content_type: z.enum(LEARNING_COURSE_CONTENT_TYPES),
      duration_minutes: z.union([z.number(), z.string()]).nullable()
    })
    .nullable(),
  employee: z
    .object({
      full_name: z.string(),
      department: z.string().nullable(),
      country_code: z.string().nullable()
    })
    .nullable(),
  assigned_by_profile: z
    .object({
      full_name: z.string()
    })
    .nullable()
});

export function mapCourseRow(row: z.infer<typeof courseRowSchema>): LearningCourseRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    category: row.category,
    contentType: row.content_type,
    contentUrl: row.content_url,
    contentFilePath: row.content_file_path,
    thumbnailUrl: row.thumbnail_url,
    modules: toUnknownArray(row.modules),
    durationMinutes: parseOptionalInteger(row.duration_minutes),
    difficulty: row.difficulty ?? null,
    passingScore: parseOptionalInteger(row.passing_score),
    autoAssignRules: toUnknownArray(row.auto_assign_rules),
    isMandatory: row.is_mandatory,
    allowRetake: row.allow_retake,
    certificateTemplate: row.certificate_template,
    recurrence: row.recurrence ?? null,
    createdBy: row.created_by,
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignmentCount: parseInteger(row.assignment_count),
    completionCount: parseInteger(row.completion_count)
  };
}

export function mapAssignmentRow(
  row: z.infer<typeof assignmentRowSchema>
): LearningAssignmentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    courseId: row.course_id,
    courseTitle: row.course?.title ?? "Course",
    courseCategory: row.course?.category ?? null,
    courseContentType: row.course?.content_type ?? "document",
    courseDurationMinutes: parseOptionalInteger(row.course?.duration_minutes),
    employeeId: row.employee_id,
    employeeName: row.employee?.full_name ?? "Employee",
    employeeDepartment: row.employee?.department ?? null,
    employeeCountryCode: row.employee?.country_code ?? null,
    status: row.status,
    progressPct: parseInteger(row.progress_pct),
    moduleProgress: toUnknownRecord(row.module_progress),
    quizScore: parseOptionalInteger(row.quiz_score),
    quizAttempts: parseInteger(row.quiz_attempts),
    dueDate: row.due_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    certificateUrl: row.certificate_url,
    assignedBy: row.assigned_by,
    assignedByName: row.assigned_by_profile?.full_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
