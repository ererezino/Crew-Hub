import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import {
  EQUITY_GRANT_STATUSES,
  EQUITY_GRANT_TYPES,
  type CompensationMutationResponseData
} from "../../../../../../../types/compensation";
import {
  buildMeta,
  canApproveCompensation,
  canManageCompensation,
  jsonResponse,
  parseDecimalValue,
  parseIntegerValue
} from "../../_helpers";

type RouteContext = {
  params: Promise<{
    equityGrantId: string;
  }>;
};

const paramsSchema = z.object({
  equityGrantId: z.string().uuid()
});

const updateEquitySchema = z.object({
  grantType: z.enum(EQUITY_GRANT_TYPES),
  numberOfShares: z.union([z.string(), z.number()]),
  exercisePriceCents: z.union([z.string(), z.number()]).nullable().optional(),
  grantDate: z.iso.date(),
  vestingStartDate: z.iso.date(),
  cliffMonths: z.coerce.number().int().min(0),
  vestingDurationMonths: z.coerce.number().int().min(1),
  status: z.enum(EQUITY_GRANT_STATUSES),
  boardApprovalDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  approve: z.boolean().optional()
});

const equityRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  grant_type: z.enum(EQUITY_GRANT_TYPES),
  number_of_shares: z.union([z.string(), z.number()]),
  exercise_price_cents: z.union([z.string(), z.number()]).nullable(),
  grant_date: z.string(),
  vesting_start_date: z.string(),
  cliff_months: z.number(),
  vesting_duration_months: z.number(),
  schedule: z.literal("monthly"),
  status: z.enum(EQUITY_GRANT_STATUSES),
  approved_by: z.string().uuid().nullable(),
  board_approval_date: z.string().nullable(),
  notes: z.string().nullable()
});

function equityAuditValue(row: z.infer<typeof equityRowSchema>) {
  return {
    employeeId: row.employee_id,
    grantType: row.grant_type,
    numberOfShares: row.number_of_shares,
    exercisePriceCents: row.exercise_price_cents,
    grantDate: row.grant_date,
    vestingStartDate: row.vesting_start_date,
    cliffMonths: row.cliff_months,
    vestingDurationMonths: row.vesting_duration_months,
    schedule: row.schedule,
    status: row.status,
    approvedBy: row.approved_by,
    boardApprovalDate: row.board_approval_date,
    notes: row.notes
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update equity grants."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to update equity grants."
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
        message: "Equity grant id must be a valid UUID."
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

  const parsedBody = updateEquitySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid equity update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;

  const numberOfShares = parseDecimalValue(payload.numberOfShares);

  if (numberOfShares === null || numberOfShares <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Number of shares must be greater than zero."
      },
      meta: buildMeta()
    });
  }

  const exercisePriceCents =
    payload.exercisePriceCents === null || payload.exercisePriceCents === undefined
      ? null
      : parseIntegerValue(payload.exercisePriceCents);

  if (payload.exercisePriceCents !== null && payload.exercisePriceCents !== undefined) {
    if (exercisePriceCents === null || exercisePriceCents < 0) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Exercise price must be a non-negative integer in cents."
        },
        meta: buildMeta()
      });
    }
  }

  if (payload.boardApprovalDate && payload.boardApprovalDate < payload.grantDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Board approval date must be on or after grant date."
      },
      meta: buildMeta()
    });
  }

  if (payload.approve !== undefined && !canApproveCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only SUPER_ADMIN can approve equity grants."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingRow, error: fetchError } = await supabase
    .from("equity_grants")
    .select(
      "id, employee_id, grant_type, number_of_shares, exercise_price_cents, grant_date, vesting_start_date, cliff_months, vesting_duration_months, schedule, status, approved_by, board_approval_date, notes"
    )
    .eq("id", parsedParams.data.equityGrantId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EQUITY_FETCH_FAILED",
        message: "Unable to load equity grant for update."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = equityRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Equity grant was not found."
      },
      meta: buildMeta()
    });
  }

  const nextApprovedBy =
    payload.approve === undefined
      ? parsedExisting.data.approved_by
      : payload.approve
        ? session.profile.id
        : null;

  const { error: updateError } = await supabase
    .from("equity_grants")
    .update({
      grant_type: payload.grantType,
      number_of_shares: numberOfShares,
      exercise_price_cents: exercisePriceCents,
      grant_date: payload.grantDate,
      vesting_start_date: payload.vestingStartDate,
      cliff_months: payload.cliffMonths,
      vesting_duration_months: payload.vestingDurationMonths,
      status: payload.status,
      approved_by: nextApprovedBy,
      board_approval_date: payload.boardApprovalDate ?? null,
      notes: payload.notes ?? null
    })
    .eq("id", parsedExisting.data.id)
    .eq("org_id", session.profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EQUITY_UPDATE_FAILED",
        message: "Unable to update equity grant."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: parsedExisting.data.employee_id
  });

  const equityGrant = snapshot?.equityGrants.find((record) => record.id === parsedExisting.data.id);

  if (!equityGrant) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EQUITY_FETCH_FAILED",
        message: "Equity grant was updated but could not be loaded."
      },
      meta: buildMeta()
    });
  }

  const action = payload.approve === true ? "approved" : "updated";

  await logAudit({
    action,
    tableName: "equity_grants",
    recordId: equityGrant.id,
    oldValue: equityAuditValue(parsedExisting.data),
    newValue: {
      employeeId: equityGrant.employeeId,
      grantType: equityGrant.grantType,
      numberOfShares: equityGrant.numberOfShares,
      exercisePriceCents: equityGrant.exercisePriceCents,
      grantDate: equityGrant.grantDate,
      vestingStartDate: equityGrant.vestingStartDate,
      cliffMonths: equityGrant.cliffMonths,
      vestingDurationMonths: equityGrant.vestingDurationMonths,
      schedule: equityGrant.schedule,
      status: equityGrant.status,
      approvedBy: equityGrant.approvedBy,
      boardApprovalDate: equityGrant.boardApprovalDate,
      notes: equityGrant.notes
    }
  });

  const response: CompensationMutationResponseData = {
    employeeId: equityGrant.employeeId,
    equityGrant
  };

  return jsonResponse<CompensationMutationResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
