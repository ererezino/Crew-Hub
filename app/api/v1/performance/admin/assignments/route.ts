import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { AssignReviewData, AssignReviewPayload } from "../../../../../../types/performance";
import {
  assignmentRowSchema,
  buildMeta,
  canManagePerformance,
  cycleRowSchema,
  jsonResponse,
  mapAssignmentRows,
  mapCycleRow,
  mapTemplateRow,
  profileRowSchema,
  templateRowSchema
} from "../../_helpers";

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

const assignPayloadSchema = z.object({
  cycleId: z.string().uuid(),
  templateId: z.string().uuid(),
  assignments: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        reviewerId: z.string().uuid(),
        dueAt: z.string().regex(dateStringRegex).nullable()
      })
    )
    .min(1)
    .max(300)
});

function assignmentKey({
  cycleId,
  employeeId,
  reviewerId
}: {
  cycleId: string;
  employeeId: string;
  reviewerId: string;
}): string {
  return `${cycleId}:${employeeId}:${reviewerId}`;
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to assign performance reviews."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePerformance(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can assign performance reviews."
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

  const parsedPayload = assignPayloadSchema.safeParse(payloadValue);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid assignment payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data as AssignReviewPayload;
  const duplicateEmployeeReviewer = payload.assignments.find(
    (row) => row.employeeId === row.reviewerId
  );

  if (duplicateEmployeeReviewer) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Employee and reviewer must be different people."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const orgId = session.profile.org_id;

    const [{ data: rawCycle, error: cycleError }, { data: rawTemplate, error: templateError }] =
      await Promise.all([
        supabase
          .from("review_cycles")
          .select(
            "id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at"
          )
          .eq("org_id", orgId)
          .eq("id", payload.cycleId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("review_templates")
          .select("id, org_id, name, sections, created_by, created_at, updated_at")
          .eq("org_id", orgId)
          .eq("id", payload.templateId)
          .is("deleted_at", null)
          .maybeSingle()
      ]);

    if (cycleError || templateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_CREATE_FAILED",
          message:
            cycleError?.message ??
            templateError?.message ??
            "Unable to validate cycle and template."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = cycleRowSchema.safeParse(rawCycle);
    const parsedTemplate = templateRowSchema.safeParse(rawTemplate);

    if (!parsedCycle.success || !parsedTemplate.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Cycle or template was not found."
        },
        meta: buildMeta()
      });
    }

    const { data: rawExistingAssignments, error: existingAssignmentsError } = await supabase
      .from("review_assignments")
      .select(
        "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, shared_at, shared_by, acknowledged_at, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("cycle_id", payload.cycleId)
      .is("deleted_at", null);

    if (existingAssignmentsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_CREATE_FAILED",
          message: "Unable to load existing assignments."
        },
        meta: buildMeta()
      });
    }

    const parsedExistingAssignments = z.array(assignmentRowSchema).safeParse(rawExistingAssignments ?? []);

    if (!parsedExistingAssignments.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
          message: "Existing assignments are invalid."
        },
        meta: buildMeta()
      });
    }

    const existingByKey = new Set(
      parsedExistingAssignments.data.map((row) =>
        assignmentKey({
          cycleId: row.cycle_id,
          employeeId: row.employee_id,
          reviewerId: row.reviewer_id
        })
      )
    );

    const rowsToInsert: Array<{
      org_id: string;
      cycle_id: string;
      employee_id: string;
      reviewer_id: string;
      template_id: string;
      status: "pending_self";
      due_at: string | null;
      deleted_at: null;
    }> = [];

    for (const row of payload.assignments) {
      const key = assignmentKey({
        cycleId: payload.cycleId,
        employeeId: row.employeeId,
        reviewerId: row.reviewerId
      });

      if (existingByKey.has(key)) {
        continue;
      }

      rowsToInsert.push({
        org_id: orgId,
        cycle_id: payload.cycleId,
        employee_id: row.employeeId,
        reviewer_id: row.reviewerId,
        template_id: payload.templateId,
        status: "pending_self",
        due_at: row.dueAt,
        deleted_at: null
      });
    }

    const skippedCount = payload.assignments.length - rowsToInsert.length;

    let createdRows: z.infer<typeof assignmentRowSchema>[] = [];

    if (rowsToInsert.length > 0) {
      const { data: rawInsertedRows, error: insertError } = await supabase
        .from("review_assignments")
        .insert(rowsToInsert)
        .select(
          "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, shared_at, shared_by, acknowledged_at, created_at, updated_at"
        );

      if (insertError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REVIEW_ASSIGNMENT_CREATE_FAILED",
            message: `Unable to create assignments: ${insertError.message}`
          },
          meta: buildMeta()
        });
      }

      const parsedInsertedRows = z.array(assignmentRowSchema).safeParse(rawInsertedRows ?? []);

      if (!parsedInsertedRows.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
            message: "Created assignments are invalid."
          },
          meta: buildMeta()
        });
      }

      createdRows = parsedInsertedRows.data;
    }

    const profileIds = [...new Set([
      parsedCycle.data.created_by,
      ...createdRows.map((row) => row.employee_id),
      ...createdRows.map((row) => row.reviewer_id)
    ])];

    const { data: rawProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, department, country_code")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", profileIds);

    if (profilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_CREATE_FAILED",
          message: "Unable to resolve assignment profiles."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_ASSIGNMENT_PARSE_FAILED",
          message: "Assignment profile metadata is invalid."
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

    const mappedAssignments = mapAssignmentRows({
      assignments: createdRows,
      cyclesById: new Map([[mappedCycle.id, mappedCycle]]),
      templatesById: new Map([[parsedTemplate.data.id, mapTemplateRow(parsedTemplate.data)]]),
      profilesById,
      responsesByAssignmentId: new Map()
    });

    await logAudit({
      action: "created",
      tableName: "review_assignments",
      recordId: parsedTemplate.data.id,
      newValue: { createdCount: mappedAssignments.length, skippedCount }
    }).catch(() => undefined);

    const responseData: AssignReviewData = {
      assignments: mappedAssignments,
      createdCount: mappedAssignments.length,
      skippedCount
    };

    return jsonResponse<AssignReviewData>(201, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REVIEW_ASSIGNMENT_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to create review assignments."
      },
      meta: buildMeta()
    });
  }
}
