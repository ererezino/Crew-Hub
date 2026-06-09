import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import { canManageWorkTools } from "../../../../../../lib/work-tools";
import type { AppRole } from "../../../../../../types/auth";
import type { WorkToolRequestUpdateResponseData } from "../../../../../../types/work-tools";
import {
  WORK_TOOL_REQUEST_SELECT,
  buildMeta,
  hydrateWorkToolRequests,
  jsonResponse,
  workToolRequestUpdateSchema
} from "../../_shared";

const paramsSchema = z.object({
  requestId: z.string().uuid("Request id must be a valid UUID.")
});

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage work tool requests."
      },
      meta: buildMeta()
    });
  }

  if (!canManageWorkTools(session.profile.roles as AppRole[])) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can manage work tool requests."
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
        message: parsedParams.error.issues[0]?.message ?? "Invalid request id."
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

  const parsed = workToolRequestUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid work tool request update."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const requestId = parsedParams.data.requestId;

  const { data: existingRows } = await serviceClient
    .from("work_tool_requests")
    .select(WORK_TOOL_REQUEST_SELECT)
    .eq("org_id", session.profile.org_id)
    .eq("id", requestId)
    .is("deleted_at", null)
    .limit(1);

  if (!existingRows || existingRows.length === 0) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "This work tool request could not be found."
      },
      meta: buildMeta()
    });
  }

  const updatePayload = {
    status: parsed.data.status,
    hr_notes: normalizeNullableString(parsed.data.hrNotes)
  };

  const { data: updatedRows, error: updateError } = await serviceClient
    .from("work_tool_requests")
    .update(updatePayload)
    .eq("org_id", session.profile.org_id)
    .eq("id", requestId)
    .is("deleted_at", null)
    .select(WORK_TOOL_REQUEST_SELECT)
    .limit(1);

  if (updateError || !updatedRows || updatedRows.length === 0) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "WORK_TOOL_REQUEST_UPDATE_FAILED",
        message: "Unable to update this work tool request."
      },
      meta: buildMeta()
    });
  }

  const [updatedRequest] = await hydrateWorkToolRequests(
    serviceClient,
    session.profile.org_id,
    updatedRows
  );

  await logAudit({
    action: "updated",
    tableName: "work_tool_requests",
    recordId: updatedRequest.id,
    oldValue: existingRows[0],
    newValue: updatePayload
  }).catch(() => undefined);

  return jsonResponse<WorkToolRequestUpdateResponseData>(200, {
    data: { request: updatedRequest },
    error: null,
    meta: buildMeta()
  });
}
