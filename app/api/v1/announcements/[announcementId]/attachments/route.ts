import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logger } from "../../../../../../lib/logger";
import { hasRole } from "../../../../../../lib/roles";
import { sanitizeFileName } from "../../../../../../lib/documents";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { validateUploadMagicBytes } from "../../../../../../lib/security/upload-signatures";
import type { ApiResponse } from "../../../../../../types/auth";
import type { AnnouncementAttachment } from "../../../../../../types/announcements";

const ATTACHMENTS_BUCKET = "documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = ["pdf", "docx", "png", "jpg", "jpeg", "gif", "webp"] as const;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp"
]);

const paramsSchema = z.object({
  announcementId: z.string().uuid()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

type RouteContext = { params: Promise<Record<string, string>> };

/* ─── GET — list attachments for an announcement ─── */
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

  const paramsParsed = paramsSchema.safeParse(await context.params);
  if (!paramsParsed.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid announcement ID." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: attachments, error } = await supabase
    .from("announcement_attachments")
    .select("id, announcement_id, file_name, file_path, file_size_bytes, mime_type, created_at")
    .eq("announcement_id", paramsParsed.data.announcementId)
    .eq("org_id", session.profile.org_id)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load attachments." },
      meta: buildMeta()
    });
  }

  const mapped: AnnouncementAttachment[] = (attachments ?? []).map((row) => ({
    id: row.id,
    announcementId: row.announcement_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
    createdAt: row.created_at
  }));

  return jsonResponse<{ attachments: AnnouncementAttachment[] }>(200, {
    data: { attachments: mapped },
    error: null,
    meta: buildMeta()
  });
}

/* ─── POST — upload attachment (HR_ADMIN / SUPER_ADMIN) ─── */
export async function POST(
  request: Request,
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

  if (
    !hasRole(session.profile.roles, "HR_ADMIN") &&
    !hasRole(session.profile.roles, "SUPER_ADMIN")
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only HR admins can upload attachments." },
      meta: buildMeta()
    });
  }

  const paramsParsed = paramsSchema.safeParse(await context.params);
  if (!paramsParsed.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid announcement ID." },
      meta: buildMeta()
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request must be multipart form data." },
      meta: buildMeta()
    });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "A file is required." },
      meta: buildMeta()
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "FILE_TOO_LARGE", message: "File must be 25 MB or smaller." },
      meta: buildMeta()
    });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "INVALID_FILE_TYPE", message: "Only PDF, DOCX, PNG, JPEG, GIF, and WebP files are accepted." },
      meta: buildMeta()
    });
  }

  const magicResult = await validateUploadMagicBytes({
    file,
    fileName: file.name,
    allowedExtensions: [...ALLOWED_EXTENSIONS]
  });

  if (!magicResult.valid) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "INVALID_FILE_SIGNATURE", message: magicResult.message ?? "File content does not match its extension." },
      meta: buildMeta()
    });
  }

  const safeName = sanitizeFileName(file.name);
  const timestamp = Date.now();
  const storagePath = `announcement-attachments/${session.profile.org_id}/${paramsParsed.data.announcementId}/${timestamp}-${safeName}`;

  const supabase = await createSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type });

  if (uploadError) {
    logger.error("Announcement attachment upload failed.", {
      error: uploadError.message,
      announcementId: paramsParsed.data.announcementId
    });
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPLOAD_FAILED", message: "Unable to upload file. Please try again." },
      meta: buildMeta()
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("announcement_attachments")
    .insert({
      announcement_id: paramsParsed.data.announcementId,
      org_id: session.profile.org_id,
      file_name: safeName,
      file_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type
    })
    .select("id, announcement_id, file_name, file_path, file_size_bytes, mime_type, created_at")
    .single();

  if (insertError || !inserted) {
    logger.error("Announcement attachment record insert failed.", {
      error: insertError?.message,
      announcementId: paramsParsed.data.announcementId
    });
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INSERT_FAILED", message: "File uploaded but record creation failed." },
      meta: buildMeta()
    });
  }

  const attachment: AnnouncementAttachment = {
    id: inserted.id,
    announcementId: inserted.announcement_id,
    fileName: inserted.file_name,
    filePath: inserted.file_path,
    fileSizeBytes: inserted.file_size_bytes,
    mimeType: inserted.mime_type,
    createdAt: inserted.created_at
  };

  return jsonResponse<{ attachment: AnnouncementAttachment }>(201, {
    data: { attachment },
    error: null,
    meta: buildMeta()
  });
}

/* ─── DELETE — remove attachment (SUPER_ADMIN only) ─── */
export async function DELETE(
  request: Request,
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

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only super admins can delete attachments." },
      meta: buildMeta()
    });
  }

  let body: { attachmentId?: string };
  try {
    body = (await request.json()) as { attachmentId?: string };
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  if (!body.attachmentId || typeof body.attachmentId !== "string") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "attachmentId is required." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Fetch attachment to get file_path
  const { data: attachment } = await supabase
    .from("announcement_attachments")
    .select("id, file_path")
    .eq("id", body.attachmentId)
    .eq("org_id", session.profile.org_id)
    .single();

  if (!attachment) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Attachment not found." },
      meta: buildMeta()
    });
  }

  // Delete from storage
  await supabase.storage.from(ATTACHMENTS_BUCKET).remove([attachment.file_path]);

  // Delete DB record
  const { error: deleteError } = await supabase
    .from("announcement_attachments")
    .delete()
    .eq("id", body.attachmentId);

  if (deleteError) {
    logger.error("Announcement attachment delete failed.", {
      error: deleteError.message,
      attachmentId: body.attachmentId
    });
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "DELETE_FAILED", message: "Unable to delete attachment." },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ attachmentId: string }>(200, {
    data: { attachmentId: body.attachmentId },
    error: null,
    meta: buildMeta()
  });
}
