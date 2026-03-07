import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import {
  getAtRiskOnboardings,
  type AtRiskOnboardingsResponseData
} from "../../../../../lib/onboarding/risk-detection";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const sessionProfileSchema = z.object({
  org_id: z.string().uuid("Session organization id is invalid.")
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewAtRisk(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view at-risk onboarding data."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = sessionProfileSchema.safeParse(session.profile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SESSION_INVALID",
        message: parsedProfile.error.issues[0]?.message ?? "Invalid session profile."
      },
      meta: buildMeta()
    });
  }

  if (!canViewAtRisk(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can view at-risk onboarding data."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  try {
    const instances = await getAtRiskOnboardings(supabase, parsedProfile.data.org_id);

    return jsonResponse<AtRiskOnboardingsResponseData>(200, {
      data: { instances },
      error: null,
      meta: buildMeta()
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "AT_RISK_FETCH_FAILED",
        message: "Unable to load at-risk onboarding instances."
      },
      meta: buildMeta()
    });
  }
}
