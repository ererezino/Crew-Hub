import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { logAudit } from "../../../../../lib/audit";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const paramsSchema = z.object({
  documentId: z.string().uuid("Document id must be a valid UUID.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * DELETE /api/v1/documents/[documentId]
 *
 * Soft-deletes a document. Restricted to SUPER_ADMIN and HR_ADMIN.
 * Sets `deleted_at` on the document record (preserves data for audit trail).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to delete documents."
      },
      meta: buildMeta()
    });
  }

  if (
    !hasRole(session.profile.roles, "SUPER_ADMIN") &&
    !hasRole(session.profile.roles, "HR_ADMIN")
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin or HR Admin can delete documents."
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
        message: parsedParams.error.issues[0]?.message ?? "Invalid document id."
      },
      meta: buildMeta()
    });
  }

  const documentId = parsedParams.data.documentId;
  const adminClient = createSupabaseServiceRoleClient();

  // Verify the document exists in the same org
  const { data: existingDoc, error: fetchError } = await adminClient
    .from("documents")
    .select("id, title, category")
    .eq("id", documentId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENT_FETCH_FAILED",
        message: "Unable to verify document."
      },
      meta: buildMeta()
    });
  }

  if (!existingDoc) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Document not found in this organization."
      },
      meta: buildMeta()
    });
  }

  // Soft-delete
  const { error: deleteError } = await adminClient
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENT_DELETE_FAILED",
        message: "Unable to delete document."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "documents",
    recordId: documentId,
    newValue: {
      title: existingDoc.title,
      category: existingDoc.category,
      deletedBy: session.profile.id
    }
  });

  return jsonResponse<{ documentId: string }>(200, {
    data: { documentId },
    error: null,
    meta: buildMeta()
  });
}
