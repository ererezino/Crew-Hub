import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";

type AckRow = {
  id: string;
  policy_id: string;
  created_at: string;
};

type PolicyRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
};

type PendingAckItem = {
  acknowledgment_id: string;
  policy_id: string;
  policy_name: string;
  policy_description: string;
  policy_category: string;
  requested_at: string;
};

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
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: acks } = await supabase
    .from("policy_acknowledgments")
    .select("id, policy_id, created_at")
    .eq("employee_id", session.profile.id)
    .is("acknowledged_at", null);

  if (!acks || acks.length === 0) {
    return jsonResponse<PendingAckItem[]>(200, {
      data: [],
      error: null,
      meta: buildMeta(),
    });
  }

  const typedAcks = acks as AckRow[];

  // Get policy details
  const policyIds = typedAcks.map((a) => a.policy_id);
  const { data: policies } = await supabase
    .from("compliance_policies")
    .select("id, name, description, category")
    .in("id", policyIds);

  const typedPolicies = (policies as PolicyRow[] | null) ?? [];

  const pending: PendingAckItem[] = typedAcks.map((ack) => {
    const policy = typedPolicies.find((p) => p.id === ack.policy_id);
    return {
      acknowledgment_id: ack.id,
      policy_id: ack.policy_id,
      policy_name: policy?.name ?? "Unknown Policy",
      policy_description: policy?.description ?? "",
      policy_category: policy?.category ?? "",
      requested_at: ack.created_at,
    };
  });

  return jsonResponse<PendingAckItem[]>(200, {
    data: pending,
    error: null,
    meta: buildMeta(),
  });
}
