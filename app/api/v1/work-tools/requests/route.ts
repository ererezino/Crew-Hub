import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createNotification } from "../../../../../lib/notifications/service";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { getHrAdminRecipientIds, getWorkToolRequestTitle } from "../../../../../lib/work-tools";
import type { WorkToolRequestCreateResponseData } from "../../../../../types/work-tools";
import {
  WORK_TOOL_REQUEST_SELECT,
  buildMeta,
  hydrateWorkToolRequests,
  jsonResponse,
  workToolRequestCreateSchema
} from "../_shared";

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to submit a work tool request."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

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

  const parsed = workToolRequestCreateSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid work tool request payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  if (parsed.data.toolId) {
    const { data: tool } = await serviceClient
      .from("work_tools")
      .select("id, employee_id")
      .eq("org_id", profile.org_id)
      .eq("id", parsed.data.toolId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!tool || tool.employee_id !== profile.id) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You can only report issues for tools currently assigned to you."
        },
        meta: buildMeta()
      });
    }
  }

  const insertPayload = {
    org_id: profile.org_id,
    employee_id: profile.id,
    tool_id: parsed.data.toolId ?? null,
    request_kind: parsed.data.requestKind,
    requested_item_type: parsed.data.requestedItemType ?? null,
    issue_type: parsed.data.issueType ?? null,
    details: parsed.data.details.trim(),
    status: "open"
  };

  const { data: insertedRows, error: insertError } = await serviceClient
    .from("work_tool_requests")
    .insert(insertPayload)
    .select(WORK_TOOL_REQUEST_SELECT)
    .limit(1);

  if (insertError || !insertedRows || insertedRows.length === 0) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOL_REQUEST_FAILED",
        message: "Unable to submit this work tool request."
      },
      meta: buildMeta()
    });
  }

  const [createdRequest] = await hydrateWorkToolRequests(
    serviceClient,
    profile.org_id,
    insertedRows
  );

  await logAudit({
    action: "created",
    tableName: "work_tool_requests",
    recordId: createdRequest.id,
    newValue: insertPayload
  }).catch(() => undefined);

  const hrAdminIds = await getHrAdminRecipientIds(serviceClient, profile.org_id);
  const notificationTitle = getWorkToolRequestTitle({
    requestKind: createdRequest.requestKind,
    requestedItemType: createdRequest.requestedItemType,
    issueType: createdRequest.issueType,
    toolLabel: createdRequest.toolLabel
  });

  await Promise.all(
    hrAdminIds.map((userId) =>
      createNotification({
        orgId: profile.org_id,
        userId,
        type: "announcement",
        title: notificationTitle,
        body: `${profile.full_name} submitted a work tools request that needs HR review.`,
        link: "/people?tab=work-tools",
        dedupeKey: `work-tool-request:${createdRequest.id}:${userId}`
      })
    )
  );

  return jsonResponse<WorkToolRequestCreateResponseData>(201, {
    data: { request: createdRequest },
    error: null,
    meta: buildMeta()
  });
}
