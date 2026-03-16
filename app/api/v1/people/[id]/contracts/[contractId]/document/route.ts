import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../lib/audit";
import {
  CONTRACT_DOCUMENTS_BUCKET,
  CONTRACT_SIGNED_URL_TTL_SECONDS
} from "../../../../../../../../lib/contracts";
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

// ── GET /api/v1/people/[id]/contracts/[contractId]/document ─────────────
// Note: pre_start_contracts does not use soft-delete (no deleted_at column).
// Contracts are voided via voided_at timestamp, not deleted.

export async function GET(
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

  if (!hasRole(session.profile.roles, "SUPER_ADMIN") && !hasRole(session.profile.roles, "HR_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Super Admin or HR Admin can retrieve contract documents." },
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

  // Fetch contract
  const { data: contract, error: fetchError } = await svc
    .from("pre_start_contracts")
    .select("id, storage_path, file_name")
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
  const storagePath = row.storage_path as string | null;
  const fileName = row.file_name as string | null;

  if (!storagePath) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NO_DOCUMENT", message: "No document attached to this contract." },
      meta: buildMeta()
    });
  }

  // Generate a short-lived signed URL
  const { data: signedUrlData, error: signedUrlError } = await svc.storage
    .from(CONTRACT_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, CONTRACT_SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to generate download URL." },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "pre_start_contracts",
    recordId: contractId,
    newValue: {
      event: "document_retrieved",
      fileName
    }
  });

  return jsonResponse<{ url: string; fileName: string | null }>(200, {
    data: {
      url: signedUrlData.signedUrl,
      fileName
    },
    error: null,
    meta: buildMeta()
  });
}
