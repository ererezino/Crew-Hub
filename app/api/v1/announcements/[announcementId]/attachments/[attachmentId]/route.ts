import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../types/auth";

const paramsSchema = z.object({
  announcementId: z.string().uuid(),
  attachmentId: z.string().uuid()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

type RouteContext = { params: Promise<Record<string, string>> };

type SignedUrlResponseData = {
  url: string;
  fileName: string;
  mimeType: string;
};

/**
 * GET /api/v1/announcements/[announcementId]/attachments/[attachmentId]
 *
 * Returns a JSON response with a short-lived signed URL for the attachment.
 * Used by the client to render inline images and provide download links.
 * Auth: any authenticated org member.
 */
export async function GET(
  _request: Request,
  context: RouteContext
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid parameters." },
      meta: buildMeta()
    });
  }

  const { announcementId, attachmentId } = parsedParams.data;
  const supabase = await createSupabaseServerClient();

  // Verify attachment belongs to org and announcement
  const { data: attachment, error: fetchError } = await supabase
    .from("announcement_attachments")
    .select("id, file_path, file_name, mime_type")
    .eq("id", attachmentId)
    .eq("announcement_id", announcementId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !attachment) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Attachment not found." },
      meta: buildMeta()
    });
  }

  // Generate a signed URL (valid for 5 minutes).
  // Use service-role because the documents bucket SELECT policy only joins
  // against the documents table, not announcement_attachments.
  const storageClient = createSupabaseServiceRoleClient();
  const { data: signedUrlData, error: signedUrlError } = await storageClient.storage
    .from("documents")
    .createSignedUrl(attachment.file_path, 300);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "STORAGE_ERROR", message: "Unable to generate download URL." },
      meta: buildMeta()
    });
  }

  return jsonResponse<SignedUrlResponseData>(200, {
    data: {
      url: signedUrlData.signedUrl,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type
    },
    error: null,
    meta: buildMeta()
  });
}
