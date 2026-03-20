/**
 * API-route access check using navigation_access_config as the single source of truth.
 *
 * This is the API-layer counterpart to check-page-access.ts. It ensures that
 * backing data APIs respect the same configurable access model as page-level gates.
 *
 * Use this for READ endpoints that should respect per-person overrides.
 * Write/mutate endpoints should remain intentionally hard-gated.
 *
 * Unlike the page-level utility, this does NOT use React cache() since API
 * routes don't have React's per-request cache scope.
 */

import "server-only";

import {
  getDefaultVisibleRolesForNavItem,
  isNavItemVisibleForUser,
  sanitizeRoles
} from "../access-control";
import { logger } from "../logger";
import type { UserRole } from "../navigation";
import { hasRole } from "../roles";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import type { SessionProfile } from "./session";

type NavAccessRow = {
  nav_item_key: string;
  visible_to_roles: string[];
  granted_employee_ids: string[] | null;
  revoked_employee_ids: string[] | null;
};

/**
 * Check if a user has access to a configurable surface via navigation_access_config.
 *
 * Evaluates:
 * - SUPER_ADMIN always allowed
 * - visible_to_roles for role-level access
 * - granted_employee_ids for per-person grants
 * - revoked_employee_ids for per-person revokes (takes precedence)
 * - Falls back to default role-based access only if no config row exists
 * - Denies access if the config lookup itself fails
 */
export async function checkApiAccess(
  navItemKey: string,
  profile: SessionProfile
): Promise<boolean> {
  if (hasRole(profile.roles, "SUPER_ADMIN")) {
    return true;
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("navigation_access_config")
    .select(
      "nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids"
    )
    .eq("org_id", profile.org_id)
    .eq("nav_item_key", navItemKey)
    .maybeSingle();

  if (error) {
    logger.warn("Access config lookup failed for API access.", {
      navItemKey,
      orgId: profile.org_id,
      userId: profile.id,
      message: error.message
    });
    return false;
  }

  const row = data as NavAccessRow | null;

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
