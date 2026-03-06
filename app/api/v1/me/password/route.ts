import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@supabase/supabase-js";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to change your password."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsed.error.issues[0]?.message ?? "Invalid password payload."
      },
      meta: buildMeta()
    });
  }

  const { currentPassword, newPassword } = parsed.data;

  // Verify the current password by attempting to sign in with a disposable client
  // (avoids mutating the session cookies on the real server client)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: "Authentication is not configured."
      },
      meta: buildMeta()
    });
  }

  const disposableClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { error: signInError } =
    await disposableClient.auth.signInWithPassword({
      email: session.profile.email,
      password: currentPassword
    });

  if (signInError) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "INVALID_CURRENT_PASSWORD",
        message: "Current password is incorrect."
      },
      meta: buildMeta()
    });
  }

  // Update to new password using service role client
  const serviceClient = createSupabaseServiceRoleClient();

  const { error: updateError } =
    await serviceClient.auth.admin.updateUserById(session.userId, {
      password: newPassword
    });

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PASSWORD_UPDATE_FAILED",
        message: "Unable to update password. Please try again."
      },
      meta: buildMeta()
    });
  }

  // Clear the password_change_required flag
  const { error: profileError } = await serviceClient
    .from("profiles")
    .update({ password_change_required: false })
    .eq("id", session.profile.id);

  if (profileError) {
    console.error("Failed to clear password_change_required flag.", {
      userId: session.profile.id,
      message: profileError.message
    });
  }

  return jsonResponse<{ success: boolean }>(200, {
    data: { success: true },
    error: null,
    meta: buildMeta()
  });
}
