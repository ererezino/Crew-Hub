import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { createBulkNotifications } from "../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { SurveyLaunchResponseData } from "../../../../../../types/surveys";
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to launch surveys."
      },
      meta: buildMeta()
    });
  }

  if (!canManageSurveys(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can launch surveys."
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
        message: "Unable to load survey before launch."
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

  const currentSurvey = mapSurveyRow(parsedSurvey.data);

  if (!currentSurvey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Survey data is invalid."
      },
      meta: buildMeta()
    });
  }

  const launchStartDate = currentSurvey.startDate ?? todayDateString();

  const { data: rawUpdatedSurvey, error: updateError } = await supabase
    .from("surveys")
    .update({
      status: "active",
      start_date: launchStartDate
    })
    .eq("id", surveyId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select(
      "id, org_id, title, description, type, questions, is_anonymous, min_responses_for_results, target_audience, status, start_date, end_date, recurrence, created_by, created_at, updated_at, created_by_profile:profiles!surveys_created_by_fkey(full_name)"
    )
    .single();

  if (updateError || !rawUpdatedSurvey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_LAUNCH_FAILED",
        message: "Unable to launch survey."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedSurvey = surveyRowSchema.safeParse(rawUpdatedSurvey);

  if (!parsedUpdatedSurvey.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Launched survey data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const launchedSurvey = mapSurveyRow(parsedUpdatedSurvey.data);

  if (!launchedSurvey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SURVEY_PARSE_FAILED",
        message: "Launched survey is invalid."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "submitted",
    tableName: "surveys",
    recordId: launchedSurvey.id,
    oldValue: {
      status: currentSurvey.status,
      startDate: currentSurvey.startDate
    },
    newValue: {
      status: launchedSurvey.status,
      startDate: launchedSurvey.startDate
    }
  });

  // Notify matching employees based on target_audience
  const serviceClient = createSupabaseServiceRoleClient();
  const audience = launchedSurvey.targetAudience;
  const hasDeptFilter = audience.departments.length > 0;
  const hasCountryFilter = audience.countries.length > 0;

  let recipientQuery = serviceClient
    .from("profiles")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (hasDeptFilter) {
    recipientQuery = recipientQuery.in("department", audience.departments);
  }

  if (hasCountryFilter) {
    recipientQuery = recipientQuery.in("country_code", audience.countries);
  }

  const { data: recipientRows, error: recipientError } = await recipientQuery;

  if (recipientError) {
    console.error("Unable to load survey notification recipients.", {
      surveyId: launchedSurvey.id,
      message: recipientError.message
    });
  } else {
    const recipientIds = (recipientRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    const closesText = launchedSurvey.endDate
      ? ` Closes ${launchedSurvey.endDate}.`
      : "";

    void createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: recipientIds,
      type: "survey_launched",
      title: "New survey available",
      body: `${launchedSurvey.title} is now open.${closesText}`,
      link: `/surveys/${launchedSurvey.id}`
    });
  }

  return jsonResponse<SurveyLaunchResponseData>(200, {
    data: {
      survey: launchedSurvey
    },
    error: null,
    meta: buildMeta()
  });
}
