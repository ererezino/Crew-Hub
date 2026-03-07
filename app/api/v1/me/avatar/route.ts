import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const sessionProfileSchema = z.object({
  id: z.string().uuid("Session profile id is invalid.")
});

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const parsedProfile = sessionProfileSchema.safeParse(session.profile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SESSION_INVALID", message: parsedProfile.error.issues[0]?.message ?? "Invalid session profile." },
      meta: buildMeta()
    });
  }

  const userId = parsedProfile.data.id;

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

  if (!file || !(file instanceof File)) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "A file is required." },
      meta: buildMeta()
    });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "File must be JPG, PNG, or WebP."
      },
      meta: buildMeta()
    });
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "File must be 5 MB or smaller."
      },
      meta: buildMeta()
    });
  }

  const ext = MIME_TO_EXT[file.type] ?? "jpg";
  const filePath = `${userId}/${userId}.${ext}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const supabase = createSupabaseServiceRoleClient();

  // Remove any existing avatar files for this user before uploading
  const { data: existingFiles } = await supabase.storage
    .from("avatars")
    .list(userId);

  if (existingFiles && existingFiles.length > 0) {
    const filesToRemove = existingFiles.map((f) => `${userId}/${f.name}`);
    await supabase.storage.from("avatars").remove(filesToRemove);
  }

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, fileBuffer, {
      contentType: file.type,
      upsert: true
    });

  if (uploadError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "UPLOAD_FAILED",
        message: "Unable to upload avatar."
      },
      meta: buildMeta()
    });
  }

  const { data: publicUrlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  const avatarUrl = publicUrlData.publicUrl;

  // Update the profile with the new avatar URL
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Avatar uploaded but profile update failed."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ avatarUrl: string }>(200, {
    data: { avatarUrl },
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const parsedProfile = sessionProfileSchema.safeParse(session.profile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SESSION_INVALID", message: parsedProfile.error.issues[0]?.message ?? "Invalid session profile." },
      meta: buildMeta()
    });
  }

  const userId = parsedProfile.data.id;
  const supabase = createSupabaseServiceRoleClient();

  // List and remove all avatar files for this user
  const { data: existingFiles } = await supabase.storage
    .from("avatars")
    .list(userId);

  if (existingFiles && existingFiles.length > 0) {
    const filesToRemove = existingFiles.map((f) => `${userId}/${f.name}`);
    const { error: removeError } = await supabase.storage
      .from("avatars")
      .remove(filesToRemove);

    if (removeError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DELETE_FAILED",
          message: "Unable to remove avatar file."
        },
        meta: buildMeta()
      });
    }
  }

  // Clear the avatar URL on the profile
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", userId);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Avatar removed but profile update failed."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ avatarUrl: null }>(200, {
    data: { avatarUrl: null },
    error: null,
    meta: buildMeta()
  });
}
