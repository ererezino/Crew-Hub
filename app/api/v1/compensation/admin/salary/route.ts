import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { CompensationMutationResponseData } from "../../../../../../types/compensation";
import { COMPENSATION_EMPLOYMENT_TYPES, COMPENSATION_PAY_FREQUENCIES } from "../../../../../../types/compensation";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  buildMeta,
  canApproveCompensation,
  canManageCompensation,
  ensureEffectiveWindow,
  ensureEmployeeInOrg,
  jsonResponse,
  normalizeCurrency,
  parseIntegerValue
} from "../_helpers";

const createSalarySchema = z.object({
  employeeId: z.string().uuid(),
  baseSalaryAmount: z.union([z.string(), z.number()]),
  currency: z.string().trim().min(3).max(3),
  payFrequency: z.enum(COMPENSATION_PAY_FREQUENCIES),
  employmentType: z.enum(COMPENSATION_EMPLOYMENT_TYPES),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
  approve: z.boolean().optional().default(false)
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create salary records."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to create salary records."
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

  const parsedBody = createSalarySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid salary payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const normalizedCurrency = normalizeCurrency(payload.currency);
  const baseSalaryAmount = parseIntegerValue(payload.baseSalaryAmount);
  const effectiveTo = payload.effectiveTo ?? null;

  if (baseSalaryAmount === null || baseSalaryAmount < 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Base salary amount must be a non-negative integer in smallest currency unit."
      },
      meta: buildMeta()
    });
  }

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
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

  if (payload.approve && !canApproveCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only SUPER_ADMIN can approve salary changes."
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
    .from("compensation_records")
    .insert({
      employee_id: payload.employeeId,
      org_id: session.profile.org_id,
      base_salary_amount: baseSalaryAmount,
      currency: normalizedCurrency,
      pay_frequency: payload.payFrequency,
      employment_type: payload.employmentType,
      effective_from: payload.effectiveFrom,
      effective_to: effectiveTo,
      approved_by: payload.approve ? session.profile.id : null
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SALARY_INSERT_FAILED",
        message: "Unable to create salary record."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: payload.employeeId
  });

  const salaryRecord = snapshot?.salaryRecords.find((record) => record.id === insertedRow.id);

  if (!salaryRecord) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SALARY_FETCH_FAILED",
        message: "Salary record was created but could not be loaded."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "compensation_records",
    recordId: salaryRecord.id,
    newValue: {
      employeeId: salaryRecord.employeeId,
      employeeName: employee.fullName,
      baseSalaryAmount: salaryRecord.baseSalaryAmount,
      currency: salaryRecord.currency,
      payFrequency: salaryRecord.payFrequency,
      employmentType: salaryRecord.employmentType,
      effectiveFrom: salaryRecord.effectiveFrom,
      effectiveTo: salaryRecord.effectiveTo,
      approvedBy: salaryRecord.approvedBy
    }
  });

  const response: CompensationMutationResponseData = {
    employeeId: payload.employeeId,
    salaryRecord
  };

  return jsonResponse<CompensationMutationResponseData>(201, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
