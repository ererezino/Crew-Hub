import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse, MeOrg, MeProfile, MeResponseData } from "../../../../types/auth";

const meProfileSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  avatar_url: z.string().nullable(),
  roles: z.array(z.string()),
  payroll_mode: z.string(),
  primary_currency: z.string().length(3),
  employment_type: z.enum(["full_time", "part_time", "contractor"]),
  status: z.enum(["active", "inactive", "onboarding", "offboarding"]),
  country_code: z.string().length(2).nullable(),
  timezone: z.string().nullable()
});

const meOrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logo_url: z.string().nullable()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function internalError(message: string) {
  return jsonResponse<null>(500, {
    data: null,
    error: {
      code: "INTERNAL_ERROR",
      message
    },
    meta: buildMeta()
  });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view profile information."
      },
      meta: buildMeta()
    });
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, org_id, email, full_name, avatar_url, roles, payroll_mode, primary_currency, employment_type, status, country_code, timezone"
    )
    .eq("id", user.id)
    .is("deleted_at", null)
    .single();

  if (profileError || !profileData) {
    const isProfileMissing = profileError?.code === "PGRST116";

    return jsonResponse<null>(isProfileMissing ? 404 : 500, {
      data: null,
      error: {
        code: isProfileMissing ? "NOT_FOUND" : "PROFILE_FETCH_FAILED",
        message: isProfileMissing
          ? "Profile not found for the current user."
          : "Unable to fetch profile information."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = meProfileSchema.safeParse(profileData);

  if (!parsedProfile.success) {
    return internalError("Profile data validation failed.");
  }

  const profile: MeProfile = parsedProfile.data;

  const { data: orgData, error: orgError } = await supabase
    .from("orgs")
    .select("id, name, logo_url")
    .eq("id", profile.org_id)
    .single();

  if (orgError || !orgData) {
    const isOrgMissing = orgError?.code === "PGRST116";

    return jsonResponse<null>(isOrgMissing ? 404 : 500, {
      data: null,
      error: {
        code: isOrgMissing ? "NOT_FOUND" : "ORG_FETCH_FAILED",
        message: isOrgMissing
          ? "Organization not found for the current user."
          : "Unable to fetch organization information."
      },
      meta: buildMeta()
    });
  }

  const parsedOrg = meOrgSchema.safeParse(orgData);

  if (!parsedOrg.success) {
    return internalError("Organization data validation failed.");
  }

  const org: MeOrg = parsedOrg.data;

  return jsonResponse<MeResponseData>(200, {
    data: {
      profile,
      org
    },
    error: null,
    meta: buildMeta()
  });
}
