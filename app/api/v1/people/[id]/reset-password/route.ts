import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import type { PeoplePasswordResetResponseData } from "../../../../../../types/people";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function resolveAuthRedirectUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    requestUrl.origin;
  const normalizedAppUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${normalizedAppUrl}/reset-password`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to send password setup links."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can send password setup links."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid user id."
      },
      meta: buildMeta()
    });
  }

  const personId = parsedParams.data.id;
  const serviceRoleClient = createSupabaseServiceRoleClient();
  const authRedirectUrl = resolveAuthRedirectUrl(request);

  const { data: existingProfile, error: profileError } = await serviceRoleClient
    .from("profiles")
    .select("id, email")
    .eq("id", personId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to validate target user."
      },
      meta: buildMeta()
    });
  }

  if (!existingProfile?.id || typeof existingProfile.email !== "string" || existingProfile.email.length === 0) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "User was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const { error: resetError } = await serviceRoleClient.auth.resetPasswordForEmail(
    existingProfile.email,
    {
      redirectTo: authRedirectUrl
    }
  );

  if (resetError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PASSWORD_RESET_FAILED",
        message: "Unable to send a password setup link for this user."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: personId,
    newValue: {
      resetLinkInitiated: true,
      resetBy: session.profile.id
    }
  });

  return jsonResponse<PeoplePasswordResetResponseData>(200, {
    data: {
      userId: personId,
      resetInitiated: true
    },
    error: null,
    meta: buildMeta()
  });
}
