import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  avatarUrl: z
    .string()
    .trim()
    .max(500, "Avatar URL is too long")
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: "Avatar URL must start with http:// or https://"
    }),
  phone: z.string().trim().max(30, "Phone number is too long")
});

type ProfileResponseData = {
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
};

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
        message: "You must be logged in to update profile settings."
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

  const parsed = profileSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid profile payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data, error } = await serviceClient
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      avatar_url: parsed.data.avatarUrl || null,
      phone: parsed.data.phone || null
    })
    .eq("id", session.profile.id)
    .select("full_name, avatar_url, phone")
    .single();

  if (error || !data) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to update profile settings."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<ProfileResponseData>(200, {
    data: {
      fullName: data.full_name,
      avatarUrl: data.avatar_url,
      phone: data.phone
    },
    error: null,
    meta: buildMeta()
  });
}
