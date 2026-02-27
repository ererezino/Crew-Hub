import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import type { ApiResponse } from "../../../../../../types/auth";
import type { MarkNotificationReadResponseData } from "../../../../../../types/notifications";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";

const paramsSchema = z.object({
  notificationId: z.string().uuid()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update notifications."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Notification id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const readAt = new Date().toISOString();
  const supabase = await createSupabaseServerClient();

  const { data: updatedRow, error: updateError } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: readAt
    })
    .eq("id", parsedParams.data.notificationId)
    .eq("org_id", session.profile.org_id)
    .eq("user_id", session.profile.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATION_READ_FAILED",
        message: "Unable to mark notification as read."
      },
      meta: buildMeta()
    });
  }

  if (!updatedRow?.id) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Notification not found."
      },
      meta: buildMeta()
    });
  }

  const responseData: MarkNotificationReadResponseData = {
    notificationId: updatedRow.id,
    readAt
  };

  return jsonResponse<MarkNotificationReadResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
