import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  fetchAdminCompensationEmployees,
  fetchCompensationSnapshot
} from "../../../../../lib/compensation-store";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { AdminCompensationResponseData } from "../../../../../types/compensation";

const querySchema = z.object({
  employeeId: z.string().uuid().optional()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewOrgCompensation(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view compensation admin data."
      },
      meta: buildMeta()
    });
  }

  if (!canViewOrgCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view compensation admin data."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid compensation query parameters."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  try {
    const employees = await fetchAdminCompensationEmployees({
      supabase,
      orgId: session.profile.org_id
    });

    const selectedEmployeeId =
      parsedQuery.data.employeeId ?? employees[0]?.id ?? null;

    let selectedSnapshot = null;

    if (selectedEmployeeId) {
      selectedSnapshot = await fetchCompensationSnapshot({
        supabase,
        orgId: session.profile.org_id,
        employeeId: selectedEmployeeId
      });
    }

    const response: AdminCompensationResponseData = {
      employees,
      selectedEmployee: selectedSnapshot?.employee ?? null,
      salaryRecords: selectedSnapshot?.salaryRecords ?? [],
      allowances: selectedSnapshot?.allowances ?? [],
      equityGrants: selectedSnapshot?.equityGrants ?? []
    };

    return jsonResponse<AdminCompensationResponseData>(200, {
      data: response,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_ADMIN_FETCH_FAILED",
        message:
          error instanceof Error ? error.message : "Unable to load compensation admin data."
      },
      meta: buildMeta()
    });
  }
}
