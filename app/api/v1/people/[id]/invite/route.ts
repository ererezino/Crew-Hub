import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../../../lib/auth/auth-mutation-guard";
import { logAudit } from "../../../../../../lib/audit";
import { logger } from "../../../../../../lib/logger";
import { deriveSystemPassword } from "../../../../../../lib/auth/system-password";
import { hasRole } from "../../../../../../lib/roles";
import { sendWelcomeEmail } from "../../../../../../lib/notifications/email";
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
type InviteGenerateLinkOptions = {
  data?: Record<string, unknown>;
  redirectTo?: string;
};
type InviteGenerateLinkRequest =
  | {
      type: "invite" | "magiclink";
      emailAddress: string;
      options?: InviteGenerateLinkOptions;
    }
  | {
      type: "recovery";
      emailAddress: string;
      options?: Pick<InviteGenerateLinkOptions, "redirectTo">;
    };

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

function isRedirectConfigurationError(message: string | undefined): boolean {
  if (!message) return false;
  return /(redirect|redirect_to|site url|url.*allow|allow.*url)/i.test(message);
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

    const generateLinkWithRedirectFallback = async ({
      type,
      emailAddress,
      options
    }: InviteGenerateLinkRequest) => {
      const primaryParams =
        type === "recovery"
          ? {
              type,
              email: emailAddress,
              options: options?.redirectTo
                ? { redirectTo: options.redirectTo }
                : undefined
            }
          : {
              type,
              email: emailAddress,
              options
            };

      const { data, error } = await serviceRoleClient.auth.admin.generateLink(
        primaryParams as never
      );

      if (!error && data?.properties) {
        return { data, error: null };
      }

      const primaryErrorMessage = error?.message;
      if (
        !options?.redirectTo ||
        !isRedirectConfigurationError(primaryErrorMessage)
      ) {
        return { data, error };
      }

      const fallbackParams =
        type === "recovery"
          ? { type, email: emailAddress }
          : options?.data
            ? {
                type,
                email: emailAddress,
                options: { data: options.data }
              }
            : { type, email: emailAddress };

      const fallback = await serviceRoleClient.auth.admin.generateLink(
        fallbackParams as never
      );

      if (!fallback.error && fallback.data?.properties) {
        logger.warn("Recovered invite link generation without redirect URL.", {
          personId,
          email: emailAddress,
          type,
          redirectTo: options.redirectTo
        });
        return { data: fallback.data, error: null };
      }

      return { data, error };
    };

    /* Check if an auth user already exists (profile id = auth user id) */
    let isResend = false;
    let inviteLink: string | null = null;
    let emailSent = false;

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
       These failures are BLOCKING because the user cannot sign in without
       a correctly synced system password, and the self-heal at sign-in
       relies on the same infrastructure (secret + Supabase Admin API). */
    if (existingAuthUser?.user) {
      let systemPassword: string;
      try {
        systemPassword = deriveSystemPassword(personId);
      } catch (error) {
        logger.error("Auth system secret is unavailable — cannot sync password for invite.", {
          personId,
          message: error instanceof Error ? error.message : String(error)
        });
        return jsonResponse<null>(503, {
          data: null,
          error: {
            code: "AUTH_SYSTEM_UNAVAILABLE",
            message: "Auth system is temporarily unavailable. The invite was not sent. Please try again later."
          },
          meta: buildMeta()
        });
      }

      const { error: passwordSyncError } = await serviceRoleClient.auth.admin
        .updateUserById(personId, { password: systemPassword });

      if (passwordSyncError) {
        logger.error("Password sync failed during invite — user may not be able to sign in.", {
          personId,
          message: passwordSyncError.message
        });
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PASSWORD_SYNC_FAILED",
            message: "Unable to sync account credentials. The invite was not sent. Please try again."
          },
          meta: buildMeta()
        });
      }
    }

    /*
     * Strategy:
     *   1. Use generateLink to create a usable link (invite for new, recovery for existing).
     *      generateLink always returns the link even if the email provider isn't configured.
     *   2. If redirect URL configuration is stale, retry without redirectTo.
     *   3. Try to send the Supabase invite email (fire-and-forget, may silently fail).
     *   4. Return the invite link so the admin can copy & share it manually if needed.
     */

    if (isResend) {
      /* Existing auth user — generate a recovery (password reset) link */
      const { data: linkData, error: linkError } = await generateLinkWithRedirectFallback({
        type: "recovery",
        emailAddress: email,
        options: { redirectTo: authRedirectUrl }
      });

      if (linkError || !linkData?.properties) {
        /* Fallback: try magic link */
        const { data: magicData, error: magicError } = await generateLinkWithRedirectFallback({
          type: "magiclink",
          emailAddress: email,
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

      /* Send branded welcome email with setup link.
         Awaited so we can surface delivery failure to the admin. */
      try {
        await sendWelcomeEmail({
          recipientEmail: email,
          recipientName: fullName,
          setupLink: inviteLink ?? undefined,
          isNewHire: profile.status === "onboarding"
        });
        emailSent = true;
      } catch (error) {
        logger.error("Failed to send welcome email on re-invite.", {
          personId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      /* No auth account — generate an invite link (creates the auth user + generates link) */
      const { data: linkData, error: linkError } = await generateLinkWithRedirectFallback({
        type: "invite",
        emailAddress: email,
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

      /* Send branded welcome email with setup link.
         Awaited so we can surface delivery failure to the admin. */
      try {
        await sendWelcomeEmail({
          recipientEmail: email,
          recipientName: fullName,
          setupLink: inviteLink ?? undefined,
          isNewHire: profile.status === "onboarding"
        });
        emailSent = true;
      } catch (error) {
        logger.error("Failed to send welcome email on invite.", {
          personId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

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

    /* Record the first invite timestamp (idempotent — only set once, not on re-invite). */
    try {
      await serviceRoleClient
        .from("profiles")
        .update({ first_invited_at: new Date().toISOString() })
        .eq("id", personId)
        .is("first_invited_at", null);
    } catch (error) {
      // Non-critical — don't fail the invite, but log for operator visibility.
      logger.error("Failed to set first_invited_at timestamp.", {
        personId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return jsonResponse<InviteResponseData>(200, {
      data: {
        personId,
        email,
        inviteSent: emailSent,
        isResend,
        inviteLink
      },
      error: emailSent
        ? null
        : {
            code: "EMAIL_DELIVERY_FAILED",
            message:
              "The invite was created and the link is valid, but the email could not be delivered. Please share the invite link with the user manually."
          },
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
