import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { fetchDashboardData } from "../../../../lib/dashboard/fetch-dashboard-data";
import type { ApiResponse } from "../../../../types/auth";
import type { DashboardResponseData } from "../../../../types/dashboard";

/* ── Helpers ── */

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>, headers?: Record<string, string>) {
  return NextResponse.json(payload, { status, headers });
}

/* ── Main handler ── */

export async function GET() {
  try {
    const session = await getAuthenticatedSession();

    if (!session?.profile) {
      return jsonResponse<null>(401, {
        data: null,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
        meta: buildMeta()
      });
    }

    const data = await fetchDashboardData(session.profile, session.org);

    return jsonResponse<DashboardResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    }, { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Unexpected dashboard error."
      },
      meta: buildMeta()
    });
  }
}
