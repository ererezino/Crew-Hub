import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../../../lib/auth/auth-mutation-guard";
import { logAudit } from "../../../../../../lib/audit";
import { logger } from "../../../../../../lib/logger";
import { sendWelcomeEmail } from "../../../../../../lib/notifications/email";
import { deriveSystemPassword } from "../../../../../../lib/auth/system-password";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

type InviteResponseData = {
  personId: string;
  email: string;
  inviteSent: boolean;
  isResend: boolean;
  inviteLink: string | null;
};

type SupportedInviteLinkType = "invite" | "recovery" | "magiclink";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function normalizeConfiguredAppUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function resolveAppUrl(request: Request): string {
  /* Derive origin from the incoming request so links work in any environment */
  const requestOrigin = new URL(request.url).origin;
  const configuredAppUrl = normalizeConfiguredAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  return configuredAppUrl ?? requestOrigin;
}

function resolveAuthRedirectUrl(request: Request): string {
  const appUrl = resolveAppUrl(request);
  return `${appUrl}/api/auth/callback?next=/mfa-setup`;
}

function buildSetupLink({
  request,
  type,
  hashedToken,
  actionLink
}: {
  request: Request;
  type: SupportedInviteLinkType;
  hashedToken?: string | null;
  actionLink?: string | null;
}): string | null {
  if (typeof hashedToken === "string" && hashedToken.length > 0) {
    const appUrl = resolveAppUrl(request);
    const callbackUrl = new URL("/api/auth/callback", appUrl);
    callbackUrl.searchParams.set("token_hash", hashedToken);
    callbackUrl.searchParams.set("type", type);
    callbackUrl.searchParams.set("next", "/mfa-setup");
    return callbackUrl.toString();
  }

  return actionLink ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedSession();

    if (!session?.profile) {
      return jsonResponse<null>(401, {
        data: null,
        error: {
          code: "UNAUTHORIZED",
          message: "You must be logged in to send invites."
        },
        meta: buildMeta()
      });
    }

    const canInvite =
      hasRole(session.profile.roles, "SUPER_ADMIN") ||
      hasRole(session.profile.roles, "HR_ADMIN");

    if (!canInvite) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Only Super Admin and HR Admin can send invites."
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
    const serviceRoleClient = createSupabaseServiceRoleClient();

    /* Look up the profile to get the email */
    const { data: profile, error: profileError } = await serviceRoleClient
      .from("profiles")
      .select("id, email, full_name, status")
      .eq("id", personId)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (profileError || !profile) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Person not found in this organization."
        },
        meta: buildMeta()
      });
    }

  const email = typeof profile.email === "string" ? profile.email.trim() : "";
  if (email.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_EMAIL",
        message: "This person does not have a valid email address."
      },
      meta: buildMeta()
    });
  }

  const fullName =
    typeof profile.full_name === "string" && profile.full_name.trim().length > 0
      ? profile.full_name.trim()
      : "Crew member";
  const appUrl = resolveAppUrl(request);
  const authRedirectUrl = resolveAuthRedirectUrl(request);

  /* Check if an auth user already exists (profile id = auth user id) */
  let isResend = false;
  let inviteLink: string | null = null;

  const {
    data: existingAuthUser,
    error: existingAuthUserError
  } = await serviceRoleClient.auth.admin.getUserById(personId);

  if (existingAuthUserError && !/user/i.test(existingAuthUserError.message)) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "AUTH_LOOKUP_FAILED",
        message: "Unable to verify existing account state. Please try again."
      },
      meta: buildMeta()
    });
  }

  if (existingAuthUser?.user) {
    isResend = true;
  }

  /* Ensure the user's password is set to the system-derived value.
     This is required for the email + TOTP login flow to work. */
  if (existingAuthUser?.user) {
    let systemPassword = "";
    try {
      systemPassword = deriveSystemPassword(personId);
    } catch {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "AUTH_CONFIG_ERROR",
          message: "Authentication system is not fully configured. Contact your admin."
        },
        meta: buildMeta()
      });
    }

    await serviceRoleClient.auth.admin
      .updateUserById(personId, { password: systemPassword })
      .catch(() => undefined);
  }

  /*
   * Strategy:
   *   1. Use generateLink to create a usable link (invite for new, recovery for existing).
   *      generateLink always returns the link even if the email provider isn't configured.
   *   2. Try to send the Supabase invite email (fire-and-forget, may silently fail).
   *   3. Send our own welcome email (fire-and-forget).
   *   4. Return the invite link so the admin can copy & share it manually if needed.
   */

  if (isResend) {
    /* Existing auth user — generate a recovery (password reset) link */
    const { data: linkData, error: linkError } = await serviceRoleClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: authRedirectUrl }
    });

    if (linkError || !linkData?.properties) {
      /* Fallback: try magic link */
      const { data: magicData, error: magicError } = await serviceRoleClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: authRedirectUrl }
      });

      if (magicError || !magicData?.properties) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "INVITE_RESEND_FAILED",
            message: "Unable to generate invite link. Please try again."
          },
          meta: buildMeta()
        });
      }

      inviteLink = buildSetupLink({
        request,
        type: "magiclink",
        hashedToken: magicData.properties.hashed_token,
        actionLink: magicData.properties.action_link
      });
    } else {
      inviteLink = buildSetupLink({
        request,
        type: "recovery",
        hashedToken: linkData.properties.hashed_token,
        actionLink: linkData.properties.action_link
      });
    }

    /* Also try the standard invite email (may silently fail if email not configured) */
    serviceRoleClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: authRedirectUrl
    }).catch(() => {
      /* Swallow — the manual link is the reliable path */
    });
  } else {
    /* No auth account — generate an invite link (creates the auth user + generates link) */
    const { data: linkData, error: linkError } = await serviceRoleClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { full_name: fullName },
        redirectTo: authRedirectUrl
      }
    });

    if (linkError || !linkData?.properties) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "INVITE_FAILED",
          message: linkError?.message || "Unable to generate invite link."
        },
        meta: buildMeta()
      });
    }

    inviteLink = buildSetupLink({
      request,
      type: "invite",
      hashedToken: linkData.properties.hashed_token,
      actionLink: linkData.properties.action_link
    });

    /* Also fire the standard Supabase invite email so the user receives
       a message in their inbox.  generateLink only creates the link —
       it doesn't send anything. */
    serviceRoleClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: authRedirectUrl
    }).catch(() => {
      /* Swallow — the manual link is the reliable fallback */
    });
  }

  /* Send welcome email (fire-and-forget) */
  sendWelcomeEmail({
    recipientEmail: email,
    recipientName: fullName,
    loginUrl: `${appUrl}/login`,
    setupLink: inviteLink ?? undefined
  }).catch((error) => {
    logger.error("Failed to send welcome email during invite.", {
      personId,
      message: error instanceof Error ? error.message : String(error)
    });
  });

    try {
      await logAudit({
        action: "updated",
        tableName: "profiles",
        recordId: personId,
        newValue: {
          email,
          fullName,
          isResend,
          invitedBy: session.profile.id
        }
      });
    } catch (error) {
      logger.error("Failed to record invite audit log.", {
        personId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return jsonResponse<InviteResponseData>(200, {
      data: {
        personId,
        email,
        inviteSent: true,
        isResend,
        inviteLink
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    logger.error("Invite request failed unexpectedly.", {
      path: request.url,
      message: error instanceof Error ? error.message : String(error)
    });

    const detail = error instanceof Error ? error.message : "Unknown error";

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INVITE_REQUEST_FAILED",
        message: `Unable to send invite. ${detail}`
      },
      meta: buildMeta()
    });
  }
}
