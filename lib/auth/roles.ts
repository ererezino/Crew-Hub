import { NextResponse } from "next/server";

import type { ApiResponse, AppRole, RoleAwareProfile } from "../../types/auth";

export function hasRole(
  profile: RoleAwareProfile | null | undefined,
  role: AppRole
): boolean {
  return Boolean(profile?.roles?.includes(role));
}

export function hasAnyRole(
  profile: RoleAwareProfile | null | undefined,
  roles: readonly AppRole[]
): boolean {
  return roles.some((role) => hasRole(profile, role));
}

export function requireRole(role: AppRole) {
  return (profile: RoleAwareProfile | null | undefined) => {
    if (hasRole(profile, role)) {
      return null;
    }

    const payload: ApiResponse<null> = {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: `Missing required role: ${role}`
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    };

    return NextResponse.json(payload, { status: 403 });
  };
}
