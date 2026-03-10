import "server-only";

import * as Sentry from "@sentry/nextjs";

import { normalizeUserRoles, type UserRole } from "../navigation";
import { createSupabaseServerClient } from "../supabase/server";

export type SessionOrg = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type SessionProfile = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  department: string | null;
  phone: string | null;
  notification_preferences: Record<string, unknown> | null;
  roles: UserRole[];
  manager_id: string | null;
  country_code: string | null;
  status: "active" | "inactive" | "onboarding" | "offboarding";
};

export type AuthenticatedSession = {
  userId: string;
  profile: SessionProfile | null;
  org: SessionOrg | null;
};

type GetAuthenticatedSessionOptions = {
  includeOrg?: boolean;
  requireMfa?: boolean;
};

export async function getAuthenticatedSession(
  options: GetAuthenticatedSessionOptions = {}
): Promise<AuthenticatedSession | null> {
  const includeOrg = options.includeOrg === true;
  const requireMfa = options.requireMfa !== false;
  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return null;
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  if (requireMfa) {
    const { data: factorsData, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError) {
      return null;
    }

    const verifiedFactors = (factorsData?.totp ?? []).filter(
      (factor) => factor.status === "verified"
    );

    if (verifiedFactors.length === 0) {
      return null;
    }

    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError || aalData?.currentLevel !== "aal2") {
      return null;
    }
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, org_id, email, full_name, avatar_url, department, phone, notification_preferences, roles, manager_id, country_code, status"
    )
    .eq("id", user.id)
    .is("deleted_at", null)
    .single();

  if (profileError || !profileData) {
    return {
      userId: user.id,
      profile: null,
      org: null
    };
  }

  const roles = normalizeUserRoles(profileData.roles);

  if (profileData.status === "inactive") {
    return null;
  }

  const profile: SessionProfile = {
    id: profileData.id,
    org_id: profileData.org_id,
    email: profileData.email,
    full_name: profileData.full_name,
    avatar_url: profileData.avatar_url,
    department: profileData.department,
    phone: profileData.phone,
    notification_preferences: profileData.notification_preferences,
    roles,
    manager_id: profileData.manager_id,
    country_code: profileData.country_code,
    status: profileData.status
  };

  if (!includeOrg) {
    return {
      userId: user.id,
      profile,
      org: null
    };
  }

  const { data: orgData, error: orgError } = await supabase
    .from("orgs")
    .select("id, name, logo_url")
    .eq("id", profile.org_id)
    .single();

  if (orgError || !orgData) {
    return {
      userId: user.id,
      profile,
      org: null
    };
  }

  // Set Sentry context with non-PII data for every authenticated request
  const highestRole = roles.length > 0 ? roles[0] : "EMPLOYEE";
  Sentry.setContext("crew_hub", {
    org_id: profile.org_id,
    user_role: highestRole
  });
  Sentry.setUser({ id: profile.id });

  return {
    userId: user.id,
    profile,
    org: orgData
  };
}
