import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { logger } from "../../../../../../lib/logger";
import { createBulkNotifications } from "../../../../../../lib/notifications/service";
import { sendReviewCycleStartedEmail } from "../../../../../../lib/notifications/email";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { CreateReviewCycleData, CreateReviewCyclePayload } from "../../../../../../types/performance";
import {
  buildMeta,
  canManagePerformance,
  cycleRowSchema,
  jsonResponse,
  mapCycleRow
} from "../../_helpers";

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

const createCycleSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    type: z.enum(["quarterly", "annual", "probation"]),
    status: z.enum(["draft", "active", "in_review", "completed"]),
    startDate: z.string().regex(dateStringRegex),
    endDate: z.string().regex(dateStringRegex),
    selfReviewDeadline: z.string().regex(dateStringRegex).nullable(),
    managerReviewDeadline: z.string().regex(dateStringRegex).nullable()
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date cannot be before start date."
      });
    }

    if (value.selfReviewDeadline && value.selfReviewDeadline < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfReviewDeadline"],
        message: "Self review deadline cannot be before start date."
      });
    }

    if (value.managerReviewDeadline && value.managerReviewDeadline < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["managerReviewDeadline"],
        message: "Manager deadline cannot be before start date."
      });
    }
  });

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create review cycles."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!canManagePerformance(profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can create review cycles."
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

  const parsedPayload = createCycleSchema.safeParse(payloadValue);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid cycle payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data as CreateReviewCyclePayload;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawInsertedCycle, error: insertError } = await supabase
      .from("review_cycles")
      .insert({
        org_id: profile.org_id,
        name: payload.name,
        type: payload.type,
        status: payload.status,
        start_date: payload.startDate,
        end_date: payload.endDate,
        self_review_deadline: payload.selfReviewDeadline,
        manager_review_deadline: payload.managerReviewDeadline,
        created_by: profile.id
      })
      .select(
        "id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at"
      )
      .single();

    if (insertError || !rawInsertedCycle) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_CYCLE_CREATE_FAILED",
          message: "Unable to create review cycle."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = cycleRowSchema.safeParse(rawInsertedCycle);

    if (!parsedCycle.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_CYCLE_PARSE_FAILED",
          message: "Created cycle data is invalid."
        },
        meta: buildMeta()
      });
    }

    const mappedCycle = mapCycleRow(parsedCycle.data, profile.full_name);

    if (!mappedCycle) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_CYCLE_PARSE_FAILED",
          message: "Created cycle has an unsupported status."
        },
        meta: buildMeta()
      });
    }

    if (mappedCycle.status === "active") {
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("review_assignments")
        .select("employee_id")
        .eq("org_id", profile.org_id)
        .eq("cycle_id", mappedCycle.id)
        .is("deleted_at", null);

      if (assignmentError) {
        logger.error("Unable to load review assignment recipients.", {
          cycleId: mappedCycle.id,
          message: assignmentError.message
        });
      } else {
        const employeeIds = [...new Set(
          (assignmentRows ?? [])
            .map((row) => row.employee_id)
            .filter((value): value is string => typeof value === "string")
        )];

        const deadlineText = payload.selfReviewDeadline
          ? ` Self-review due ${payload.selfReviewDeadline}.`
          : "";

        await createBulkNotifications({
          orgId: profile.org_id,
          userIds: employeeIds,
          type: "review_cycle_started",
          title: "Review cycle started",
          body: `Your ${payload.name} review has started.${deadlineText}`,
          link: "/performance"
        });

        void Promise.all(
          employeeIds.map((employeeId) =>
            sendReviewCycleStartedEmail({
              orgId: profile.org_id,
              userId: employeeId,
              cycleName: payload.name,
              selfReviewDeadline: payload.selfReviewDeadline ?? null
            })
          )
        );
      }
    }

    await logAudit({
      action: "created",
      tableName: "review_cycles",
      recordId: mappedCycle.id,
      newValue: { name: mappedCycle.name }
    }).catch(() => undefined);

    const responseData: CreateReviewCycleData = {
      cycle: mappedCycle
    };

    return jsonResponse<CreateReviewCycleData>(201, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REVIEW_CYCLE_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to create review cycle."
      },
      meta: buildMeta()
    });
  }
}
