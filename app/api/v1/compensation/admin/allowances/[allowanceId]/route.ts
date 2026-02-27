import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import {
  ALLOWANCE_TYPES,
  type CompensationMutationResponseData
} from "../../../../../../../types/compensation";
import {
  buildMeta,
  canManageCompensation,
  ensureEffectiveWindow,
  jsonResponse,
  normalizeCurrency,
  parseIntegerValue
} from "../../_helpers";

type RouteContext = {
  params: Promise<{
    allowanceId: string;
  }>;
};

const paramsSchema = z.object({
  allowanceId: z.string().uuid()
});

const updateAllowanceSchema = z.object({
  type: z.enum(ALLOWANCE_TYPES),
  label: z.string().trim().min(1).max(200),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().trim().min(3).max(3),
  isTaxable: z.boolean(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional()
});

const allowanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  type: z.enum(ALLOWANCE_TYPES),
  label: z.string(),
  amount: z.union([z.string(), z.number()]),
  currency: z.string(),
  is_taxable: z.boolean(),
  effective_from: z.string(),
  effective_to: z.string().nullable()
});

function allowanceAuditValue(row: z.infer<typeof allowanceRowSchema>) {
  return {
    employeeId: row.employee_id,
    type: row.type,
    label: row.label,
    amount: row.amount,
    currency: row.currency,
    isTaxable: row.is_taxable,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update allowances."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to update allowances."
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
        message: "Allowance id must be a valid UUID."
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

  const parsedBody = updateAllowanceSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid allowance update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const amount = parseIntegerValue(payload.amount);
  const currency = normalizeCurrency(payload.currency);
  const effectiveTo = payload.effectiveTo ?? null;

  if (amount === null || amount < 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Allowance amount must be a non-negative integer in smallest currency unit."
      },
      meta: buildMeta()
    });
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Currency must be a valid 3-letter code."
      },
      meta: buildMeta()
    });
  }

  if (!ensureEffectiveWindow(payload.effectiveFrom, effectiveTo)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Effective to date must be on or after effective from date."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingRow, error: fetchError } = await supabase
    .from("allowances")
    .select(
      "id, employee_id, type, label, amount, currency, is_taxable, effective_from, effective_to"
    )
    .eq("id", parsedParams.data.allowanceId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_FETCH_FAILED",
        message: "Unable to load allowance for update."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = allowanceRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Allowance was not found."
      },
      meta: buildMeta()
    });
  }

  const { error: updateError } = await supabase
    .from("allowances")
    .update({
      type: payload.type,
      label: payload.label,
      amount,
      currency,
      is_taxable: payload.isTaxable,
      effective_from: payload.effectiveFrom,
      effective_to: effectiveTo
    })
    .eq("id", parsedExisting.data.id)
    .eq("org_id", session.profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_UPDATE_FAILED",
        message: "Unable to update allowance."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: parsedExisting.data.employee_id
  });

  const allowance = snapshot?.allowances.find((record) => record.id === parsedExisting.data.id);

  if (!allowance) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_FETCH_FAILED",
        message: "Allowance was updated but could not be loaded."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "allowances",
    recordId: allowance.id,
    oldValue: allowanceAuditValue(parsedExisting.data),
    newValue: {
      employeeId: allowance.employeeId,
      type: allowance.type,
      label: allowance.label,
      amount: allowance.amount,
      currency: allowance.currency,
      isTaxable: allowance.isTaxable,
      effectiveFrom: allowance.effectiveFrom,
      effectiveTo: allowance.effectiveTo
    }
  });

  const response: CompensationMutationResponseData = {
    employeeId: allowance.employeeId,
    allowance
  };

  return jsonResponse<CompensationMutationResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to delete allowances."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to delete allowances."
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
        message: "Allowance id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingRow, error: fetchError } = await supabase
    .from("allowances")
    .select(
      "id, employee_id, type, label, amount, currency, is_taxable, effective_from, effective_to"
    )
    .eq("id", parsedParams.data.allowanceId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_FETCH_FAILED",
        message: "Unable to load allowance for deletion."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = allowanceRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Allowance was not found."
      },
      meta: buildMeta()
    });
  }

  const { error: deleteError } = await supabase
    .from("allowances")
    .update({
      deleted_at: new Date().toISOString()
    })
    .eq("id", parsedExisting.data.id)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_DELETE_FAILED",
        message: "Unable to delete allowance."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "allowances",
    recordId: parsedExisting.data.id,
    oldValue: allowanceAuditValue(parsedExisting.data)
  });

  const response: CompensationMutationResponseData = {
    employeeId: parsedExisting.data.employee_id
  };

  return jsonResponse<CompensationMutationResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
