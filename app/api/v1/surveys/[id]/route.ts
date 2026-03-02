import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import {
  isSurveyActiveNow,
  isSurveyQuestionType,
  normalizeSurveyAudience,
  surveyAudienceMatchesProfile
} from "../../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  SurveyDetailResponseData,
  SurveyMutationResponseData
} from "../../../../../types/surveys";
import {
  buildMeta,
  canManageSurveys,
  jsonResponse,
  mapSurveyRow,
  profileAudienceRowSchema,
  surveyRowSchema
} from "../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const questionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(500),
  type: z.string().trim().refine((value) => isSurveyQuestionType(value), "Invalid question type."),
  required: z.coerce.boolean().default(false),
  scale: z.coerce.number().int().min(2).max(10).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional()
});

const updateSurveySchema = z
  .object({
    title: z.string().trim().min(1, "Survey title is required.").max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    type: z.enum(["engagement", "pulse", "onboarding", "exit", "custom"]).optional(),
    questions: z.array(questionSchema).min(1).max(100).optional(),
    isAnonymous: z.coerce.boolean().optional(),
    minResponsesForResults: z.coerce.number().int().min(1).max(100).optional(),
    targetAudience: z
      .object({
        departments: z.array(z.string().trim().min(1).max(100)).optional(),
        employmentTypes: z.array(z.string().trim().min(1).max(40)).optional(),
        countries: z.array(z.string().trim().length(2).toUpperCase()).optional()
      })
      .nullable()
      .optional(),
    status: z.enum(["draft", "active", "closed", "archived"]).optional(),
    startDate: z
      .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
      .optional(),
    endDate: z
      .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
      .optional(),
    recurrence: z
      .union([z.enum(["weekly", "monthly", "quarterly"]), z.null()])
      .optional()
  })
  .refine(
    (value) =>
      Object.values(value).some((fieldValue) => typeof fieldValue !== "undefined"),
    "At least one field is required to update survey."
  );

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view survey details."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Survey id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const surveyId = parsedParams.data.id;
  const supabase = await createSupabaseServerClient();

  const { data: rawSurveyRow, error: surveyError } = await supabase
    .from("surveys")
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .eq("id", surveyId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (surveyError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_FETCH_FAILED",
        message: "Unable to load survey detail."
      },
      meta: buildMeta()
    });
  }

  if (!rawSurveyRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Survey not found."
      },
      meta: buildMeta()
    });
  }

  const parsedSurvey = surveyRowSchema.safeParse(rawSurveyRow);

  if (!parsedSurvey.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Survey detail data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const survey = mapSurveyRow(parsedSurvey.data);

  if (!survey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Survey detail is invalid."
      },
      meta: buildMeta()
    });
  }

  const { data: rawResponseRow, error: responseRowError } = await supabase
    .from("survey_responses")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("survey_id", survey.id)
    .eq("respondent_id", session.profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (responseRowError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSE_FETCH_FAILED",
        message: "Unable to load survey response state."
      },
      meta: buildMeta()
    });
  }

  const hasResponded = typeof rawResponseRow?.id === "string";
  const responseId = hasResponded ? rawResponseRow?.id ?? null : null;

  if (!canManageSurveys(session.profile.roles)) {
    const { data: rawProfileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, org_id, department, country_code, employment_type")
      .eq("id", session.profile.id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (profileError || !rawProfileRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_FETCH_FAILED",
          message: "Unable to load profile context for survey audience checks."
        },
        meta: buildMeta()
      });
    }

    const parsedProfile = profileAudienceRowSchema.safeParse(rawProfileRow);

    if (!parsedProfile.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_PARSE_FAILED",
          message: "Profile context is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const activeSurvey = isSurveyActiveNow({
      status: survey.status,
      startDate: survey.startDate,
      endDate: survey.endDate
    });

    const inTargetAudience = surveyAudienceMatchesProfile({
      audience: survey.targetAudience,
      department: parsedProfile.data.department,
      countryCode: parsedProfile.data.country_code,
      employmentType: parsedProfile.data.employment_type
    });

    if (!activeSurvey || !inTargetAudience) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to access this survey."
        },
        meta: buildMeta()
      });
    }
  }

  return jsonResponse<SurveyDetailResponseData>(200, {
    data: {
      survey: {
        ...survey,
        hasResponded
      },
      hasResponded,
      responseId
    },
    error: null,
    meta: buildMeta()
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update surveys."
      },
      meta: buildMeta()
    });
  }

  if (!canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can update surveys."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Survey id must be a valid UUID."
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

  const parsedBody = updateSurveySchema.safeParse(body);

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

  const supabase = await createSupabaseServerClient();
  const surveyId = parsedParams.data.id;

  const { data: rawExistingRow, error: existingRowError } = await supabase
    .from("surveys")
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .eq("id", surveyId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingRowError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_FETCH_FAILED",
        message: "Unable to load survey before update."
      },
      meta: buildMeta()
    });
  }

  if (!rawExistingRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Survey not found."
      },
      meta: buildMeta()
    });
  }

  const existingParsed = surveyRowSchema.safeParse(rawExistingRow);

  if (!existingParsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Existing survey data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const existingSurvey = mapSurveyRow(existingParsed.data);

  if (!existingSurvey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Existing survey data is invalid."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const nextStartDate = payload.startDate === undefined ? existingSurvey.startDate : payload.startDate;
  const nextEndDate = payload.endDate === undefined ? existingSurvey.endDate : payload.endDate;

  if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End date cannot be before start date."
      },
      meta: buildMeta()
    });
  }

  const updatePayload: Record<string, unknown> = {};

  if (payload.title !== undefined) {
    updatePayload.title = payload.title;
  }

  if (payload.description !== undefined) {
    updatePayload.description = payload.description?.trim() || null;
  }

  if (payload.type !== undefined) {
    updatePayload.type = payload.type;
  }

  if (payload.questions !== undefined) {
    updatePayload.questions = payload.questions;
  }

  if (payload.isAnonymous !== undefined) {
    updatePayload.is_anonymous = payload.isAnonymous;
  }

  if (payload.minResponsesForResults !== undefined) {
    updatePayload.min_responses_for_results = payload.minResponsesForResults;
  }

  if (payload.targetAudience !== undefined) {
    updatePayload.target_audience = normalizeSurveyAudience(payload.targetAudience ?? {});
  }

  if (payload.status !== undefined) {
    updatePayload.status = payload.status;
  }

  if (payload.startDate !== undefined) {
    updatePayload.start_date = payload.startDate;
  }

  if (payload.endDate !== undefined) {
    updatePayload.end_date = payload.endDate;
  }

  if (payload.recurrence !== undefined) {
    updatePayload.recurrence = payload.recurrence;
  }

  const { data: rawUpdatedRow, error: updateError } = await supabase
    .from("surveys")
    .update(updatePayload)
    .eq("id", surveyId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .single();

  if (updateError || !rawUpdatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_UPDATE_FAILED",
        message: "Unable to update survey."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdated = surveyRowSchema.safeParse(rawUpdatedRow);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Updated survey data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const survey = mapSurveyRow(parsedUpdated.data);

  if (!survey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Updated survey is invalid."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "surveys",
    recordId: survey.id,
    oldValue: {
      title: existingSurvey.title,
      status: existingSurvey.status,
      questionCount: existingSurvey.questions.length,
      startDate: existingSurvey.startDate,
      endDate: existingSurvey.endDate
    },
    newValue: {
      title: survey.title,
      status: survey.status,
      questionCount: survey.questions.length,
      startDate: survey.startDate,
      endDate: survey.endDate
    }
  });

  return jsonResponse<SurveyMutationResponseData>(200, {
    data: {
      survey
    },
    error: null,
    meta: buildMeta()
  });
}
