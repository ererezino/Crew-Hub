import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";

const policyParamsSchema = z.object({
  policyId: z.string().uuid("Policy id must be a valid UUID.")
});

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

  const parsedParams = policyParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsedParams.error.issues[0]?.message ?? "Invalid policy id." },
      meta: buildMeta(),
    });
  }

  const { policyId } = parsedParams.data;
  const supabase = await createSupabaseServerClient();
  const acknowledgedAt = new Date().toISOString();

  const { error } = await supabase
    .from("policy_acknowledgments")
    .upsert(
      {
        org_id: session.profile.org_id,
        policy_id: policyId,
        employee_id: session.profile.id,
        acknowledged_at: acknowledgedAt
      },
      {
        onConflict: "policy_id,employee_id"
      }
    );

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPDATE_FAILED", message: error.message },
      meta: buildMeta(),
    });
  }

  return jsonResponse<{ acknowledged: boolean; acknowledgedAt: string }>(200, {
    data: { acknowledged: true, acknowledgedAt },
    error: null,
    meta: buildMeta(),
  });
}

export async function GET(
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

  const parsedParams = policyParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsedParams.error.issues[0]?.message ?? "Invalid policy id." },
      meta: buildMeta(),
    });
  }

  const { policyId } = parsedParams.data;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("policy_acknowledgments")
    .select("acknowledged_at")
    .eq("org_id", session.profile.org_id)
    .eq("policy_id", policyId)
    .eq("employee_id", session.profile.id)
    .maybeSingle();

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: error.message },
      meta: buildMeta(),
    });
  }

  const acknowledgedAt =
    data && typeof data.acknowledged_at === "string" ? data.acknowledged_at : null;

  return jsonResponse<{ acknowledged: boolean; acknowledgedAt: string | null }>(200, {
    data: { acknowledged: acknowledgedAt !== null, acknowledgedAt },
    error: null,
    meta: buildMeta(),
  });
}
