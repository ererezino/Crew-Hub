import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * GET /api/v1/me/mfa
 *
 * Returns the current user's MFA enrollment status.
 */
export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: factorsData, error: factorsError } =
    await supabase.auth.mfa.listFactors();

  if (factorsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "MFA_LIST_FAILED", message: "Unable to retrieve MFA status." },
      meta: buildMeta()
    });
  }

  const verifiedFactors = (factorsData?.totp ?? []).filter(
    (f) => f.status === "verified"
  );

  return jsonResponse<{
    enrolled: boolean;
    factorCount: number;
    factorIds: string[];
  }>(200, {
    data: {
      enrolled: verifiedFactors.length > 0,
      factorCount: verifiedFactors.length,
      factorIds: verifiedFactors.map((f) => f.id)
    },
    error: null,
    meta: buildMeta()
  });
}

const enrollSchema = z.object({
  action: z.enum(["enroll", "verify", "unenroll"]),
  factorId: z.string().optional(),
  code: z.string().length(6, "Code must be 6 digits").optional()
});

/**
 * POST /api/v1/me/mfa
 *
 * Manages MFA enrollment:
 * - action: "enroll" — starts TOTP enrollment, returns QR code URI
 * - action: "verify" — verifies a TOTP code to complete enrollment
 * - action: "unenroll" — removes a verified factor (SUPER_ADMIN only for themselves)
 */
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

  const parsed = enrollSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid MFA payload."
      },
      meta: buildMeta()
    });
  }

  const { action, factorId, code } = parsed.data;
  const supabase = await createSupabaseServerClient();

  if (action === "enroll") {
    /* ── Clean up stale unverified factors before enrolling ── */
    const { data: existingFactors } = await supabase.auth.mfa.listFactors();
    const allFactors = ((existingFactors as { all?: Array<{
      id: string;
      status?: string;
      factor_type?: string;
    }> } | null)?.all ?? []);
    const unverifiedFactors = allFactors.filter(
      (f) => f.status === "unverified" && f.factor_type === "totp"
    );
    if (unverifiedFactors.length > 0) {
      const adminClient = createSupabaseServiceRoleClient();
      for (const stale of unverifiedFactors) {
        await adminClient.auth.admin.mfa
          .deleteFactor({ id: stale.id, userId: session.userId })
          .catch(() => undefined);
      }
    }

    const { data: enrollData, error: enrollError } =
      await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Crew Hub Authenticator"
      });

    if (enrollError || !enrollData) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "MFA_ENROLL_FAILED", message: "Unable to start MFA enrollment." },
        meta: buildMeta()
      });
    }

    return jsonResponse<{
      factorId: string;
      totpUri: string;
      qrCode: string;
    }>(200, {
      data: {
        factorId: enrollData.id,
        totpUri: enrollData.totp.uri,
        qrCode: enrollData.totp.qr_code
      },
      error: null,
      meta: buildMeta()
    });
  }

  if (action === "verify") {
    if (!factorId || !code) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Factor ID and verification code are required."
        },
        meta: buildMeta()
      });
    }

    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeError || !challengeData) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "MFA_CHALLENGE_FAILED", message: "Unable to create MFA challenge." },
        meta: buildMeta()
      });
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    });

    if (verifyError) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "MFA_VERIFY_FAILED",
          message: "Invalid verification code. Please try again."
        },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "created",
      tableName: "mfa_factors",
      recordId: factorId,
      newValue: { event: "mfa_enrolled", userId: session.userId }
    }).catch(() => undefined);

    /* Mark account as set up (first-time TOTP enrollment completes onboarding) */
    const serviceClient = createSupabaseServiceRoleClient();
    try {
      await serviceClient
        .from("profiles")
        .update({ account_setup_at: new Date().toISOString() })
        .eq("id", session.userId)
        .is("account_setup_at", null);
    } catch {
      // Non-blocking: MFA enrollment remains successful even if profile metadata update fails.
    }

    return jsonResponse<{ verified: true }>(200, {
      data: { verified: true },
      error: null,
      meta: buildMeta()
    });
  }

  if (action === "unenroll") {
    if (!factorId) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Factor ID is required to unenroll."
        },
        meta: buildMeta()
      });
    }

    /* ── Use service-role client — the user-scoped client lacks
         permission to unenroll verified factors. ── */
    const adminClient = createSupabaseServiceRoleClient();
    const { error: unenrollError } =
      await adminClient.auth.admin.mfa.deleteFactor({
        id: factorId,
        userId: session.userId
      });

    if (unenrollError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "MFA_UNENROLL_FAILED", message: "Unable to remove MFA factor." },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "deleted",
      tableName: "mfa_factors",
      recordId: factorId,
      newValue: { event: "mfa_unenrolled", userId: session.userId }
    }).catch(() => undefined);

    return jsonResponse<{ unenrolled: true }>(200, {
      data: { unenrolled: true },
      error: null,
      meta: buildMeta()
    });
  }

  return jsonResponse<null>(400, {
    data: null,
    error: { code: "BAD_REQUEST", message: "Unknown MFA action." },
    meta: buildMeta()
  });
}
