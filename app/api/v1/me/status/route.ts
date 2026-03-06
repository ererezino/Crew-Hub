import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const AVAILABILITY_STATUSES = [
  "available",
  "in_meeting",
  "on_break",
  "focusing",
  "afk",
  "ooo"
] as const;

const updateStatusSchema = z.object({
  status: z.enum(AVAILABILITY_STATUSES),
  note: z.string().trim().max(200).optional().default("")
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
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid status." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      availability_status: parsed.data.status,
      status_note: parsed.data.note || null,
      status_updated_at: new Date().toISOString()
    })
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "STATUS_UPDATE_FAILED", message: "Unable to update your status." },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ status: string; note: string }>(200, {
    data: { status: parsed.data.status, note: parsed.data.note },
    error: null,
    meta: buildMeta()
  });
}
