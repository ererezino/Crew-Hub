import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { createNotification } from "../../../../../../lib/notifications/service";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  SIGNATURE_REQUEST_STATUSES,
  SIGNATURE_SIGNER_STATUSES,
  type SignSignatureResponseData
} from "../../../../../../types/esignatures";

const paramsSchema = z.object({
  requestId: z.string().uuid("Request id must be a valid uuid.")
});

const payloadSchema = z.object({
  signatureText: z
    .string()
    .trim()
    .min(2, "Signature text must be at least 2 characters.")
    .max(120, "Signature text must be 120 characters or fewer.")
    .optional()
});

const requestRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  status: z.enum(SIGNATURE_REQUEST_STATUSES),
  title: z.string(),
  created_by: z.string().uuid()
});

const signerRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(SIGNATURE_SIGNER_STATUSES)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to sign documents."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const parsedParams = paramsSchema.safeParse(params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: parsedParams.error.issues[0]?.message ?? "Invalid request id."
      },
      meta: buildMeta()
    });
  }

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsedBody = payloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid sign payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const serviceRoleClient = createSupabaseServiceRoleClient();

  const { data: rawRequestRow, error: requestError } = await supabase
    .from("signature_requests")
    .select("id, org_id, status, title, created_by")
    .eq("id", parsedParams.data.requestId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (requestError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_REQUEST_FETCH_FAILED",
        message: "Unable to load signature request."
      },
      meta: buildMeta()
    });
  }

  const parsedRequestRow = requestRowSchema.safeParse(rawRequestRow);

  if (!parsedRequestRow.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Signature request was not found."
      },
      meta: buildMeta()
    });
  }

  if (
    parsedRequestRow.data.status === "completed" ||
    parsedRequestRow.data.status === "voided" ||
    parsedRequestRow.data.status === "expired"
  ) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "This signature request can no longer be signed."
      },
      meta: buildMeta()
    });
  }

  const { data: rawSignerRow, error: signerError } = await supabase
    .from("signature_signers")
    .select("id, status")
    .eq("signature_request_id", parsedRequestRow.data.id)
    .eq("org_id", session.profile.org_id)
    .eq("signer_user_id", session.profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (signerError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNER_FETCH_FAILED",
        message: "Unable to load signer record."
      },
      meta: buildMeta()
    });
  }

  const parsedSignerRow = signerRowSchema.safeParse(rawSignerRow);

  if (!parsedSignerRow.success) {
    const isAdmin =
      hasRole(session.profile.roles, "HR_ADMIN") || hasRole(session.profile.roles, "SUPER_ADMIN");

    if (!isAdmin) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not a signer on this request."
        },
        meta: buildMeta()
      });
    }

    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Signer record was not found for this account."
      },
      meta: buildMeta()
    });
  }

  if (parsedSignerRow.data.status === "signed") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "ALREADY_SIGNED",
        message: "You have already signed this request."
      },
      meta: buildMeta()
    });
  }

  if (parsedSignerRow.data.status === "declined") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "DECLINED",
        message: "You previously declined this request and cannot sign it."
      },
      meta: buildMeta()
    });
  }

  const signedAt = new Date().toISOString();

  const { error: updateSignerError } = await supabase
    .from("signature_signers")
    .update({
      status: "signed",
      signed_at: signedAt,
      signature_text: parsedBody.data.signatureText ?? session.profile.full_name
    })
    .eq("id", parsedSignerRow.data.id)
    .eq("org_id", session.profile.org_id);

  if (updateSignerError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNER_UPDATE_FAILED",
        message: "Unable to save your signature."
      },
      meta: buildMeta()
    });
  }

  await serviceRoleClient.from("signature_events").insert({
    org_id: session.profile.org_id,
    signature_request_id: parsedRequestRow.data.id,
    actor_user_id: session.profile.id,
    event_type: "signed",
    event_payload: {
      signerId: session.profile.id
    }
  });

  const { data: pendingRows, error: pendingRowsError } = await serviceRoleClient
    .from("signature_signers")
    .select("id")
    .eq("signature_request_id", parsedRequestRow.data.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("status", ["pending", "viewed", "declined"]);

  if (pendingRowsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_STATUS_REFRESH_FAILED",
        message: "Unable to refresh signature request status."
      },
      meta: buildMeta()
    });
  }

  const hasPendingRows = (pendingRows ?? []).length > 0;
  const nextRequestStatus = hasPendingRows ? "partially_signed" : "completed";

  const requestPatch: {
    status: "partially_signed" | "completed";
    completed_at?: string;
  } = {
    status: nextRequestStatus
  };

  if (!hasPendingRows) {
    requestPatch.completed_at = signedAt;
  }

  const { error: updateRequestError } = await serviceRoleClient
    .from("signature_requests")
    .update(requestPatch)
    .eq("id", parsedRequestRow.data.id)
    .eq("org_id", session.profile.org_id);

  if (updateRequestError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_REQUEST_UPDATE_FAILED",
        message: "Unable to update signature request status."
      },
      meta: buildMeta()
    });
  }

  if (!hasPendingRows) {
    await serviceRoleClient.from("signature_events").insert({
      org_id: session.profile.org_id,
      signature_request_id: parsedRequestRow.data.id,
      actor_user_id: session.profile.id,
      event_type: "completed",
      event_payload: {
        completedAt: signedAt
      }
    });
  }

  await createNotification({
    orgId: session.profile.org_id,
    userId: parsedRequestRow.data.created_by,
    type: hasPendingRows ? "signature_signed" : "signature_completed",
    title: hasPendingRows ? "A signer completed their signature" : "Signature request completed",
    body: hasPendingRows
      ? `${session.profile.full_name} signed "${parsedRequestRow.data.title}".`
      : `"${parsedRequestRow.data.title}" is fully signed.`,
    link: "/signatures"
  });

  await logAudit({
    action: "approved",
    tableName: "signature_signers",
    recordId: parsedSignerRow.data.id,
    newValue: {
      requestId: parsedRequestRow.data.id,
      signerUserId: session.profile.id,
      signedAt
    }
  });

  return jsonResponse<SignSignatureResponseData>(200, {
    data: {
      requestId: parsedRequestRow.data.id,
      status: nextRequestStatus,
      signerStatus: "signed",
      signedAt
    },
    error: null,
    meta: buildMeta()
  });
}
