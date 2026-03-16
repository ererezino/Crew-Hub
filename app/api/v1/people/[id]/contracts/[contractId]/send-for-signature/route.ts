import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../lib/audit";
import { createBulkNotifications } from "../../../../../../../../lib/notifications/service";
import { sendSignatureRequestEmail } from "../../../../../../../../lib/notifications/email";
import {
  buildMeta,
  jsonResponse
} from "../../../../../../../../lib/people/shared";
import { hasRole } from "../../../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../../../lib/supabase/service-role";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID."),
  contractId: z.string().uuid("Contract id must be a valid UUID.")
});

// ── POST /api/v1/people/[id]/contracts/[contractId]/send-for-signature ──
//
// Atomically creates a signature request for the contract's attached document
// and links it back to the contract. Sets sent_at if not already set.
//
// Note: pre_start_contracts does not use soft-delete (no deleted_at column).
// Contracts are voided via voided_at timestamp, not deleted.

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; contractId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Super Admin can send contracts for signature." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid parameters."
      },
      meta: buildMeta()
    });
  }

  const svc = createSupabaseServiceRoleClient();
  const orgId = session.profile.org_id;
  const { id: personId, contractId } = parsedParams.data;

  // ── Fetch contract ──────────────────────────────────────────────────
  const { data: contract, error: fetchError } = await svc
    .from("pre_start_contracts")
    .select("id, org_id, person_id, title, storage_path, file_name, signed_at, voided_at, sent_at, signature_request_id")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("person_id", personId)
    .maybeSingle();

  if (fetchError || !contract) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Contract not found." },
      meta: buildMeta()
    });
  }

  const row = contract as Record<string, unknown>;

  // ── Precondition checks ─────────────────────────────────────────────

  if (!row.storage_path) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "NO_DOCUMENT", message: "Contract must have an attached document before sending for signature." },
      meta: buildMeta()
    });
  }

  if (row.signed_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "ALREADY_SIGNED", message: "This contract is already signed." },
      meta: buildMeta()
    });
  }

  if (row.voided_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "CONTRACT_VOIDED", message: "Cannot send a voided contract for signature." },
      meta: buildMeta()
    });
  }

  if (row.signature_request_id) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "SIGNATURE_ALREADY_SENT", message: "A signature request has already been created for this contract." },
      meta: buildMeta()
    });
  }

  // ── Verify signer eligibility ───────────────────────────────────────
  const { data: signerProfile } = await svc
    .from("profiles")
    .select("id, full_name, email, status")
    .eq("id", personId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!signerProfile) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "SIGNER_NOT_ELIGIBLE", message: "Person not found or not eligible to sign." },
      meta: buildMeta()
    });
  }

  const sp = signerProfile as Record<string, unknown>;
  const signerEmail = sp.email as string | null;
  const signerStatus = sp.status as string;
  const signerName = sp.full_name as string;

  if (!signerEmail) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "SIGNER_NOT_ELIGIBLE", message: "Person must have a valid email to sign contracts." },
      meta: buildMeta()
    });
  }

  if (signerStatus === "inactive" || signerStatus === "offboarding") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "SIGNER_NOT_ELIGIBLE", message: "Inactive or offboarding team members cannot sign contracts." },
      meta: buildMeta()
    });
  }

  // ── Create a documents row for the contract PDF ─────────────────────
  // The signature system requires a document_id reference. We create a
  // row in the documents table pointing to the contract's PDF.
  const { data: docRow, error: docError } = await svc
    .from("documents")
    .insert({
      org_id: orgId,
      owner_user_id: personId,
      category: "contract",
      title: row.title as string,
      file_path: row.storage_path as string,
      file_name: row.file_name as string,
      mime_type: "application/pdf",
      size_bytes: 0,
      created_by: session.profile.id
    })
    .select("id")
    .single();

  if (docError || !docRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to register document for signature." },
      meta: buildMeta()
    });
  }

  const documentId = (docRow as Record<string, unknown>).id as string;

  // ── Create signature request ────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: sigReq, error: sigReqError } = await svc
    .from("signature_requests")
    .insert({
      org_id: orgId,
      document_id: documentId,
      title: `Sign: ${row.title as string}`,
      message: null,
      status: "pending",
      created_by: session.profile.id,
      sent_at: now
    })
    .select("id")
    .single();

  if (sigReqError || !sigReq) {
    // Clean up the document row
    await svc.from("documents").update({ deleted_at: now }).eq("id", documentId);
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to create signature request." },
      meta: buildMeta()
    });
  }

  const requestId = (sigReq as Record<string, unknown>).id as string;

  // ── Create signer row ───────────────────────────────────────────────
  const { error: signerError } = await svc
    .from("signature_signers")
    .insert({
      org_id: orgId,
      signature_request_id: requestId,
      signer_user_id: personId,
      signer_order: 1,
      status: "pending"
    });

  if (signerError) {
    // Clean up
    await svc.from("signature_requests").update({ deleted_at: now }).eq("id", requestId);
    await svc.from("documents").update({ deleted_at: now }).eq("id", documentId);
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to create signer record." },
      meta: buildMeta()
    });
  }

  // ── Create signature event ──────────────────────────────────────────
  await svc.from("signature_events").insert({
    org_id: orgId,
    signature_request_id: requestId,
    actor_user_id: session.profile.id,
    event_type: "created",
    event_payload: { signerCount: 1, contractId }
  });

  // ── Link signature request to contract + set sent_at ────────────────
  const contractPatch: Record<string, unknown> = {
    signature_request_id: requestId
  };

  if (!row.sent_at) {
    contractPatch.sent_at = now;
  }

  const { data: updatedContract, error: linkError } = await svc
    .from("pre_start_contracts")
    .update(contractPatch)
    .eq("id", contractId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (linkError || !updatedContract) {
    // Linking failed — clean up signature artifacts
    await svc.from("signature_signers").delete().eq("signature_request_id", requestId);
    await svc.from("signature_requests").update({ deleted_at: now }).eq("id", requestId);
    await svc.from("documents").update({ deleted_at: now }).eq("id", documentId);
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to link signature request to contract." },
      meta: buildMeta()
    });
  }

  // ── Notifications ───────────────────────────────────────────────────
  await createBulkNotifications({
    orgId,
    userIds: [personId],
    type: "signature_requested",
    title: "Signature request received",
    body: `${session.profile.full_name} requested your signature on "${row.title as string}".`,
    link: "/signatures",
    actions: [
      {
        label: "Sign Now",
        variant: "primary",
        action_type: "navigate",
        navigate_url: "/signatures"
      }
    ]
  });

  await sendSignatureRequestEmail({
    orgId,
    userId: personId,
    requestTitle: `Sign: ${row.title as string}`,
    requestedByName: session.profile.full_name
  }).catch((err: unknown) => console.error("Signature email send failed:", err));

  // ── Audit log ───────────────────────────────────────────────────────
  await logAudit({
    action: "updated",
    tableName: "pre_start_contracts",
    recordId: contractId,
    newValue: {
      event: "send_for_signature",
      signatureRequestId: requestId,
      documentId,
      signerUserId: personId,
      signerName
    }
  });

  // ── Build response ──────────────────────────────────────────────────
  const updatedRow = updatedContract as Record<string, unknown>;

  // Import mapContractRow equivalent inline
  const sentAt = (updatedRow.sent_at as string) ?? null;
  const signedAt = (updatedRow.signed_at as string) ?? null;
  const voidedAt = (updatedRow.voided_at as string) ?? null;

  function deriveStatus(s: string | null, si: string | null, v: string | null) {
    if (v) return "voided" as const;
    if (si) return "signed" as const;
    if (s) return "sent" as const;
    return "draft" as const;
  }

  const mapped = {
    id: updatedRow.id as string,
    personId: updatedRow.person_id as string,
    title: updatedRow.title as string,
    notes: (updatedRow.notes as string) ?? null,
    status: deriveStatus(sentAt, signedAt, voidedAt),
    storagePath: (updatedRow.storage_path as string) ?? null,
    fileName: (updatedRow.file_name as string) ?? null,
    signatureRequestId: requestId,
    signatureRequestStatus: "pending" as const,
    sentAt,
    signedAt,
    voidedAt,
    createdAt: updatedRow.created_at as string,
    updatedAt: updatedRow.updated_at as string
  };

  return jsonResponse<{ contract: typeof mapped; signatureRequestId: string }>(200, {
    data: { contract: mapped, signatureRequestId: requestId },
    error: null,
    meta: buildMeta()
  });
}
