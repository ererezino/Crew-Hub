import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import {
  isSurveyActiveNow,
  normalizeSurveyAnswers,
  surveyAudienceMatchesProfile,
  validateAnswerForQuestion
} from "../../../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { SurveyResponseMutationResponseData } from "../../../../../../types/surveys";
import {
  buildMeta,
  jsonResponse,
  mapSurveyResponseRow,
  mapSurveyRow,
  profileAudienceRowSchema,
  surveyResponseRowSchema,
  surveyRowSchema
} from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const respondSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to submit a survey response."
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

  const parsedBody = respondSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid survey response payload."
      },
      meta: buildMeta()
    });
  }

  const surveyId = parsedParams.data.id;
  const supabase = await createSupabaseServerClient();

  const { data: rawSurvey, error: surveyError } = await supabase
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
        message: "Unable to load survey before response submission."
      },
      meta: buildMeta()
    });
  }

  if (!rawSurvey) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Survey not found."
      },
      meta: buildMeta()
    });
  }

  const parsedSurvey = surveyRowSchema.safeParse(rawSurvey);

  if (!parsedSurvey.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Survey data is not in the expected shape."
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
        message: "Survey data is invalid."
      },
      meta: buildMeta()
    });
  }

  const { data: rawProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, department, country_code, employment_type")
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError || !rawProfile) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to load profile context for survey response."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = profileAudienceRowSchema.safeParse(rawProfile);

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
        message: "You are not allowed to respond to this survey."
      },
      meta: buildMeta()
    });
  }

  const { data: existingResponse, error: existingResponseError } = await supabase
    .from("survey_responses")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("survey_id", survey.id)
    .eq("respondent_id", session.profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingResponseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSE_FETCH_FAILED",
        message: "Unable to verify existing survey response state."
      },
      meta: buildMeta()
    });
  }

  if (existingResponse?.id) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SURVEY_ALREADY_RESPONDED",
        message: "Survey has already been submitted by this user."
      },
      meta: buildMeta()
    });
  }

  const answers = normalizeSurveyAnswers(parsedBody.data.answers);

  for (const question of survey.questions) {
    const answer = answers[question.id] ?? null;
    const validationError = validateAnswerForQuestion({
      question,
      answer
    });

    if (validationError) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: validationError
        },
        meta: buildMeta()
      });
    }
  }

  const { data: rawInsertedResponse, error: insertError } = await supabase
    .from("survey_responses")
    .insert({
      org_id: session.profile.org_id,
      survey_id: survey.id,
      respondent_id: session.profile.id,
      answers,
      department: parsedProfile.data.department,
      country_code: parsedProfile.data.country_code
    })
    .select("id, org_id, survey_id, respondent_id, answers, department, country_code, submitted_at, created_at")
    .single();

  if (insertError || !rawInsertedResponse) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSE_CREATE_FAILED",
        message: "Unable to submit survey response."
      },
      meta: buildMeta()
    });
  }

  const parsedInsertedResponse = surveyResponseRowSchema.safeParse(rawInsertedResponse);

  if (!parsedInsertedResponse.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSE_PARSE_FAILED",
        message: "Submitted survey response is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const response = mapSurveyResponseRow(parsedInsertedResponse.data);

  await logAudit({
    action: "submitted",
    tableName: "survey_responses",
    recordId: response.id,
    newValue: {
      surveyId: survey.id,
      questionCount: survey.questions.length,
      isAnonymous: survey.isAnonymous
    }
  });

  return jsonResponse<SurveyResponseMutationResponseData>(201, {
    data: {
      response
    },
    error: null,
    meta: buildMeta()
  });
}
