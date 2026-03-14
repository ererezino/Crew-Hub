import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { sendOnboardingCompleteEmail } from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import { completeOnboarding } from "../../../../../../lib/onboarding/auto-transition";
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

const SIGNATURE_STORAGE_BUCKET = "documents";
const MAX_SIGNATURE_IMAGE_BYTES = 2_500_000;

const payloadSchema = z
  .object({
    signatureMode: z.enum(["typed", "drawn"]).optional(),
    signatureText: z
      .string()
      .trim()
      .min(2, "Signature text must be at least 2 characters.")
      .max(120, "Signature text must be 120 characters or fewer.")
      .optional(),
    signatureImageData: z
      .string()
      .trim()
      .min(1000, "Drawn signatures must include image data.")
      .max(3_000_000, "Drawn signature image data is too large.")
      .optional()
  })
  .superRefine((value, context) => {
    const mode = value.signatureMode ?? (value.signatureImageData ? "drawn" : "typed");

    if (mode === "drawn" && !value.signatureImageData) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureImageData"],
        message: "Drawn signatures require signature image data."
      });
    }
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

function parseSignatureImagePayload(payload: string): {
  base64: string;
  contentType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
} {
  const trimmed = payload.trim();
  const dataUrlMatch = trimmed.match(
    /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/i
  );

  if (dataUrlMatch) {
    const matchedContentType = dataUrlMatch[1]?.toLowerCase() as "image/png" | "image/jpeg";
    const base64Value = dataUrlMatch[2] ?? "";
    return {
      base64: base64Value,
      contentType: matchedContentType,
      extension: matchedContentType === "image/jpeg" ? "jpg" : "png"
    };
  }

  return {
    base64: trimmed,
    contentType: "image/png",
    extension: "png"
  };
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

  const resolvedSignatureMode =
    parsedBody.data.signatureMode ?? (parsedBody.data.signatureImageData ? "drawn" : "typed");
  let signatureImagePath: string | null = null;

  if (resolvedSignatureMode === "drawn") {
    const imagePayload = parsedBody.data.signatureImageData;

    if (!imagePayload) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Drawn signatures require signature image data."
        },
        meta: buildMeta()
      });
    }

    const parsedImage = parseSignatureImagePayload(imagePayload);
    const signatureBytes = Buffer.from(parsedImage.base64, "base64");

    if (!signatureBytes.length) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Drawn signature image data is invalid."
        },
        meta: buildMeta()
      });
    }

    if (signatureBytes.length > MAX_SIGNATURE_IMAGE_BYTES) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Drawn signature image exceeds the size limit."
        },
        meta: buildMeta()
      });
    }

    signatureImagePath = `${session.profile.org_id}/signatures/${parsedRequestRow.data.id}/${session.profile.id}-${Date.now()}.${parsedImage.extension}`;
    const { error: uploadSignatureError } = await serviceRoleClient.storage
      .from(SIGNATURE_STORAGE_BUCKET)
      .upload(signatureImagePath, signatureBytes, {
        contentType: parsedImage.contentType,
        upsert: false
      });

    if (uploadSignatureError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SIGNATURE_UPLOAD_FAILED",
          message: "Unable to upload drawn signature image."
        },
        meta: buildMeta()
      });
    }
  }

  const signedAt = new Date().toISOString();
  const signatureTextValue =
    resolvedSignatureMode === "typed"
      ? parsedBody.data.signatureText ?? session.profile.full_name
      : null;

  const { error: updateSignerError } = await supabase
    .from("signature_signers")
    .update({
      status: "signed",
      signed_at: signedAt,
      signature_text: signatureTextValue,
      signature_mode: resolvedSignatureMode,
      signature_image_path: signatureImagePath
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
      signerId: session.profile.id,
      signatureMode: resolvedSignatureMode
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
      signedAt,
      signatureMode: resolvedSignatureMode,
      signatureImagePath
    }
  });

  // Auto-complete onboarding tasks linked to this signature request
  try {
    const { data: linkedTasks } = await serviceRoleClient
      .from("onboarding_tasks")
      .select("id, instance_id, org_id")
      .eq("signature_request_id", parsedRequestRow.data.id)
      .eq("org_id", session.profile.org_id)
      .neq("status", "completed");

    if (linkedTasks && linkedTasks.length > 0) {
      for (const linkedTask of linkedTasks) {
        await serviceRoleClient
          .from("onboarding_tasks")
          .update({
            status: "completed",
            completed_by: session.profile.id,
            completed_at: signedAt
          })
          .eq("id", linkedTask.id)
          .eq("org_id", session.profile.org_id);

        // Recalculate onboarding instance progress using per-track checks
        // (same logic as the normal task completion path)
        if (linkedTask.instance_id) {
          const { data: allInstanceTasks } = await serviceRoleClient
            .from("onboarding_tasks")
            .select("id, status, track")
            .eq("instance_id", linkedTask.instance_id)
            .eq("org_id", session.profile.org_id)
            .is("deleted_at", null);

          if (allInstanceTasks && allInstanceTasks.length > 0) {
            const employeeTasks = allInstanceTasks.filter((t) => t.track === "employee");
            const opsTasks = allInstanceTasks.filter((t) => t.track === "operations");
            const employeeDone = employeeTasks.length === 0 || employeeTasks.every((t) => t.status === "completed");
            const opsDone = opsTasks.length === 0 || opsTasks.every((t) => t.status === "completed");
            const allDone = allInstanceTasks.length > 0 && employeeDone && opsDone;

            if (allDone) {
              // Fetch instance type to determine whether to call completeOnboarding
              const { data: instanceRow } = await serviceRoleClient
                .from("onboarding_instances")
                .select("employee_id, type")
                .eq("id", linkedTask.instance_id)
                .eq("org_id", session.profile.org_id)
                .maybeSingle();

              if (instanceRow) {
                if (instanceRow.type === "onboarding") {
                  // Use the same completeOnboarding() as the normal task completion path:
                  // marks instance completed, transitions profile to active, creates leave balances,
                  // writes audit log, sends in-app notification
                  await completeOnboarding({
                    supabase: serviceRoleClient,
                    orgId: session.profile.org_id,
                    instanceId: linkedTask.instance_id,
                    employeeId: instanceRow.employee_id
                  });
                } else {
                  // Offboarding — just mark instance as completed
                  await serviceRoleClient
                    .from("onboarding_instances")
                    .update({ status: "completed", completed_at: new Date().toISOString() })
                    .eq("id", linkedTask.instance_id)
                    .eq("org_id", session.profile.org_id);
                }

                // Send onboarding/offboarding complete email
                const { data: empProfile } = await serviceRoleClient
                  .from("profiles")
                  .select("id, full_name, manager_id")
                  .eq("id", instanceRow.employee_id)
                  .eq("org_id", session.profile.org_id)
                  .is("deleted_at", null)
                  .maybeSingle();

                if (empProfile) {
                  sendOnboardingCompleteEmail({
                    orgId: session.profile.org_id,
                    userId: empProfile.id,
                    managerId: typeof empProfile.manager_id === "string" ? empProfile.manager_id : session.profile.id,
                    employeeName: empProfile.full_name
                  }).catch((err) => console.error("Email send failed:", err));
                }
              }
            }
          }
        }
      }
    }
  } catch {
    console.error("Unable to auto-complete onboarding task for signature request.", {
      requestId: parsedRequestRow.data.id
    });
  }

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
