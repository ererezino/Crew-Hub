/**
 * Server-side page access check using navigation_access_config as the single source of truth.
 *
 * This utility replaces hardcoded hasRole() checks on configurable pages.
 * It evaluates visibility using the same navigation_access_config table that
 * controls sidebar visibility, ensuring page-level and nav-level access are
 * always in sync.
 *
 * Hard-gated pages (security boundaries like /admin/access-control) should
 * continue using direct hasRole() checks and NOT use this utility.
 */

import { cache } from "react";

import {
  getDefaultVisibleRolesForNavItem,
  isNavItemVisibleForUser,
  sanitizeRoles
} from "../access-control";
import type { UserRole } from "../navigation";
import { hasRole } from "../roles";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import { getAuthenticatedSession, type SessionProfile } from "./session";

type NavAccessRow = {
  nav_item_key: string;
  visible_to_roles: string[];
  granted_employee_ids: string[] | null;
  revoked_employee_ids: string[] | null;
};

type PageAccessResult = {
  allowed: boolean;
  profile: SessionProfile | null;
};

/**
 * Fetch all navigation_access_config rows for an org.
 * Cached per-request via React cache() to avoid duplicate DB queries
 * when multiple page components check access in the same render.
 */
const fetchNavAccessConfig = cache(
  async (orgId: string): Promise<NavAccessRow[]> => {
    const supabase = createSupabaseServiceRoleClient();

    const { data, error } = await supabase
      .from("navigation_access_config")
      .select(
        "nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids"
      )
      .eq("org_id", orgId);

    if (error || !data) {
      return [];
    }

    return data as NavAccessRow[];
  }
);

/**
 * Check if the current user has access to a configurable page.
 *
 * Uses navigation_access_config as the source of truth:
 * - Checks visible_to_roles for role-level access
 * - Checks granted_employee_ids for per-person grants
 * - Checks revoked_employee_ids for per-person revokes (takes precedence)
 * - SUPER_ADMIN always has access
 *
 * Falls back to default role-based access if no config rows exist.
 */
export async function checkPageAccess(
  navItemKey: string
): Promise<PageAccessResult> {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return { allowed: false, profile: null };
  }

  const profile = session.profile;

  // SUPER_ADMIN always has access
  if (hasRole(profile.roles, "SUPER_ADMIN")) {
    return { allowed: true, profile };
  }

  const rows = await fetchNavAccessConfig(profile.org_id);
  const row = rows.find((r) => r.nav_item_key === navItemKey);

  const visibleToRoles: UserRole[] = row
    ? sanitizeRoles(row.visible_to_roles)
    : getDefaultVisibleRolesForNavItem(navItemKey);

  const allowed = isNavItemVisibleForUser({
    userId: profile.id,
    userRoles: profile.roles,
    visibleToRoles,
    grantedEmployeeIds: row?.granted_employee_ids ?? [],
    revokedEmployeeIds: row?.revoked_employee_ids ?? []
  });

  return { allowed, profile };
}

/**
 * Check if a given profile has access to a configurable page.
 * Use this when you already have a session profile and don't want to
 * re-fetch it.
 */
export async function checkPageAccessForProfile(
  navItemKey: string,
  profile: SessionProfile
): Promise<boolean> {
  if (hasRole(profile.roles, "SUPER_ADMIN")) {
    return true;
  }

  const rows = await fetchNavAccessConfig(profile.org_id);
  const row = rows.find((r) => r.nav_item_key === navItemKey);

  const visibleToRoles: UserRole[] = row
    ? sanitizeRoles(row.visible_to_roles)
    : getDefaultVisibleRolesForNavItem(navItemKey);

  return isNavItemVisibleForUser({
    userId: profile.id,
    userRoles: profile.roles,
    visibleToRoles,
    grantedEmployeeIds: row?.granted_employee_ids ?? [],
    revokedEmployeeIds: row?.revoked_employee_ids ?? []
  });
}
