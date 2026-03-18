import { NextResponse } from "next/server";

import { fetchApprovalsCountsData, type ApprovalsCountsData } from "../../../../../lib/approvals/fetch-approvals-counts";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import type { ApiResponse } from "../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>, headers?: Record<string, string>) {
  return NextResponse.json(payload, { status, headers });
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view approvals counts."
      },
      meta: buildMeta()
    });
  }

  const { profile } = session;
  const roles = profile.roles;

  const canReview =
    hasRole(roles, "TEAM_LEAD") ||
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN");

  if (!canReview) {
    return jsonResponse<ApprovalsCountsData>(200, {
      data: {
        timeOff: 0,
        expenses: 0,
        managerExpenses: 0,
        additionalExpenses: 0,
        financeExpenses: 0,
        total: 0
      },
      error: null,
      meta: buildMeta()
    }, {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      "Vary": "Cookie"
    });
  }

  try {
    const data = await fetchApprovalsCountsData(profile);

    return jsonResponse<ApprovalsCountsData>(200, {
      data,
      error: null,
      meta: buildMeta()
    }, {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      "Vary": "Cookie"
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to load approvals counts."
      },
      meta: buildMeta()
    });
  }
}
