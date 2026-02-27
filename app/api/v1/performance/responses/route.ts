import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { normalizeReviewSections } from "../../../../../lib/performance/reviews";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  SaveReviewResponseData,
  SaveReviewResponsePayload
} from "../../../../../types/performance";
import {
  assignmentRowSchema,
  buildMeta,
  cycleRowSchema,
  jsonResponse,
  mapAssignmentRows,
  mapCycleRow,
  mapResponseRow,
  mapTemplateRow,
  profileRowSchema,
  responseRowSchema,
  templateRowSchema
} from "../_helpers";

const answerValueSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  text: z.string().trim().max(4000).nullable().optional()
});

const payloadSchema = z.object({
  assignmentId: z.string().uuid(),
  responseType: z.enum(["self", "manager"]),
  answers: z.record(z.string(), answerValueSchema),
  submit: z.boolean().default(false)
});

const existingResponseRowSchema = z.object({
  id: z.string().uuid(),
  submitted_at: z.string().nullable()
});

function nextAssignmentStatus({
  hasSelfSubmitted,
  hasManagerSubmitted
}: {
  hasSelfSubmitted: boolean;
  hasManagerSubmitted: boolean;
}): "pending_self" | "pending_manager" | "in_review" | "completed" {
  if (hasSelfSubmitted && hasManagerSubmitted) {
    return "completed";
  }

  if (hasSelfSubmitted) {
    return "pending_manager";
  }

  if (hasManagerSubmitted) {
    return "in_review";
  }

  return "pending_self";
}

function isRequiredQuestionAnswered({
  type,
  answer
}: {
  type: "rating" | "text";
  answer: { rating?: number | null; text?: string | null } | undefined;
}): boolean {
  if (!answer) {
    return false;
  }

  if (type === "rating") {
    return typeof answer.rating === "number" && answer.rating >= 1 && answer.rating <= 5;
  }

  return typeof answer.text === "string" && answer.text.trim().length > 0;
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to save review responses."
      },
      meta: buildMeta()
    });
  }

  let payloadValue: unknown;

  try {
    payloadValue = await request.json();
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

  const parsedPayload = payloadSchema.safeParse(payloadValue);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid review response payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data as SaveReviewResponsePayload;

  try {
    const supabase = await createSupabaseServerClient();
    const orgId = session.profile.org_id;
    const userId = session.profile.id;

    const { data: rawAssignment, error: assignmentError } = await supabase
      .from("review_assignments")
      .select(
        "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("id", payload.assignmentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (assignmentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_FETCH_FAILED",
          message: "Unable to load review assignment."
        },
        meta: buildMeta()
      });
    }

    const parsedAssignment = assignmentRowSchema.safeParse(rawAssignment);

    if (!parsedAssignment.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Review assignment was not found."
        },
        meta: buildMeta()
      });
    }

    if (
      (payload.responseType === "self" && parsedAssignment.data.employee_id !== userId) ||
      (payload.responseType === "manager" && parsedAssignment.data.reviewer_id !== userId)
    ) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to edit this response type for the assignment."
        },
        meta: buildMeta()
      });
    }

    const { data: rawTemplate, error: templateError } = await supabase
      .from("review_templates")
      .select("id, org_id, name, sections, created_by, created_at, updated_at")
      .eq("org_id", orgId)
      .eq("id", parsedAssignment.data.template_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (templateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_TEMPLATE_FETCH_FAILED",
          message: "Unable to load review template."
        },
        meta: buildMeta()
      });
    }

    const parsedTemplate = templateRowSchema.safeParse(rawTemplate);

    if (!parsedTemplate.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Review template is unavailable for this assignment."
        },
        meta: buildMeta()
      });
    }

    const templateSections = normalizeReviewSections(parsedTemplate.data.sections);

    if (payload.submit) {
      for (const section of templateSections) {
        for (const question of section.questions) {
          if (!question.required) {
            continue;
          }

          const questionAnswer = payload.answers[question.id];
          const answered = isRequiredQuestionAnswered({
            type: question.type,
            answer: questionAnswer
          });

          if (!answered) {
            return jsonResponse<null>(422, {
              data: null,
              error: {
                code: "VALIDATION_ERROR",
                message: `Required question is incomplete: ${question.title}.`
              },
              meta: buildMeta()
            });
          }
        }
      }
    }

    const { data: rawExistingResponse, error: existingResponseError } = await supabase
      .from("review_responses")
      .select("id, submitted_at")
      .eq("org_id", orgId)
      .eq("assignment_id", payload.assignmentId)
      .eq("response_type", payload.responseType)
      .eq("respondent_id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingResponseError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_SAVE_FAILED",
          message: "Unable to load existing review response."
        },
        meta: buildMeta()
      });
    }

    const parsedExistingResponse = existingResponseRowSchema.safeParse(rawExistingResponse);
    const submittedAt =
      payload.submit
        ? new Date().toISOString()
        : parsedExistingResponse.success
          ? parsedExistingResponse.data.submitted_at
          : null;

    const savePayload = {
      org_id: orgId,
      assignment_id: payload.assignmentId,
      respondent_id: userId,
      response_type: payload.responseType,
      answers: payload.answers,
      submitted_at: submittedAt,
      deleted_at: null as string | null
    };

    const responseMutation = parsedExistingResponse.success
      ? await supabase
          .from("review_responses")
          .update(savePayload)
          .eq("id", parsedExistingResponse.data.id)
          .eq("org_id", orgId)
          .select(
            "id, org_id, assignment_id, respondent_id, response_type, answers, submitted_at, updated_at"
          )
          .single()
      : await supabase
          .from("review_responses")
          .insert(savePayload)
          .select(
            "id, org_id, assignment_id, respondent_id, response_type, answers, submitted_at, updated_at"
          )
          .single();

    if (responseMutation.error || !responseMutation.data) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_SAVE_FAILED",
          message: "Unable to save review response."
        },
        meta: buildMeta()
      });
    }

    const parsedSavedResponse = responseRowSchema.safeParse(responseMutation.data);

    if (!parsedSavedResponse.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_PARSE_FAILED",
          message: "Saved review response is invalid."
        },
        meta: buildMeta()
      });
    }

    const mappedSavedResponse = mapResponseRow(parsedSavedResponse.data);

    if (!mappedSavedResponse) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_PARSE_FAILED",
          message: "Saved review response type is invalid."
        },
        meta: buildMeta()
      });
    }

    const { data: rawAssignmentResponses, error: assignmentResponsesError } = await supabase
      .from("review_responses")
      .select(
        "id, org_id, assignment_id, respondent_id, response_type, answers, submitted_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("assignment_id", payload.assignmentId)
      .is("deleted_at", null);

    if (assignmentResponsesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_SAVE_FAILED",
          message: "Unable to recalculate assignment review status."
        },
        meta: buildMeta()
      });
    }

    const parsedAssignmentResponses = z.array(responseRowSchema).safeParse(rawAssignmentResponses ?? []);

    if (!parsedAssignmentResponses.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_RESPONSE_PARSE_FAILED",
          message: "Assignment responses are invalid."
        },
        meta: buildMeta()
      });
    }

    const hasSelfSubmitted = parsedAssignmentResponses.data.some(
      (row) => row.response_type === "self" && row.submitted_at !== null
    );
    const hasManagerSubmitted = parsedAssignmentResponses.data.some(
      (row) => row.response_type === "manager" && row.submitted_at !== null
    );
    const assignmentStatus = nextAssignmentStatus({
      hasSelfSubmitted,
      hasManagerSubmitted
    });

    const serviceRole = createSupabaseServiceRoleClient();
    const { error: updateAssignmentError } = await serviceRole
      .from("review_assignments")
      .update({ status: assignmentStatus })
      .eq("id", payload.assignmentId)
      .eq("org_id", orgId);

    if (updateAssignmentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_UPDATE_FAILED",
          message: "Unable to update review assignment status."
        },
        meta: buildMeta()
      });
    }

    const [{ data: rawCycle, error: cycleError }, { data: rawProfiles, error: profilesError }] =
      await Promise.all([
        supabase
          .from("review_cycles")
          .select(
            "id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at"
          )
          .eq("org_id", orgId)
          .eq("id", parsedAssignment.data.cycle_id)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id, full_name, department, country_code")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .in("id", [
            parsedAssignment.data.employee_id,
            parsedAssignment.data.reviewer_id,
            parsedTemplate.data.created_by
          ])
      ]);

    if (cycleError || profilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_FETCH_FAILED",
          message: "Unable to reload review assignment details."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = cycleRowSchema.safeParse(rawCycle);
    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedCycle.success || !parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
          message: "Unable to parse refreshed assignment details."
        },
        meta: buildMeta()
      });
    }

    const profilesById = new Map(parsedProfiles.data.map((row) => [row.id, row]));
    const createdByName = profilesById.get(parsedCycle.data.created_by)?.full_name ?? "Unknown user";
    const mappedCycle = mapCycleRow(parsedCycle.data, createdByName);

    if (!mappedCycle) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
          message: "Cycle status is invalid."
        },
        meta: buildMeta()
      });
    }

    const mappedTemplate = mapTemplateRow(parsedTemplate.data);
    const responsesByAssignmentId = new Map([
      [
        payload.assignmentId,
        {
          selfResponse: parsedAssignmentResponses.data
            .map((row) => mapResponseRow(row))
            .find((row) => row?.responseType === "self") ?? null,
          managerResponse: parsedAssignmentResponses.data
            .map((row) => mapResponseRow(row))
            .find((row) => row?.responseType === "manager") ?? null
        }
      ]
    ]);

    const mappedAssignments = mapAssignmentRows({
      assignments: [
        {
          ...parsedAssignment.data,
          status: assignmentStatus
        }
      ],
      cyclesById: new Map([[mappedCycle.id, mappedCycle]]),
      templatesById: new Map([[mappedTemplate.id, mappedTemplate]]),
      profilesById,
      responsesByAssignmentId
    });

    const mappedAssignment = mappedAssignments[0];

    if (!mappedAssignment) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
          message: "Unable to build assignment response payload."
        },
        meta: buildMeta()
      });
    }

    const responseData: SaveReviewResponseData = {
      assignment: mappedAssignment,
      response: mappedSavedResponse
    };

    return jsonResponse<SaveReviewResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REVIEW_RESPONSE_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to save review response."
      },
      meta: buildMeta()
    });
  }
}
