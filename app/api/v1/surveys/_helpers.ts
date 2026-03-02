import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isSurveyRecurrence,
  isSurveyStatus,
  isSurveyType,
  normalizeSurveyAnswers,
  normalizeSurveyAudience,
  normalizeSurveyQuestions
} from "../../../../lib/surveys";
import { hasRole } from "../../../../lib/roles";
import type { UserRole } from "../../../../lib/navigation";
import type { ApiResponse } from "../../../../types/auth";
import type {
  SurveyRecord,
  SurveyResponseRecord,
  SurveyStatus,
  SurveyType,
  SurveyRecurrence
} from "../../../../types/surveys";

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canManageSurveys(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
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

export function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const surveyRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  questions: z.unknown(),
  is_anonymous: z.boolean(),
  min_responses_for_results: z.union([z.number(), z.string()]),
  target_audience: z.unknown(),
  status: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  recurrence: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by_profile: z
    .object({
      full_name: z.string()
    })
    .nullable()
    .optional(),
  response_count: z.union([z.number(), z.string()]).optional(),
  has_responded: z.boolean().optional()
});

export const surveyResponseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  survey_id: z.string().uuid(),
  respondent_id: z.string().uuid().nullable(),
  answers: z.unknown(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  submitted_at: z.string(),
  created_at: z.string()
});

export const profileAudienceRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  employment_type: z.string().nullable()
});

export function mapSurveyRow(row: z.infer<typeof surveyRowSchema>): SurveyRecord | null {
  if (!isSurveyType(row.type) || !isSurveyStatus(row.status)) {
    return null;
  }

  const recurrence: SurveyRecurrence | null =
    row.recurrence && isSurveyRecurrence(row.recurrence) ? row.recurrence : null;

  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    type: row.type as SurveyType,
    questions: normalizeSurveyQuestions(row.questions),
    isAnonymous: row.is_anonymous,
    minResponsesForResults: parseInteger(row.min_responses_for_results),
    targetAudience: normalizeSurveyAudience(row.target_audience),
    status: row.status as SurveyStatus,
    startDate: row.start_date,
    endDate: row.end_date,
    recurrence,
    createdBy: row.created_by,
    createdByName: row.created_by_profile?.full_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    responseCount: parseInteger(row.response_count),
    hasResponded: Boolean(row.has_responded)
  };
}

export function mapSurveyResponseRow(
  row: z.infer<typeof surveyResponseRowSchema>
): SurveyResponseRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    surveyId: row.survey_id,
    respondentId: row.respondent_id,
    answers: normalizeSurveyAnswers(row.answers),
    department: row.department,
    countryCode: row.country_code,
    submittedAt: row.submitted_at,
    createdAt: row.created_at
  };
}
