import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import {
  loadNigeriaRuleConfig,
  upsertNigeriaRuleConfig
} from "../../../../../../../lib/payroll/engines/nigeria";
import { validateNigeriaRuleConfig } from "../../../../../../../lib/payroll/engines/nigeria-calculation";
import type { UserRole } from "../../../../../../../lib/navigation";
import { hasRole } from "../../../../../../../lib/roles";
import type { ApiResponse } from "../../../../../../../types/auth";

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

const nigeriaRuleConfigSchema = z.object({
  payeBrackets: z.array(
    z.object({
      ruleName: z.string().trim().min(1).max(100),
      bracketMin: z.number().int().min(0),
      bracketMax: z.number().int().min(0).nullable(),
      rate: z.number().min(0).max(1),
      calculationOrder: z.number().int().min(0)
    })
  ),
  craFixedAmount: z.number().int().min(0),
  craPercentRate: z.number().min(0).max(1),
  craAdditionalRate: z.number().min(0).max(1),
  pensionEmployeeRate: z.number().min(0).max(1),
  pensionEmployerRate: z.number().min(0).max(1),
  nhfRate: z.number().min(0).max(1),
  nsitfEmployeeRate: z.number().min(0).max(1),
  nsitfEmployerRate: z.number().min(0).max(1)
});

const upsertBodySchema = z.object({
  effectiveFrom: z.string().regex(dateStringRegex),
  config: nigeriaRuleConfigSchema
});

type NigeriaSettingsResponseData = {
  effectiveFrom: string;
  config: z.infer<typeof nigeriaRuleConfigSchema>;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewPayrollSettings(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canManagePayrollSettings(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPayrollSettings(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }

  try {
    const config = await loadNigeriaRuleConfig({
      orgId: session.profile.org_id
    });

    return jsonResponse<NigeriaSettingsResponseData>(200, {
      data: {
        effectiveFrom: new Date().toISOString().slice(0, 10),
        config
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NIGERIA_RULES_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }
}

export async function PUT(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayrollSettings(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can update Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }

  let requestBody: unknown;

  try {
    requestBody = await request.json();
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

  const parsedBody = upsertBodySchema.safeParse(requestBody);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid Nigeria payroll settings payload."
      },
      meta: buildMeta()
    });
  }

  const configError = validateNigeriaRuleConfig(parsedBody.data.config);

  if (configError) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: configError
      },
      meta: buildMeta()
    });
  }

  try {
    await upsertNigeriaRuleConfig({
      orgId: session.profile.org_id,
      effectiveFrom: parsedBody.data.effectiveFrom,
      config: parsedBody.data.config
    });

    const refreshedConfig = await loadNigeriaRuleConfig({
      orgId: session.profile.org_id,
      effectiveDate: parsedBody.data.effectiveFrom
    });

    return jsonResponse<NigeriaSettingsResponseData>(200, {
      data: {
        effectiveFrom: parsedBody.data.effectiveFrom,
        config: refreshedConfig
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NIGERIA_RULES_UPDATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to update Nigeria payroll settings."
      },
      meta: buildMeta()
    });
  }
}
