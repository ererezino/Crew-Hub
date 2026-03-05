import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { canManageCompliance } from "../../../../../lib/compliance";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { PolicyAckStatus } from "../../../../../types/compliance";

type AckRow = {
  employee_id: string;
  acknowledged_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
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

  if (!canManageCompliance(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Admin access required." },
      meta: buildMeta(),
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Get all published policies
  const { data: policies, error: policiesError } = await supabase
    .from("compliance_policies")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("status", "published")
    .is("deleted_at", null);

  if (policiesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load policies." },
      meta: buildMeta(),
    });
  }

  if (!policies || policies.length === 0) {
    return jsonResponse<PolicyAckStatus[]>(200, {
      data: [],
      error: null,
      meta: buildMeta(),
    });
  }

  // Get acknowledgment status for each policy
  const statuses: PolicyAckStatus[] = await Promise.all(
    policies.map(async (policy: { id: string; name: string }) => {
      const { data: acks } = await supabase
        .from("policy_acknowledgments")
        .select("employee_id, acknowledged_at")
        .eq("policy_id", policy.id)
        .eq("org_id", orgId);

      const allAcks: AckRow[] = (acks as AckRow[] | null) ?? [];
      const acknowledged = allAcks.filter((a) => a.acknowledged_at !== null);
      const pendingAcks = allAcks.filter((a) => a.acknowledged_at === null);

      // Get pending employee details
      let pendingEmployees: ProfileRow[] = [];
      if (pendingAcks.length > 0) {
        const pendingIds = pendingAcks.map((a) => a.employee_id);
        const { data: pendingProfiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", pendingIds);
        pendingEmployees = (pendingProfiles as ProfileRow[] | null) ?? [];
      }

      return {
        policy_id: policy.id,
        policy_name: policy.name,
        total_required: allAcks.length,
        acknowledged_count: acknowledged.length,
        pending_count: pendingAcks.length,
        pending_employees: pendingEmployees,
      };
    })
  );

  return jsonResponse<PolicyAckStatus[]>(200, {
    data: statuses,
    error: null,
    meta: buildMeta(),
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  if (!canManageCompliance(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Admin access required." },
      meta: buildMeta(),
    });
  }

  let body: { policy_id?: string };
  try {
    body = (await request.json()) as { policy_id?: string };
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "INVALID_BODY", message: "Invalid JSON body." },
      meta: buildMeta(),
    });
  }

  const { policy_id } = body;

  if (!policy_id) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "policy_id is required." },
      meta: buildMeta(),
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Get all active employees in the org
  const { data: employees } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (!employees || employees.length === 0) {
    return jsonResponse<{ created: number }>(200, {
      data: { created: 0 },
      error: null,
      meta: buildMeta(),
    });
  }

  // Create acknowledgment records (upsert to avoid duplicates)
  const records = employees.map((emp: { id: string }) => ({
    org_id: orgId,
    policy_id,
    employee_id: emp.id,
    acknowledged_at: null,
  }));

  const { error } = await supabase
    .from("policy_acknowledgments")
    .upsert(records, { onConflict: "policy_id,employee_id", ignoreDuplicates: true });

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INSERT_FAILED", message: error.message },
      meta: buildMeta(),
    });
  }

  return jsonResponse<{ created: number }>(200, {
    data: { created: records.length },
    error: null,
    meta: buildMeta(),
  });
}
