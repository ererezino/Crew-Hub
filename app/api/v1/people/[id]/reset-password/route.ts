import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../../../lib/auth/auth-mutation-guard";
import { deriveSystemPassword } from "../../../../../../lib/auth/system-password";
import { logAudit } from "../../../../../../lib/audit";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function resolveAppUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    requestUrl.origin;
  return appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
}

function resolveAuthRedirectUrl(request: Request): string {
  const appUrl = resolveAppUrl(request);
  return `${appUrl}/api/auth/callback?next=/mfa-setup`;
}

function buildRecoveryCallbackLink(request: Request, hashedToken: string): string {
  const appUrl = resolveAppUrl(request);
  const callbackUrl = new URL("/api/auth/callback", appUrl);
  callbackUrl.searchParams.set("token_hash", hashedToken);
  callbackUrl.searchParams.set("type", "recovery");
  callbackUrl.searchParams.set("next", "/mfa-setup");
  return callbackUrl.toString();
}

type MfaResetResponseData = {
  userId: string;
  resetInitiated: boolean;
  setupLink: string;
};

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
        message: "You must be logged in to reset authenticator access."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can reset authenticator access."
      },
      meta: buildMeta()
    });
  }

  const authMutationBlockReason = getAuthMutationBlockReason();
  if (authMutationBlockReason) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "AUTH_MUTATION_BLOCKED",
        message: authMutationBlockReason
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
  const adminClient = createSupabaseServiceRoleClient();

  const { data: existingProfile, error: profileError } = await adminClient
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

  /* ── Remove all existing TOTP factors ── */

  const { data: factorsData, error: factorsError } =
    await adminClient.auth.admin.mfa.listFactors({ userId: personId });

  if (factorsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "MFA_LIST_FAILED",
        message: "Unable to retrieve MFA factors for this user."
      },
      meta: buildMeta()
    });
  }

  const totpFactors = (factorsData?.factors ?? []).filter(
    (f) => f.factor_type === "totp"
  );

  for (const factor of totpFactors) {
    const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: personId
    });

    if (deleteError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "MFA_DELETE_FAILED",
          message: "Unable to remove existing authenticator factor."
        },
        meta: buildMeta()
      });
    }
  }

  /* ── Re-set the system password ── */

  const { error: passwordError } = await adminClient.auth.admin.updateUserById(
    personId,
    { password: deriveSystemPassword(personId) }
  );

  if (passwordError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PASSWORD_RESET_FAILED",
        message: "Unable to re-set system password for this user."
      },
      meta: buildMeta()
    });
  }

  /* ── Clear account_setup_at so the user goes through setup again ── */

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({ account_setup_at: null })
    .eq("id", personId);

  if (profileUpdateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to reset account setup status."
      },
      meta: buildMeta()
    });
  }

  /* ── Generate a recovery link pointing to /mfa-setup ── */

  const authRedirectUrl = resolveAuthRedirectUrl(request);

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email: existingProfile.email,
    options: { redirectTo: authRedirectUrl }
  });

  if (linkError || !linkData?.properties) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "MFA_RESET_LINK_FAILED",
        message: "Unable to generate an MFA setup link for this user."
      },
      meta: buildMeta()
    });
  }

  const setupLink = typeof linkData.properties.hashed_token === "string" && linkData.properties.hashed_token.length > 0
    ? buildRecoveryCallbackLink(request, linkData.properties.hashed_token)
    : linkData.properties.action_link;

  if (!setupLink) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "MFA_RESET_LINK_FAILED",
        message: "Unable to generate an MFA setup link for this user."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: personId,
    newValue: {
      mfaResetInitiated: true,
      factorsRemoved: totpFactors.length,
      resetBy: session.profile.id
    }
  });

  return jsonResponse<MfaResetResponseData>(200, {
    data: {
      userId: personId,
      resetInitiated: true,
      setupLink
    },
    error: null,
    meta: buildMeta()
  });
}
