import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { normalizeSurveyAnswers } from "../../../../../../../lib/surveys";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import {
  buildMeta,
  canManageSurveys,
  jsonResponse,
  mapSurveyRow,
  surveyRowSchema
} from "../../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const responseSchema = z.object({
  respondent_id: z.string().uuid().nullable(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  submitted_at: z.string(),
  answers: z.unknown()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function csvEscape(value: string | number | null): string {
  if (value === null) {
    return "";
  }

  const text = String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function fileSafeDate(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 8);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to export survey results."
      },
      meta: buildMeta()
    });
  }

  if (!canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can export survey results."
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
        message: "Unable to load survey before export."
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
    .select("respondent_id, department, country_code, submitted_at, answers")
    .eq("org_id", session.profile.org_id)
    .eq("survey_id", survey.id)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true });

  if (responsesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_RESPONSES_FETCH_FAILED",
        message: "Unable to load survey responses for export."
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

  if (totalResponses < survey.minResponsesForResults) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "MIN_RESPONSES_NOT_MET",
        message: `Survey results can be exported after at least ${survey.minResponsesForResults} responses.`
      },
      meta: buildMeta()
    });
  }

  const questionColumns = survey.questions.map((question) => ({
    key: question.id,
    label: question.text
  }));

  const header = [
    "survey_id",
    "survey_title",
    "submitted_at",
    "respondent_id",
    "department",
    "country_code",
    ...questionColumns.map((column) => column.label)
  ];

  const rows = parsedResponses.data.map((response) => {
    const answers = normalizeSurveyAnswers(response.answers);
    const baseColumns = [
      survey.id,
      survey.title,
      response.submitted_at,
      survey.isAnonymous ? null : response.respondent_id,
      response.department,
      response.country_code
    ];

    const answerColumns = questionColumns.map((column) => {
      const answer = answers[column.key];

      if (answer === null || typeof answer === "undefined") {
        return null;
      }

      return typeof answer === "boolean" ? (answer ? "true" : "false") : answer;
    });

    return [...baseColumns, ...answerColumns].map(csvEscape).join(",");
  });

  const csvContent = [header.map(csvEscape).join(","), ...rows].join("\n");
  const exportDate = fileSafeDate(new Date().toISOString());
  const fileName = `crew-hub-survey-results-${survey.id}-${exportDate}.csv`;

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`
    }
  });
}
