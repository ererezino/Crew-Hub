import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logger } from "../../../../../lib/logger";
import { sanitizeFileName } from "../../../../../lib/documents";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { validateUploadMagicBytes } from "../../../../../lib/security/upload-signatures";
import type { ApiResponse } from "../../../../../types/auth";

const MEDICAL_EVIDENCE_BUCKET = "documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"] as const;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg"
]);

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to upload medical evidence."
      },
      meta: buildMeta()
    });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request must be multipart form data."
      },
      meta: buildMeta()
    });
  }

  const file = formData.get("file");

  if (!file || !(file instanceof File) || file.size === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A file is required."
      },
      meta: buildMeta()
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "FILE_TOO_LARGE",
        message: "File must be 10 MB or smaller."
      },
      meta: buildMeta()
    });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_FILE_TYPE",
        message: "Only PDF, PNG, and JPEG files are accepted."
      },
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
      error: {
        code: "INVALID_FILE_SIGNATURE",
        message: magicResult.message ?? "File content does not match its extension."
      },
      meta: buildMeta()
    });
  }

  const safeName = sanitizeFileName(file.name);
  const timestamp = Date.now();
  const filePath = `medical-evidence/${session.profile.org_id}/${session.profile.id}/${timestamp}-${safeName}`;

  const supabase = await createSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(MEDICAL_EVIDENCE_BUCKET)
    .upload(filePath, file, {
      upsert: false,
      contentType: file.type
    });

  if (uploadError) {
    logger.error("Medical evidence upload failed.", {
      error: uploadError.message,
      employeeId: session.profile.id
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "UPLOAD_FAILED",
        message: "Unable to upload file. Please try again."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ filePath: string }>(200, {
    data: { filePath },
    error: null,
    meta: buildMeta()
  });
}
