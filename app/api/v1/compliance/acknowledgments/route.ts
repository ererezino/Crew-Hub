import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { canManageCompliance } from "../../../../../lib/compliance";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { PolicyAckStatus } from "../../../../../types/compliance";

const requestSchema = z.object({
  policy_id: z.string().uuid("policy_id must be a valid UUID.")
});

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "INVALID_BODY", message: "Invalid JSON body." },
      meta: buildMeta(),
    });
  }

  const parsedBody = requestSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsedBody.error.issues[0]?.message ?? "policy_id is required." },
      meta: buildMeta(),
    });
  }

  const { policy_id } = parsedBody.data;

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  const { data: policyRowData, error: policyError } = await supabase
    .from("compliance_policies")
    .select("id, name")
    .eq("id", policy_id)
    .eq("org_id", orgId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  const policyRow = policyRowData as { id: string; name: string } | null;

  if (policyError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load policy details." },
      meta: buildMeta(),
    });
  }

  if (!policyRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Published policy not found for this organization."
      },
      meta: buildMeta(),
    });
  }

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

  await createBulkNotifications({
    orgId,
    userIds: employees.map((employee: { id: string }) => employee.id),
    type: "compliance_policy_acknowledgment",
    title: "Policy acknowledgment requested",
    body: `Please review and acknowledge ${policyRow.name}.`,
    link: "/compliance",
    actions: [
      {
        label: "Acknowledge now",
        variant: "primary",
        action_type: "api",
        api_endpoint: `/api/v1/compliance/acknowledgments/${policy_id}/acknowledge`,
        api_method: "POST"
      }
    ]
  });

  return jsonResponse<{ created: number }>(200, {
    data: { created: records.length },
    error: null,
    meta: buildMeta(),
  });
}
