import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { fetchCompensationSnapshot } from "../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { MeCompensationResponseData } from "../../../../../types/compensation";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view compensation details."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  try {
    const snapshot = await fetchCompensationSnapshot({
      supabase,
      orgId: session.profile.org_id,
      employeeId: session.profile.id
    });

    if (!snapshot) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Compensation profile was not found."
        },
        meta: buildMeta()
      });
    }

    return jsonResponse<MeCompensationResponseData>(200, {
      data: snapshot,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load compensation details."
      },
      meta: buildMeta()
    });
  }
}
