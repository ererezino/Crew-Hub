import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const paramsSchema = z.object({
  notificationId: z.string().uuid()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * DELETE /api/v1/notifications/[notificationId]
 *
 * Super Admin only — soft-deletes a notification company-wide.
 * Finds all notifications in the org with the same type + title
 * and soft-deletes them so no user in the company sees it again.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can delete notifications."
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

  const supabase = await createSupabaseServerClient();
  const notificationId = parsedParams.data.notificationId;

  /* Look up the notification to get its type + title for company-wide match */
  const { data: sourceRow, error: fetchError } = await supabase
    .from("notifications")
    .select("id, type, title, org_id")
    .eq("id", notificationId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATION_FETCH_FAILED",
        message: "Unable to look up the notification."
      },
      meta: buildMeta()
    });
  }

  if (!sourceRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Notification not found."
      },
      meta: buildMeta()
    });
  }

  /* Soft-delete all matching notifications org-wide (same type + title) */
  const adminClient = createSupabaseServiceRoleClient();
  const deletedAt = new Date().toISOString();

  const { error: deleteError } = await adminClient
    .from("notifications")
    .update({ deleted_at: deletedAt })
    .eq("org_id", sourceRow.org_id)
    .eq("type", sourceRow.type)
    .eq("title", sourceRow.title)
    .is("deleted_at", null);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATION_DELETE_FAILED",
        message: "Unable to delete notification."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "notifications",
    recordId: notificationId,
    newValue: {
      event: "company_wide_notification_delete",
      type: sourceRow.type,
      title: sourceRow.title
    }
  }).catch(() => undefined);

  return jsonResponse<{ deletedAt: string }>(200, {
    data: { deletedAt },
    error: null,
    meta: buildMeta()
  });
}
