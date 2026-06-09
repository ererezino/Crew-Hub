import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { canManageWorkTools } from "../../../../../lib/work-tools";
import type { AppRole } from "../../../../../types/auth";
import type { WorkToolUpsertResponseData } from "../../../../../types/work-tools";
import {
  WORK_TOOL_SELECT,
  buildMeta,
  hydrateWorkTools,
  jsonResponse,
  workToolUpdateSchema
} from "../_shared";

const paramsSchema = z.object({
  toolId: z.string().uuid("Tool id must be a valid UUID.")
});

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeDateish(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  return value;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ toolId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage work tools."
      },
      meta: buildMeta()
    });
  }

  if (!canManageWorkTools(session.profile.roles as AppRole[])) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can manage work tools."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid work tool id."
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

  const parsed = workToolUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid work tool payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const toolId = parsedParams.data.toolId;

  const { data: existingRows } = await serviceClient
    .from("work_tools")
    .select(WORK_TOOL_SELECT)
    .eq("org_id", session.profile.org_id)
    .eq("id", toolId)
    .is("deleted_at", null)
    .limit(1);

  if (!existingRows || existingRows.length === 0) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "This work tool could not be found."
      },
      meta: buildMeta()
    });
  }

  if (parsed.data.employeeId) {
    const { data: employee } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .eq("id", parsed.data.employeeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!employee) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "The selected employee could not be found."
        },
        meta: buildMeta()
      });
    }
  }

  const updatePayload: Record<string, unknown> = {};

  if (parsed.data.employeeId !== undefined) updatePayload.employee_id = parsed.data.employeeId;
  if (parsed.data.itemType !== undefined) updatePayload.item_type = parsed.data.itemType;
  if (parsed.data.itemName !== undefined) updatePayload.item_name = parsed.data.itemName.trim();
  if (parsed.data.serialNumber !== undefined) updatePayload.serial_number = normalizeNullableString(parsed.data.serialNumber);
  if (parsed.data.transactionCurrency !== undefined) {
    updatePayload.transaction_currency = normalizeNullableString(parsed.data.transactionCurrency)?.toUpperCase() ?? null;
  }
  if (parsed.data.costAmount !== undefined) updatePayload.cost_amount = normalizeNullableNumber(parsed.data.costAmount);
  if (parsed.data.status !== undefined) updatePayload.status = parsed.data.status;
  if (parsed.data.assignedAt !== undefined) updatePayload.assigned_at = normalizeDateish(parsed.data.assignedAt);
  if (parsed.data.returnedAt !== undefined) updatePayload.returned_at = normalizeDateish(parsed.data.returnedAt);
  if (parsed.data.notes !== undefined) updatePayload.notes = normalizeNullableString(parsed.data.notes);

  const { data: updatedRows, error: updateError } = await serviceClient
    .from("work_tools")
    .update(updatePayload)
    .eq("org_id", session.profile.org_id)
    .eq("id", toolId)
    .is("deleted_at", null)
    .select(WORK_TOOL_SELECT)
    .limit(1);

  if (updateError || !updatedRows || updatedRows.length === 0) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOL_UPDATE_FAILED",
        message: "Unable to update this work tool."
      },
      meta: buildMeta()
    });
  }

  const [tool] = await hydrateWorkTools(serviceClient, session.profile.org_id, updatedRows);

  await logAudit({
    action: "updated",
    tableName: "work_tools",
    recordId: tool.id,
    oldValue: existingRows[0],
    newValue: updatePayload
  }).catch(() => undefined);

  return jsonResponse<WorkToolUpsertResponseData>(200, {
    data: { tool },
    error: null,
    meta: buildMeta()
  });
}
