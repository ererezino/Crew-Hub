import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { normalizeSurveyAnswers } from "../../../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  SurveyAnswerValue,
  SurveyQuestionResult,
  SurveyResultsResponseData
} from "../../../../../../types/surveys";
import {
  buildMeta,
  canManageSurveys,
  jsonResponse,
  mapSurveyRow,
  surveyRowSchema
} from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const responseSchema = z.object({
  id: z.string().uuid(),
  answers: z.unknown(),
  submitted_at: z.string()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function numericAnswer(value: SurveyAnswerValue): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function textAnswer(value: SurveyAnswerValue): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function buildQuestionResult({
  question,
  answersByResponse
}: {
  question: {
    id: string;
    text: string;
    type: "rating" | "text" | "select" | "likert";
    options: string[];
  };
  answersByResponse: Array<Record<string, SurveyAnswerValue>>;
}): SurveyQuestionResult {
  const values = answersByResponse
    .map((answers) => answers[question.id])
    .filter((value) => value !== null && value !== "");

  if (question.type === "rating") {
    const numericValues = values
      .map((value) => numericAnswer(value))
      .filter((value): value is number => typeof value === "number");

    const scoreCounts = new Map<number, number>();

    for (const score of numericValues) {
      scoreCounts.set(score, (scoreCounts.get(score) ?? 0) + 1);
    }

    const optionBreakdown = [...scoreCounts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([option, count]) => ({
        option: String(option),
        count
      }));

    const averageScore =
      numericValues.length > 0
        ? Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2))
        : null;

    return {
      questionId: question.id,
      questionText: question.text,
      questionType: question.type,
      responseCount: numericValues.length,
      averageScore,
      optionBreakdown,
      textResponses: []
    };
  }

  if (question.type === "text") {
    const textResponses = values
      .map((value) => textAnswer(value))
      .filter((value): value is string => typeof value === "string");

    return {
      questionId: question.id,
      questionText: question.text,
      questionType: question.type,
      responseCount: textResponses.length,
      averageScore: null,
      optionBreakdown: [],
      textResponses
    };
  }

  const optionCounts = new Map<string, number>();

  for (const value of values) {
    const optionValue = textAnswer(value);

    if (!optionValue) {
      continue;
    }

    optionCounts.set(optionValue, (optionCounts.get(optionValue) ?? 0) + 1);
  }

  const orderedOptions =
    question.options.length > 0 ? question.options : [...new Set(optionCounts.keys())];

  const optionBreakdown = orderedOptions.map((option) => ({
    option,
    count: optionCounts.get(option) ?? 0
  }));

  return {
    questionId: question.id,
    questionText: question.text,
    questionType: question.type,
    responseCount: values.length,
    averageScore: null,
    optionBreakdown,
    textResponses: []
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view survey results."
      },
      meta: buildMeta()
    });
  }

  if (!canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can view survey results."
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
        message: "Unable to load survey for results view."
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

  const { data: rawResponses, error: responsesError } = await supabase
    .from("survey_responses")
    .select("id, answers, submitted_at")
    .eq("org_id", session.profile.org_id)
    .eq("survey_id", survey.id)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true });

  if (responsesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSES_FETCH_FAILED",
        message: "Unable to load survey responses."
      },
      meta: buildMeta()
    });
  }

  const parsedResponses = z.array(responseSchema).safeParse(rawResponses ?? []);

  if (!parsedResponses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSES_PARSE_FAILED",
        message: "Survey responses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const totalResponses = parsedResponses.data.length;
  const hasMinimumResponses = totalResponses >= survey.minResponsesForResults;

  let questionResults: SurveyQuestionResult[] = [];
  let message: string | null = null;

  if (!hasMinimumResponses) {
    message = `Results are hidden until at least ${survey.minResponsesForResults} responses are submitted.`;
  } else {
    const answersByResponse = parsedResponses.data.map((response) =>
      normalizeSurveyAnswers(response.answers)
    );

    questionResults = survey.questions.map((question) =>
      buildQuestionResult({
        question: {
          id: question.id,
          text: question.text,
          type: question.type,
          options: question.options
        },
        answersByResponse
      })
    );
  }

  const responseData: SurveyResultsResponseData = {
    survey,
    totalResponses,
    minResponsesForResults: survey.minResponsesForResults,
    hasMinimumResponses,
    message,
    questionResults
  };

  return jsonResponse<SurveyResultsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
