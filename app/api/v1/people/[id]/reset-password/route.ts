import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { generateStrongPassword } from "../../../../../../lib/auth/generate-password";
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

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to reset user passwords."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can reset user passwords."
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

  const { data: existingProfile, error: profileError } = await serviceRoleClient
    .from("profiles")
    .select("id")
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

  if (!existingProfile?.id) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "User was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const temporaryPassword = generateStrongPassword();

  const { error: resetError } = await serviceRoleClient.auth.admin.updateUserById(personId, {
    password: temporaryPassword
  });

  if (resetError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PASSWORD_RESET_FAILED",
        message: "Unable to reset password for this user."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: personId,
    newValue: {
      passwordReset: true,
      resetBy: session.profile.id
    }
  });

  return jsonResponse<PeoplePasswordResetResponseData>(200, {
    data: {
      userId: personId,
      temporaryPassword
    },
    error: null,
    meta: buildMeta()
  });
}
