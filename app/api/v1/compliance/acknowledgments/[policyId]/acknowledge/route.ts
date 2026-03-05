import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ policyId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  const { policyId } = await params;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("policy_acknowledgments")
    .update({
      acknowledged_at: new Date().toISOString(),
    })
    .eq("policy_id", policyId)
    .eq("employee_id", session.profile.id)
    .is("acknowledged_at", null);

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPDATE_FAILED", message: error.message },
      meta: buildMeta(),
    });
  }

  return jsonResponse<{ acknowledged: boolean }>(200, {
    data: { acknowledged: true },
    error: null,
    meta: buildMeta(),
  });
}
