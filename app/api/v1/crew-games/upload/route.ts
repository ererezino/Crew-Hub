import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { validateUploadMagicBytes } from "../../../../../lib/security/upload-signatures";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../_helpers";
import {
  EVENT_IMAGE_MAX_BYTES,
  SLIDES_MAX_BYTES,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_SLIDES_EXTENSIONS,
  CREW_NIGHTS_BUCKET
} from "../../../../../types/crew-games";

/* ── POST /api/v1/crew-games/upload ── */

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile, CREW_GAMES_ADMIN_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You do not have permission to upload files." },
      meta: buildMeta()
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Expected multipart form data." },
      meta: buildMeta()
    });
  }

  const rawFile = formData.get("file");
  const uploadType = formData.get("type") as string | null; // "event_image" or "slides"
  const storagePath = formData.get("path") as string | null;

  if (!(rawFile instanceof File)) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "NO_FILE", message: "No file provided." },
      meta: buildMeta()
    });
  }

  if (!uploadType || !storagePath) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "MISSING_FIELDS", message: "Upload type and path are required." },
      meta: buildMeta()
    });
  }

  // Ensure storage path is scoped to the user's org
  const orgPrefix = `${session.profile.org_id}/`;
  if (!storagePath.startsWith(orgPrefix)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Invalid upload path." },
      meta: buildMeta()
    });
  }

  const isEventImage = uploadType === "event_image";
  const isSlides = uploadType === "slides";

  if (!isEventImage && !isSlides) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "INVALID_TYPE", message: "Upload type must be 'event_image' or 'slides'." },
      meta: buildMeta()
    });
  }

  // Size check
  const maxBytes = isEventImage ? EVENT_IMAGE_MAX_BYTES : SLIDES_MAX_BYTES;
  if (rawFile.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "FILE_TOO_LARGE",
        message: `File exceeds the ${maxMb} MB limit.`
      },
      meta: buildMeta()
    });
  }

  // Extension + magic bytes validation
  const allowedExtensions = isEventImage
    ? (ALLOWED_IMAGE_EXTENSIONS as unknown as string[])
    : (ALLOWED_SLIDES_EXTENSIONS as unknown as string[]);

  const magicResult = await validateUploadMagicBytes({
    file: rawFile,
    fileName: rawFile.name,
    allowedExtensions
  });

  if (!magicResult.valid) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_FILE",
        message: magicResult.message ?? "This file type is not allowed."
      },
      meta: buildMeta()
    });
  }

  // Upload to storage
  const supabase = await createSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(CREW_NIGHTS_BUCKET)
    .upload(storagePath, rawFile, {
      upsert: true,
      contentType: rawFile.type || "application/octet-stream"
    });

  if (uploadError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPLOAD_FAILED", message: "Unable to upload file." },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ path: string; filename: string }>(200, {
    data: { path: storagePath, filename: rawFile.name },
    error: null,
    meta: buildMeta()
  });
}

/* ── DELETE /api/v1/crew-games/upload ── */

export async function DELETE(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile, CREW_GAMES_ADMIN_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You do not have permission to delete files." },
      meta: buildMeta()
    });
  }

  let body: { path: string };
  try {
    body = await request.json() as { path: string };
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  if (!body.path || typeof body.path !== "string") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "MISSING_PATH", message: "File path is required." },
      meta: buildMeta()
    });
  }

  // Org scope check
  const orgPrefix = `${session.profile.org_id}/`;
  if (!body.path.startsWith(orgPrefix)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Invalid file path." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { error: removeError } = await supabase.storage
    .from(CREW_NIGHTS_BUCKET)
    .remove([body.path]);

  if (removeError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "DELETE_FAILED", message: "Unable to delete file." },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ deleted: true }>(200, {
    data: { deleted: true },
    error: null,
    meta: buildMeta()
  });
}
