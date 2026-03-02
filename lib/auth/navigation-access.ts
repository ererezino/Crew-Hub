import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAllNavigationItemKeys,
  getDefaultVisibleRolesForNavItem
} from "../access-control";
import type { UserRole } from "../navigation";
import {
  normalizeAccessOverrides,
  normalizeNavItemKeyList,
  resolveDefaultAccessForRoles,
  type AccessOverrides
} from "./default-role-access";

type NavigationConfigRow = {
  id: string;
  nav_item_key: string;
  granted_employee_ids: string[] | null;
  revoked_employee_ids: string[] | null;
};

type ApplyUserNavigationAccessParams = {
  supabase: SupabaseClient;
  orgId: string;
  employeeId: string;
  actorUserId: string;
  roles: readonly UserRole[];
  overrides?: AccessOverrides | unknown;
};

type ApplyUserNavigationAccessResult = {
  grantedNavItemKeys: string[];
  revokedNavItemKeys: string[];
  changedNavItemKeys: string[];
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeIds(values: readonly string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }

  return uniqueStrings(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  ).sort((left, right) => left.localeCompare(right));
}

function areArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function ensureKnownNavKeys(values: readonly string[], knownKeys: ReadonlySet<string>): string[] {
  return normalizeNavItemKeyList(values).filter((value) => knownKeys.has(value));
}

export function resolveEffectiveUserNavSelection({
  roles,
  overrides
}: {
  roles: readonly UserRole[];
  overrides?: AccessOverrides | unknown;
}): {
  granted: string[];
  revoked: string[];
} {
  const knownNavKeys = new Set(getAllNavigationItemKeys());
  const normalizedOverrides = normalizeAccessOverrides(overrides);

  if (roles.includes("SUPER_ADMIN")) {
    return { granted: [], revoked: [] };
  }

  const defaultAccess = ensureKnownNavKeys(resolveDefaultAccessForRoles(roles), knownNavKeys);
  const grantedOverrides = ensureKnownNavKeys(normalizedOverrides.granted, knownNavKeys);
  const revokedOverrides = ensureKnownNavKeys(normalizedOverrides.revoked, knownNavKeys);

  return {
    granted: uniqueStrings([...defaultAccess, ...grantedOverrides]).sort((left, right) =>
      left.localeCompare(right)
    ),
    revoked: revokedOverrides.sort((left, right) => left.localeCompare(right))
  };
}

export async function applyUserNavigationAccess({
  supabase,
  orgId,
  employeeId,
  actorUserId,
  roles,
  overrides
}: ApplyUserNavigationAccessParams): Promise<ApplyUserNavigationAccessResult> {
  const allNavItemKeys = getAllNavigationItemKeys().sort((left, right) => left.localeCompare(right));
  const allNavItemKeySet = new Set(allNavItemKeys);

  const { granted: effectiveGrantedKeys, revoked: effectiveRevokedKeys } =
    resolveEffectiveUserNavSelection({
      roles,
      overrides
    });

  const [{ data: existingRows, error: fetchError }] = await Promise.all([
    supabase
      .from("navigation_access_config")
      .select("id, nav_item_key, granted_employee_ids, revoked_employee_ids")
      .eq("org_id", orgId)
  ]);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const existingByKey = new Map<string, NavigationConfigRow>();

  for (const row of (existingRows ?? []) as NavigationConfigRow[]) {
    if (typeof row.nav_item_key === "string" && allNavItemKeySet.has(row.nav_item_key)) {
      existingByKey.set(row.nav_item_key, row);
    }
  }

  const missingKeys = allNavItemKeys.filter((key) => !existingByKey.has(key));

  if (missingKeys.length > 0) {
    const { error: insertError } = await supabase.from("navigation_access_config").insert(
      missingKeys.map((navItemKey) => ({
        org_id: orgId,
        nav_item_key: navItemKey,
        visible_to_roles: getDefaultVisibleRolesForNavItem(navItemKey),
        granted_employee_ids: [],
        revoked_employee_ids: [],
        updated_by: actorUserId
      }))
    );

    if (insertError) {
      throw new Error(insertError.message);
    }

    const { data: insertedRows, error: refetchError } = await supabase
      .from("navigation_access_config")
      .select("id, nav_item_key, granted_employee_ids, revoked_employee_ids")
      .eq("org_id", orgId)
      .in("nav_item_key", missingKeys);

    if (refetchError) {
      throw new Error(refetchError.message);
    }

    for (const row of (insertedRows ?? []) as NavigationConfigRow[]) {
      if (typeof row.nav_item_key === "string") {
        existingByKey.set(row.nav_item_key, row);
      }
    }
  }

  const shouldGrant = new Set(effectiveGrantedKeys);
  const shouldRevoke = new Set(effectiveRevokedKeys);
  const changedNavItemKeys: string[] = [];

  await Promise.all(
    allNavItemKeys.map(async (navItemKey) => {
      const row = existingByKey.get(navItemKey);

      if (!row) {
        return;
      }

      const currentGrantedIds = normalizeIds(row.granted_employee_ids);
      const currentRevokedIds = normalizeIds(row.revoked_employee_ids);
      const nextGrantedIds = new Set(currentGrantedIds);
      const nextRevokedIds = new Set(currentRevokedIds);

      if (shouldGrant.has(navItemKey)) {
        nextGrantedIds.add(employeeId);
      } else {
        nextGrantedIds.delete(employeeId);
      }

      if (shouldRevoke.has(navItemKey)) {
        nextRevokedIds.add(employeeId);
      } else {
        nextRevokedIds.delete(employeeId);
      }

      const nextGrantedArray = [...nextGrantedIds].sort((left, right) => left.localeCompare(right));
      const nextRevokedArray = [...nextRevokedIds].sort((left, right) => left.localeCompare(right));

      if (
        areArraysEqual(currentGrantedIds, nextGrantedArray) &&
        areArraysEqual(currentRevokedIds, nextRevokedArray)
      ) {
        return;
      }

      const { error: updateError } = await supabase
        .from("navigation_access_config")
        .update({
          granted_employee_ids: nextGrantedArray,
          revoked_employee_ids: nextRevokedArray,
          updated_by: actorUserId
        })
        .eq("id", row.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      changedNavItemKeys.push(navItemKey);
    })
  );

  return {
    grantedNavItemKeys: effectiveGrantedKeys,
    revokedNavItemKeys: effectiveRevokedKeys,
    changedNavItemKeys: changedNavItemKeys.sort((left, right) => left.localeCompare(right))
  };
}
