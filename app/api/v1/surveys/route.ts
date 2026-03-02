import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { logAudit } from "../../../../lib/audit";
import {
  isSurveyActiveNow,
  isSurveyQuestionType,
  normalizeSurveyAudience,
  surveyAudienceMatchesProfile
} from "../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type {
  SurveyAdminListResponseData,
  SurveyMutationResponseData,
  SurveyPendingListResponseData
} from "../../../../types/surveys";
import {
  buildMeta,
  canManageSurveys,
  jsonResponse,
  mapSurveyRow,
  surveyRowSchema
} from "./_helpers";

const querySchema = z.object({
  mode: z.enum(["pending", "admin"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(300).default(200)
});

const questionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(500),
  type: z.string().trim().refine((value) => isSurveyQuestionType(value), "Invalid question type."),
  required: z.coerce.boolean().default(false),
  scale: z.coerce.number().int().min(2).max(10).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional()
});

const createSurveySchema = z.object({
  title: z.string().trim().min(1, "Survey title is required.").max(200),
  description: z.string().trim().max(5000).optional(),
  type: z.enum(["engagement", "pulse", "onboarding", "exit", "custom"]),
  questions: z.array(questionSchema).min(1, "At least one question is required.").max(100),
  isAnonymous: z.coerce.boolean().default(true),
  minResponsesForResults: z.coerce.number().int().min(1).max(100).default(5),
  targetAudience: z
    .object({
      departments: z.array(z.string().trim().min(1).max(100)).optional(),
      employmentTypes: z.array(z.string().trim().min(1).max(40)).optional(),
      countries: z.array(z.string().trim().length(2).toUpperCase()).optional()
    })
    .optional(),
  status: z.enum(["draft", "active", "closed", "archived"]).default("draft"),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recurrence: z.enum(["weekly", "monthly", "quarterly"]).optional()
});

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view surveys."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid surveys query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  if (query.mode === "admin" && !canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can view survey administration data."
      },
      meta: buildMeta()
    });
  }

  const { data: rawSurveyRows, error: surveyError } = await supabase
    .from("surveys")
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(query.limit);

  if (surveyError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEYS_FETCH_FAILED",
        message: "Unable to load surveys."
      },
      meta: buildMeta()
    });
  }

  const parsedSurveyRows = z.array(surveyRowSchema).safeParse(rawSurveyRows ?? []);

  if (!parsedSurveyRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEYS_PARSE_FAILED",
        message: "Survey data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const mappedSurveys = parsedSurveyRows.data
    .map((row) => mapSurveyRow(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const surveyIds = mappedSurveys.map((survey) => survey.id);

  const [profileResult, responsesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("department, country_code, employment_type")
      .eq("org_id", session.profile.org_id)
      .eq("id", session.profile.id)
      .is("deleted_at", null)
      .maybeSingle(),
    surveyIds.length > 0
      ? supabase
          .from("survey_responses")
          .select("survey_id, respondent_id")
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .in("survey_id", surveyIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (profileResult.error || responsesResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEYS_AUX_FETCH_FAILED",
        message: "Unable to resolve survey audience or response metadata."
      },
      meta: buildMeta()
    });
  }

  const profileDepartment = typeof profileResult.data?.department === "string" ? profileResult.data.department : null;
  const profileCountryCode = typeof profileResult.data?.country_code === "string" ? profileResult.data.country_code : null;
  const profileEmploymentType = typeof profileResult.data?.employment_type === "string" ? profileResult.data.employment_type : null;

  const responseRows = (responsesResult.data ?? []) as Array<{
    survey_id: string;
    respondent_id: string | null;
  }>;
  const responseCountBySurveyId = new Map<string, number>();
  const respondedSurveyIds = new Set<string>();

  for (const row of responseRows) {
    if (!row.survey_id) {
      continue;
    }

    responseCountBySurveyId.set(
      row.survey_id,
      (responseCountBySurveyId.get(row.survey_id) ?? 0) + 1
    );

    if (row.respondent_id === session.profile.id) {
      respondedSurveyIds.add(row.survey_id);
    }
  }

  if (query.mode === "admin") {
    const surveys = mappedSurveys.map((survey) => ({
      ...survey,
      responseCount: responseCountBySurveyId.get(survey.id) ?? 0,
      hasResponded: false
    }));

    return jsonResponse<SurveyAdminListResponseData>(200, {
      data: {
        surveys
      },
      error: null,
      meta: buildMeta()
    });
  }

  const surveys = mappedSurveys
    .map((survey) => ({
      ...survey,
      responseCount: responseCountBySurveyId.get(survey.id) ?? 0,
      hasResponded: respondedSurveyIds.has(survey.id)
    }))
    .filter((survey) =>
      isSurveyActiveNow({
        status: survey.status,
        startDate: survey.startDate,
        endDate: survey.endDate
      })
    )
    .filter((survey) =>
      surveyAudienceMatchesProfile({
        audience: survey.targetAudience,
        department: profileDepartment,
        countryCode: profileCountryCode,
        employmentType: profileEmploymentType
      })
    )
    .filter((survey) => !survey.hasResponded)
    .sort((leftSurvey, rightSurvey) => {
      const leftDate = leftSurvey.endDate ?? leftSurvey.startDate ?? leftSurvey.createdAt;
      const rightDate = rightSurvey.endDate ?? rightSurvey.startDate ?? rightSurvey.createdAt;
      return leftDate.localeCompare(rightDate);
    });

  return jsonResponse<SurveyPendingListResponseData>(200, {
    data: {
      surveys
    },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create surveys."
      },
      meta: buildMeta()
    });
  }

  if (!canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can create surveys."
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

  const parsedBody = createSurveySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid survey payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;

  if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End date cannot be before start date."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawInsertedRow, error: insertError } = await supabase
    .from("surveys")
    .insert({
      org_id: session.profile.org_id,
      title: payload.title,
      description: payload.description?.trim() || null,
      type: payload.type,
      questions: payload.questions,
      is_anonymous: payload.isAnonymous,
      min_responses_for_results: payload.minResponsesForResults,
      target_audience: normalizeSurveyAudience(payload.targetAudience ?? {}),
      status: payload.status,
      start_date: payload.startDate ?? null,
      end_date: payload.endDate ?? null,
      recurrence: payload.recurrence ?? null,
      created_by: session.profile.id
    })
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .single();

  if (insertError || !rawInsertedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_CREATE_FAILED",
        message: "Unable to create survey."
      },
      meta: buildMeta()
    });
  }

  const parsedInserted = surveyRowSchema.safeParse(rawInsertedRow);

  if (!parsedInserted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Created survey is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const survey = mapSurveyRow(parsedInserted.data);

  if (!survey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Created survey is invalid."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "surveys",
    recordId: survey.id,
    newValue: {
      title: survey.title,
      type: survey.type,
      status: survey.status,
      questionCount: survey.questions.length
    }
  });

  return jsonResponse<SurveyMutationResponseData>(201, {
    data: {
      survey
    },
    error: null,
    meta: buildMeta()
  });
}
