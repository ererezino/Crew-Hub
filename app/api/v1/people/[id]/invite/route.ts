import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
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

const supportedInviteLinkTypes = ["invite", "recovery", "magiclink"] as const;
type SupportedInviteLinkType = (typeof supportedInviteLinkTypes)[number];

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function resolveAppUrl(request: Request): string {
  /* Derive origin from the incoming request so links work in any environment */
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

  const email = profile.email as string;
  const fullName = profile.full_name as string;
  const appUrl = resolveAppUrl(request);
  const authRedirectUrl = resolveAuthRedirectUrl(request);

  /* Check if an auth user already exists (profile id = auth user id) */
  let isResend = false;
  let inviteLink: string | null = null;

  const { data: existingAuthUser } = await serviceRoleClient.auth.admin.getUserById(personId);

  if (existingAuthUser?.user) {
    isResend = true;
  }

  /* Ensure the user's password is set to the system-derived value.
     This is required for the email + TOTP login flow to work. */
  if (existingAuthUser?.user) {
    const systemPassword = deriveSystemPassword(personId);
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
}
