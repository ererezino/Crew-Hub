import "server-only";

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
    .select("id, org_id, email, full_name, roles, manager_id, country_code, status")
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
    roles,
    manager_id: profileData.manager_id,
    country_code: profileData.country_code,
    status: profileData.status
  };

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

  return {
    userId: user.id,
    profile,
    org: orgData
  };
}
