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
  first_login_at: string | null;
};

export type AuthenticatedSession = {
  userId: string;
  profile: SessionProfile | null;
  org: SessionOrg | null;
};

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
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

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, org_id, email, full_name, avatar_url, department, phone, notification_preferences, roles, manager_id, country_code, status, first_login_at"
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
    status: profileData.status,
    first_login_at: profileData.first_login_at ?? null
  };

  // Stamp first_login_at on first ever login
  if (!profileData.first_login_at) {
    void supabase
      .from("profiles")
      .update({ first_login_at: new Date().toISOString() })
      .eq("id", profileData.id)
      .then();
    profile.first_login_at = new Date().toISOString();
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
