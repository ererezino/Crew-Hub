import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import type { ApiResponse } from "../../../../../types/auth";

const requestAccessSchema = z.object({
  hubId: z.string().uuid(),
  hubName: z.string().trim().max(200),
  department: z.string().trim().max(100).nullable(),
  reason: z.string().trim().max(500)
});

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

  const parsed = requestAccessSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid request."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const fullName = session.profile.full_name ?? "A crew member";

  // Find all super admins in the org
  const { data: adminProfiles } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  const superAdminIds = (adminProfiles ?? [])
    .filter((p) => {
      const roles = p.roles as string[] | null;
      return Array.isArray(roles) && roles.includes("SUPER_ADMIN");
    })
    .map((p) => p.id as string);

  if (superAdminIds.length > 0) {
    void createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: superAdminIds,
      type: "access_request",
      title: `${fullName} is requesting access to ${parsed.data.hubName}`,
      body: parsed.data.reason,
      link: "/admin/access-control",
      skipIfUnreadDuplicate: true
    });
  }

  return jsonResponse<{ sent: boolean }>(200, {
    data: { sent: superAdminIds.length > 0 },
    error: null,
    meta: buildMeta()
  });
}
