import { logAudit } from "../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { canManageWorkTools, isWorkToolOutstanding } from "../../../../lib/work-tools";
import type { AppRole } from "../../../../types/auth";
import type { WorkToolsAdminResponseData, WorkToolUpsertResponseData } from "../../../../types/work-tools";
import {
  WORK_TOOL_REQUEST_SELECT,
  WORK_TOOL_SELECT,
  buildMeta,
  hydrateWorkToolRequests,
  hydrateWorkTools,
  jsonResponse,
  workToolCreateSchema
} from "./_shared";

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

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view work tools."
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

  const serviceClient = createSupabaseServiceRoleClient();

  const [toolResult, requestResult] = await Promise.all([
    serviceClient
      .from("work_tools")
      .select(WORK_TOOL_SELECT)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false }),
    serviceClient
      .from("work_tool_requests")
      .select(WORK_TOOL_REQUEST_SELECT)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
  ]);

  if (toolResult.error || requestResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOLS_FETCH_FAILED",
        message: "Unable to load work tools right now."
      },
      meta: buildMeta()
    });
  }

  try {
    const [tools, requests] = await Promise.all([
      hydrateWorkTools(serviceClient, session.profile.org_id, toolResult.data ?? []),
      hydrateWorkToolRequests(serviceClient, session.profile.org_id, requestResult.data ?? [])
    ]);

    const currentHolderIds = [...new Set(
      tools
        .filter((tool) => tool.employeeId && isWorkToolOutstanding(tool.status))
        .map((tool) => tool.employeeId as string)
    )];

    let outstandingOffboardingCount = 0;

    if (currentHolderIds.length > 0) {
      const { data: offboardingRows } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("org_id", session.profile.org_id)
        .eq("status", "offboarding")
        .is("deleted_at", null)
        .in("id", currentHolderIds);

      outstandingOffboardingCount = (offboardingRows ?? []).length;
    }

    return jsonResponse<WorkToolsAdminResponseData>(200, {
      data: {
        tools,
        requests,
        summary: {
          assignedCount: tools.filter((tool) => tool.employeeId && isWorkToolOutstanding(tool.status)).length,
          employeeCount: currentHolderIds.length,
          outstandingOffboardingCount,
          openRequestCount: requests.filter(
            (request) =>
              request.status === "open" ||
              request.status === "in_review" ||
              request.status === "approved"
          ).length
        }
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOLS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load work tools right now."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
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

  const parsed = workToolCreateSchema.safeParse(body);

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

  const insertPayload = {
    org_id: session.profile.org_id,
    employee_id: parsed.data.employeeId ?? null,
    assigned_by: session.profile.id,
    item_type: parsed.data.itemType,
    item_name: parsed.data.itemName.trim(),
    serial_number: normalizeNullableString(parsed.data.serialNumber ?? null),
    transaction_currency: normalizeNullableString(parsed.data.transactionCurrency ?? null)?.toUpperCase() ?? null,
    cost_amount: normalizeNullableNumber(parsed.data.costAmount),
    status: parsed.data.status,
    assigned_at: normalizeDateish(parsed.data.assignedAt),
    notes: normalizeNullableString(parsed.data.notes ?? null)
  };

  const { data: insertedRows, error: insertError } = await serviceClient
    .from("work_tools")
    .insert(insertPayload)
    .select(WORK_TOOL_SELECT)
    .limit(1);

  if (insertError || !insertedRows || insertedRows.length === 0) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOL_CREATE_FAILED",
        message: "Unable to save this work tool."
      },
      meta: buildMeta()
    });
  }

  const [tool] = await hydrateWorkTools(serviceClient, session.profile.org_id, insertedRows);

  await logAudit({
    action: "created",
    tableName: "work_tools",
    recordId: tool.id,
    newValue: insertPayload
  }).catch(() => undefined);

  return jsonResponse<WorkToolUpsertResponseData>(201, {
    data: { tool },
    error: null,
    meta: buildMeta()
  });
}
