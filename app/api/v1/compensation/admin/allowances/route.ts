import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  ALLOWANCE_TYPES,
  type CompensationMutationResponseData
} from "../../../../../../types/compensation";
import {
  buildMeta,
  canManageCompensation,
  ensureEffectiveWindow,
  ensureEmployeeInOrg,
  jsonResponse,
  normalizeCurrency,
  parseIntegerValue
} from "../_helpers";

const createAllowanceSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum(ALLOWANCE_TYPES),
  label: z.string().trim().min(1).max(200),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().trim().min(3).max(3),
  isTaxable: z.boolean().optional().default(false),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional()
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create allowances."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to create allowances."
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

  const parsedBody = createAllowanceSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid allowance payload."
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
    .from("allowances")
    .insert({
      employee_id: payload.employeeId,
      org_id: session.profile.org_id,
      type: payload.type,
      label: payload.label,
      amount,
      currency,
      is_taxable: payload.isTaxable,
      effective_from: payload.effectiveFrom,
      effective_to: effectiveTo
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_INSERT_FAILED",
        message: "Unable to create allowance."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: payload.employeeId
  });

  const allowance = snapshot?.allowances.find((record) => record.id === insertedRow.id);

  if (!allowance) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ALLOWANCE_FETCH_FAILED",
        message: "Allowance was created but could not be loaded."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "allowances",
    recordId: allowance.id,
    newValue: {
      employeeId: allowance.employeeId,
      employeeName: employee.fullName,
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

  return jsonResponse<CompensationMutationResponseData>(201, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
