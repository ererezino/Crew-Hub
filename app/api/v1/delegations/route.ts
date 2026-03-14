import { NextRequest } from "next/server";

import { logAudit } from "../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { buildMeta, jsonResponse } from "../../../../lib/people/shared";
import {
  APPROVAL_CAPABLE_ROLES,
  type DelegationRecord,
  createDelegationSchema,
  mapDelegationRow,
  computeEffectiveStatus
} from "./_helpers";

// ── GET /api/v1/delegations ─────────────────────────────────────────────
//
// Lists all delegations for the org, with resolved names and effective status.

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can manage delegations."
      },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const svc = createSupabaseServiceRoleClient();

  // Parse query params
  const { searchParams } = request.nextUrl;
  const statusFilter = searchParams.get("status") ?? "active";
  const principalIdFilter = searchParams.get("principalId");
  const delegateIdFilter = searchParams.get("delegateId");

  // Build query
  let query = svc
    .from("approval_delegates")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (statusFilter === "active") {
    query = query.eq("is_active", true);
  } else if (statusFilter === "inactive") {
    query = query.eq("is_active", false);
  }
  // "all" → no filter

  if (principalIdFilter) {
    query = query.eq("principal_id", principalIdFilter);
  }
  if (delegateIdFilter) {
    query = query.eq("delegate_id", delegateIdFilter);
  }

  const { data: delegations, error: delegationsError } = await query;

  if (delegationsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to load delegations." },
      meta: buildMeta()
    });
  }

  if (!delegations || delegations.length === 0) {
    return jsonResponse<{ delegations: DelegationRecord[] }>(200, {
      data: { delegations: [] },
      error: null,
      meta: buildMeta()
    });
  }

  // Collect unique person IDs for name resolution
  const personIds = new Set<string>();
  for (const d of delegations) {
    if (d.principal_id) personIds.add(d.principal_id);
    if (d.delegate_id) personIds.add(d.delegate_id);
  }

  const { data: profiles } = await svc
    .from("profiles")
    .select("id, full_name, department")
    .in("id", [...personIds]);

  const nameById = new Map<string, string>();
  const deptById = new Map<string, string | null>();
  for (const p of profiles ?? []) {
    nameById.set(p.id, p.full_name);
    deptById.set(p.id, p.department);
  }

  // Determine unavailability for "when_unavailable" delegations
  const whenUnavailablePrincipalIds = delegations
    .filter(
      (d) =>
        d.is_active &&
        d.activation === "when_unavailable"
    )
    .map((d) => d.principal_id as string);

  let unavailableSet = new Set<string>();

  if (whenUnavailablePrincipalIds.length > 0) {
    const { getUnavailablePrincipalIds } = await import("../../../../lib/delegation");
    unavailableSet = await getUnavailablePrincipalIds({
      supabase: svc,
      orgId,
      principalIds: [...new Set(whenUnavailablePrincipalIds)]
    });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  const records: DelegationRecord[] = delegations.map((d) => ({
    ...mapDelegationRow(d, nameById, deptById),
    effectiveStatus: computeEffectiveStatus(d, unavailableSet, today)
  }));

  return jsonResponse<{ delegations: DelegationRecord[] }>(200, {
    data: { delegations: records },
    error: null,
    meta: buildMeta()
  });
}

// ── POST /api/v1/delegations ────────────────────────────────────────────
//
// Creates a new delegation.

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can manage delegations."
      },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const svc = createSupabaseServiceRoleClient();

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid JSON body." },
      meta: buildMeta()
    });
  }

  const parsed = createDelegationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid delegation data."
      },
      meta: buildMeta()
    });
  }

  const payload = parsed.data;

  // Rule: principal !== delegate
  if (payload.principalId === payload.delegateId) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Principal and delegate must be different people."
      },
      meta: buildMeta()
    });
  }

  // Validate principal exists, is active, has approval-capable role
  const { data: principal } = await svc
    .from("profiles")
    .select("id, full_name, department, roles, status")
    .eq("id", payload.principalId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .single();

  if (!principal) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Principal not found or not in this organisation."
      },
      meta: buildMeta()
    });
  }

  if (principal.status !== "active") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Principal must be active."
      },
      meta: buildMeta()
    });
  }

  const principalRoles: string[] = Array.isArray(principal.roles) ? principal.roles : [];
  const hasApprovalRole = principalRoles.some((r) =>
    APPROVAL_CAPABLE_ROLES.includes(r as typeof APPROVAL_CAPABLE_ROLES[number])
  );

  if (!hasApprovalRole) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Principal must hold an approval-capable role (Manager, Team Lead, HR Admin, or Super Admin)."
      },
      meta: buildMeta()
    });
  }

  // Validate delegate exists, is active
  const { data: delegate } = await svc
    .from("profiles")
    .select("id, full_name, department, status")
    .eq("id", payload.delegateId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .single();

  if (!delegate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Delegate not found or not in this organisation."
      },
      meta: buildMeta()
    });
  }

  if (delegate.status !== "active") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Delegate must be active."
      },
      meta: buildMeta()
    });
  }

  // Temporary: validate dates
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  if (payload.delegateType === "temporary") {
    if (!payload.startsAt || !payload.endsAt) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Temporary delegations require start and end dates."
        },
        meta: buildMeta()
      });
    }
    if (payload.endsAt < payload.startsAt) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "End date must be on or after start date."
        },
        meta: buildMeta()
      });
    }
    if (payload.endsAt < today) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "End date must be today or in the future."
        },
        meta: buildMeta()
      });
    }

    // Overlap protection for temporary delegations
    const { data: overlapping } = await svc
      .from("approval_delegates")
      .select("id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("principal_id", payload.principalId)
      .eq("delegate_id", payload.delegateId)
      .eq("delegate_type", "temporary")
      .eq("is_active", true)
      .lte("starts_at", payload.endsAt)
      .gte("ends_at", payload.startsAt);

    if (overlapping && overlapping.length > 0) {
      const existing = overlapping[0];
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "CONFLICT",
          message: `An active temporary delegation for ${principal.full_name} → ${delegate.full_name} already covers ${existing.starts_at} – ${existing.ends_at}, which overlaps with the requested dates.`
        },
        meta: buildMeta()
      });
    }
  }

  // Duplicate check for permanent types
  if (payload.delegateType !== "temporary") {
    const { data: existing } = await svc
      .from("approval_delegates")
      .select("id")
      .eq("org_id", orgId)
      .eq("principal_id", payload.principalId)
      .eq("delegate_id", payload.delegateId)
      .eq("delegate_type", payload.delegateType)
      .eq("is_active", true)
      .limit(1);

    if (existing && existing.length > 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "CONFLICT",
          message: `An active ${payload.delegateType.replace(/_/g, " ")} delegation already exists for this principal/delegate pair.`
        },
        meta: buildMeta()
      });
    }
  }

  // Insert
  const { data: inserted, error: insertError } = await svc
    .from("approval_delegates")
    .insert({
      org_id: orgId,
      principal_id: payload.principalId,
      delegate_id: payload.delegateId,
      delegate_type: payload.delegateType,
      scope: payload.scope,
      activation: payload.activation,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      is_active: true
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to create delegation." },
      meta: buildMeta()
    });
  }

  // Audit
  await logAudit({
    action: "created",
    tableName: "approval_delegates",
    recordId: inserted.id,
    oldValue: null,
    newValue: {
      principalId: payload.principalId,
      principalName: principal.full_name,
      delegateId: payload.delegateId,
      delegateName: delegate.full_name,
      delegateType: payload.delegateType,
      scope: payload.scope,
      activation: payload.activation,
      startsAt: payload.startsAt ?? null,
      endsAt: payload.endsAt ?? null,
      isActive: true
    }
  });

  const nameById = new Map<string, string>([
    [principal.id, principal.full_name],
    [delegate.id, delegate.full_name]
  ]);
  const deptById = new Map<string, string | null>([
    [principal.id, principal.department],
    [delegate.id, delegate.department]
  ]);

  const record: DelegationRecord = {
    ...mapDelegationRow(inserted, nameById, deptById),
    effectiveStatus: computeEffectiveStatus(inserted, new Set(), today)
  };

  return jsonResponse<{ delegation: DelegationRecord }>(201, {
    data: { delegation: record },
    error: null,
    meta: buildMeta()
  });
}
