import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { normalizeSurveyAnswers } from "../../../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  SurveyAnswerValue,
  SurveyHeatmapCell,
  SurveyHeatmapData,
  SurveyQuestionResult,
  SurveyResultsResponseData,
  SurveyTrendData,
  SurveyTrendPoint
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
  submitted_at: z.string(),
  department: z.string().nullable().optional(),
  respondent_id: z.string().uuid().nullable().optional()
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

// ── Heatmap builder ──

function buildHeatmap({
  questions,
  responseRows,
  minResponses
}: {
  questions: Array<{ id: string; text: string; type: string }>;
  responseRows: Array<{
    answers: Record<string, SurveyAnswerValue>;
    department: string | null;
  }>;
  minResponses: number;
}): SurveyHeatmapData | null {
  const ratingQuestions = questions.filter(
    (q) => q.type === "rating" || q.type === "likert"
  );

  if (ratingQuestions.length === 0) return null;

  const departmentMap = new Map<
    string,
    Array<Record<string, SurveyAnswerValue>>
  >();

  for (const row of responseRows) {
    const dept = row.department?.trim() || "Unknown";

    if (!departmentMap.has(dept)) {
      departmentMap.set(dept, []);
    }

    departmentMap.get(dept)!.push(row.answers);
  }

  const departments = [...departmentMap.keys()].sort();
  const cells: SurveyHeatmapCell[] = [];

  for (const dept of departments) {
    const deptAnswers = departmentMap.get(dept) ?? [];

    if (deptAnswers.length < minResponses) {
      for (const question of ratingQuestions) {
        cells.push({
          department: dept,
          questionId: question.id,
          averageScore: null,
          responseCount: deptAnswers.length,
          protected: true
        });
      }

      continue;
    }

    for (const question of ratingQuestions) {
      const scores = deptAnswers
        .map((a) => numericAnswer(a[question.id]))
        .filter((v): v is number => v !== null);

      const avg =
        scores.length > 0
          ? Number(
              (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)
            )
          : null;

      cells.push({
        department: dept,
        questionId: question.id,
        averageScore: avg,
        responseCount: scores.length,
        protected: scores.length < minResponses
      });
    }
  }

  return {
    departments,
    questions: ratingQuestions.map((q) => ({ id: q.id, text: q.text })),
    cells
  };
}

// ── Trend builder ──

async function buildTrend({
  survey,
  supabase,
  orgId
}: {
  survey: {
    id: string;
    title: string;
    recurrence: string | null;
    questions: Array<{ id: string; text: string; type: string }>;
  };
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}): Promise<SurveyTrendData | null> {
  if (!survey.recurrence) return null;

  const { data: historicalSurveys, error: histError } = await supabase
    .from("surveys")
    .select("id, title, end_date, status, questions")
    .eq("org_id", orgId)
    .eq("title", survey.title)
    .eq("status", "closed")
    .is("deleted_at", null)
    .order("end_date", { ascending: true });

  if (histError || !historicalSurveys || historicalSurveys.length < 2) {
    return null;
  }

  const ratingQuestions = survey.questions.filter(
    (q) => q.type === "rating" || q.type === "likert"
  );

  if (ratingQuestions.length === 0) return null;

  const points: SurveyTrendPoint[] = [];

  for (const hist of historicalSurveys) {
    const { data: responses } = await supabase
      .from("survey_responses")
      .select("answers")
      .eq("org_id", orgId)
      .eq("survey_id", hist.id)
      .is("deleted_at", null);

    if (!responses || responses.length === 0) continue;

    const answersList = responses.map((r) =>
      normalizeSurveyAnswers(r.answers)
    );

    for (const question of ratingQuestions) {
      const scores = answersList
        .map((a) => numericAnswer(a[question.id]))
        .filter((v): v is number => v !== null);

      const avg =
        scores.length > 0
          ? Number(
              (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)
            )
          : null;

      points.push({
        surveyId: hist.id as string,
        surveyTitle: hist.title as string,
        closedAt: (hist.end_date as string) ?? "",
        questionId: question.id,
        questionText: question.text,
        averageScore: avg
      });
    }
  }

  if (points.length === 0) return null;

  const instanceIds = [...new Set(points.map((p) => p.surveyId))];
  const firstInstancePoints = points.filter((p) => p.surveyId === instanceIds[0]);
  const lastInstancePoints = points.filter(
    (p) => p.surveyId === instanceIds[instanceIds.length - 1]
  );

  const firstAvg =
    firstInstancePoints.filter((p) => p.averageScore !== null).length > 0
      ? firstInstancePoints
          .filter((p) => p.averageScore !== null)
          .reduce((s, p) => s + (p.averageScore ?? 0), 0) /
        firstInstancePoints.filter((p) => p.averageScore !== null).length
      : 0;

  const lastAvg =
    lastInstancePoints.filter((p) => p.averageScore !== null).length > 0
      ? lastInstancePoints
          .filter((p) => p.averageScore !== null)
          .reduce((s, p) => s + (p.averageScore ?? 0), 0) /
        lastInstancePoints.filter((p) => p.averageScore !== null).length
      : 0;

  const diff = lastAvg - firstAvg;
  const trendDirection: "up" | "down" | "flat" =
    diff > 0.1 ? "up" : diff < -0.1 ? "down" : "flat";

  return {
    instanceCount: instanceIds.length,
    trendDirection,
    points
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
  const orgId = session.profile.org_id;

  const { data: rawSurvey, error: surveyError } = await supabase
    .from("surveys")
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .eq("id", surveyId)
    .eq("org_id", orgId)
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

  // Anonymous survey: select department for heatmap, but NEVER select respondent_id
  const selectCols = survey.isAnonymous
    ? "id, answers, submitted_at, department"
    : "id, answers, submitted_at, department, respondent_id";

  const { data: rawResponses, error: responsesError } = await supabase
    .from("survey_responses")
    .select(selectCols)
    .eq("org_id", orgId)
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

  // ── Anonymous protection: if anonymous + below threshold, return protected ──
  if (survey.isAnonymous && !hasMinimumResponses) {
    const protectedData: SurveyResultsResponseData = {
      survey,
      totalResponses,
      minResponsesForResults: survey.minResponsesForResults,
      hasMinimumResponses: false,
      protected: true,
      message: "Not enough responses to display results.",
      questionResults: [],
      heatmap: null,
      trend: null
    };

    return jsonResponse<SurveyResultsResponseData>(200, {
      data: protectedData,
      error: null,
      meta: buildMeta()
    });
  }

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

  // ── Build heatmap for engagement/pulse/custom with rating questions ──
  let heatmap: SurveyHeatmapData | null = null;

  if (
    hasMinimumResponses &&
    (survey.type === "engagement" || survey.type === "pulse" || survey.type === "custom")
  ) {
    const responseRows = parsedResponses.data.map((r) => ({
      answers: normalizeSurveyAnswers(r.answers),
      department: r.department ?? null
    }));

    heatmap = buildHeatmap({
      questions: survey.questions,
      responseRows,
      minResponses: survey.minResponsesForResults
    });
  }

  // ── Build trend for recurring surveys ──
  let trend: SurveyTrendData | null = null;

  if (survey.recurrence) {
    trend = await buildTrend({
      survey: {
        id: survey.id,
        title: survey.title,
        recurrence: survey.recurrence,
        questions: survey.questions
      },
      supabase,
      orgId
    });
  }

  const responseData: SurveyResultsResponseData = {
    survey,
    totalResponses,
    minResponsesForResults: survey.minResponsesForResults,
    hasMinimumResponses,
    protected: false,
    message,
    questionResults,
    heatmap,
    trend
  };

  return jsonResponse<SurveyResultsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
