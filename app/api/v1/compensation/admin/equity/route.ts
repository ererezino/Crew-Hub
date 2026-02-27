import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  EQUITY_GRANT_STATUSES,
  EQUITY_GRANT_TYPES,
  type CompensationMutationResponseData
} from "../../../../../../types/compensation";
import {
  buildMeta,
  canApproveCompensation,
  canManageCompensation,
  ensureEmployeeInOrg,
  jsonResponse,
  parseDecimalValue,
  parseIntegerValue
} from "../_helpers";

const createEquitySchema = z.object({
  employeeId: z.string().uuid(),
  grantType: z.enum(EQUITY_GRANT_TYPES),
  numberOfShares: z.union([z.string(), z.number()]),
  exercisePriceCents: z.union([z.string(), z.number()]).nullable().optional(),
  grantDate: z.iso.date(),
  vestingStartDate: z.iso.date(),
  cliffMonths: z.coerce.number().int().min(0).optional().default(12),
  vestingDurationMonths: z.coerce.number().int().min(1).optional().default(48),
  status: z.enum(EQUITY_GRANT_STATUSES).optional().default("draft"),
  boardApprovalDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  approve: z.boolean().optional().default(false)
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create equity grants."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to create equity grants."
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

  const parsedBody = createEquitySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid equity payload."
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

  if (payload.approve && !canApproveCompensation(session.profile.roles)) {
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

  const employee = await ensureEmployeeInOrg({
    supabase,
    orgId: session.profile.org_id,
    employeeId: payload.employeeId
  });

  if (!employee) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Employee was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from("equity_grants")
    .insert({
      employee_id: payload.employeeId,
      org_id: session.profile.org_id,
      grant_type: payload.grantType,
      number_of_shares: numberOfShares,
      exercise_price_cents: exercisePriceCents,
      grant_date: payload.grantDate,
      vesting_start_date: payload.vestingStartDate,
      cliff_months: payload.cliffMonths,
      vesting_duration_months: payload.vestingDurationMonths,
      schedule: "monthly",
      status: payload.status,
      approved_by: payload.approve ? session.profile.id : null,
      board_approval_date: payload.boardApprovalDate ?? null,
      notes: payload.notes ?? null
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EQUITY_INSERT_FAILED",
        message: "Unable to create equity grant."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: payload.employeeId
  });

  const equityGrant = snapshot?.equityGrants.find((record) => record.id === insertedRow.id);

  if (!equityGrant) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EQUITY_FETCH_FAILED",
        message: "Equity grant was created but could not be loaded."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "equity_grants",
    recordId: equityGrant.id,
    newValue: {
      employeeId: equityGrant.employeeId,
      employeeName: employee.fullName,
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

  return jsonResponse<CompensationMutationResponseData>(201, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
