import { NextRequest } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { buildMeta, jsonResponse } from "../../../../../lib/people/shared";
import {
  APPROVAL_CAPABLE_ROLES,
  createDelegationSchema,
  computeEffectiveStatus,
  mapDelegationRow,
  type DelegationRecord
} from "../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid("Delegation id must be a valid UUID.")
});

type RouteContext = { params: Promise<{ id: string }> };

// ── Shared auth guard ───────────────────────────────────────────────────

async function requireSuperAdmin() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return {
      session: null,
      error: jsonResponse<null>(401, {
        data: null,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
        meta: buildMeta()
      })
    };
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return {
      session: null,
      error: jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Only Super Admin can manage delegations."
        },
        meta: buildMeta()
      })
    };
  }

  return { session, error: null };
}

// ── PUT /api/v1/delegations/[id] ───────────────────────────────────────
//
// Updates an existing delegation.

export async function PUT(request: NextRequest, context: RouteContext) {
  const { session, error: authError } = await requireSuperAdmin();
  if (authError) return authError;

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid delegation id."
      },
      meta: buildMeta()
    });
  }

  const delegationId = parsedParams.data.id;
  const orgId = session!.profile!.org_id;
  const svc = createSupabaseServiceRoleClient();

  // Fetch existing delegation
  const { data: existing } = await svc
    .from("approval_delegates")
    .select("*")
    .eq("id", delegationId)
    .eq("org_id", orgId)
    .single();

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Delegation not found." },
      meta: buildMeta()
    });
  }

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

  // Validate principal
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
      error: { code: "VALIDATION_ERROR", message: "Principal must be active." },
      meta: buildMeta()
    });
  }

  const principalRoles: string[] = Array.isArray(principal.roles) ? principal.roles : [];
  if (!principalRoles.some((r) => APPROVAL_CAPABLE_ROLES.includes(r as typeof APPROVAL_CAPABLE_ROLES[number]))) {
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

  // Validate delegate
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
      error: { code: "VALIDATION_ERROR", message: "Delegate must be active." },
      meta: buildMeta()
    });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  // Temporary date validation
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

    // Overlap protection (exclude self)
    const { data: overlapping } = await svc
      .from("approval_delegates")
      .select("id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("principal_id", payload.principalId)
      .eq("delegate_id", payload.delegateId)
      .eq("delegate_type", "temporary")
      .eq("is_active", true)
      .neq("id", delegationId)
      .lte("starts_at", payload.endsAt)
      .gte("ends_at", payload.startsAt);

    if (overlapping && overlapping.length > 0) {
      const ov = overlapping[0];
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "CONFLICT",
          message: `An active temporary delegation for ${principal.full_name} → ${delegate.full_name} already covers ${ov.starts_at} – ${ov.ends_at}, which overlaps with the requested dates.`
        },
        meta: buildMeta()
      });
    }
  }

  // Duplicate check for permanent types (exclude self)
  if (payload.delegateType !== "temporary") {
    const { data: dup } = await svc
      .from("approval_delegates")
      .select("id")
      .eq("org_id", orgId)
      .eq("principal_id", payload.principalId)
      .eq("delegate_id", payload.delegateId)
      .eq("delegate_type", payload.delegateType)
      .eq("is_active", true)
      .neq("id", delegationId)
      .limit(1);

    if (dup && dup.length > 0) {
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

  // Resolve old names for audit
  const oldPersonIds = new Set<string>();
  if (existing.principal_id) oldPersonIds.add(existing.principal_id);
  if (existing.delegate_id) oldPersonIds.add(existing.delegate_id);

  const { data: oldProfiles } = await svc
    .from("profiles")
    .select("id, full_name")
    .in("id", [...oldPersonIds]);

  const oldNameById = new Map<string, string>();
  for (const p of oldProfiles ?? []) {
    oldNameById.set(p.id, p.full_name);
  }

  // Update
  const { data: updated, error: updateError } = await svc
    .from("approval_delegates")
    .update({
      principal_id: payload.principalId,
      delegate_id: payload.delegateId,
      delegate_type: payload.delegateType,
      scope: payload.scope,
      activation: payload.activation,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", delegationId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to update delegation." },
      meta: buildMeta()
    });
  }

  // Audit with full old/new snapshots
  await logAudit({
    action: "updated",
    tableName: "approval_delegates",
    recordId: delegationId,
    oldValue: {
      principalId: existing.principal_id,
      principalName: oldNameById.get(existing.principal_id) ?? null,
      delegateId: existing.delegate_id,
      delegateName: oldNameById.get(existing.delegate_id) ?? null,
      delegateType: existing.delegate_type,
      scope: existing.scope,
      activation: existing.activation,
      startsAt: existing.starts_at,
      endsAt: existing.ends_at,
      isActive: existing.is_active
    },
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
      isActive: updated.is_active
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
    ...mapDelegationRow(updated, nameById, deptById),
    effectiveStatus: computeEffectiveStatus(updated, new Set(), today)
  };

  return jsonResponse<{ delegation: DelegationRecord }>(200, {
    data: { delegation: record },
    error: null,
    meta: buildMeta()
  });
}

// ── DELETE /api/v1/delegations/[id] ────────────────────────────────────
//
// Soft-deactivates or reactivates a delegation.
// Body: { action: "deactivate" | "reactivate" }

const deleteBodySchema = z.object({
  action: z.enum(["deactivate", "reactivate"])
});

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { session, error: authError } = await requireSuperAdmin();
  if (authError) return authError;

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid delegation id."
      },
      meta: buildMeta()
    });
  }

  const delegationId = parsedParams.data.id;
  const orgId = session!.profile!.org_id;
  const svc = createSupabaseServiceRoleClient();

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Default to deactivate when no body
    body = { action: "deactivate" };
  }

  const parsedBody = deleteBodySchema.safeParse(body);
  const requestedAction = parsedBody.success ? parsedBody.data.action : "deactivate";

  // Fetch existing
  const { data: existing } = await svc
    .from("approval_delegates")
    .select("*")
    .eq("id", delegationId)
    .eq("org_id", orgId)
    .single();

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Delegation not found." },
      meta: buildMeta()
    });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  if (requestedAction === "reactivate") {
    // Cannot reactivate if already active
    if (existing.is_active) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Delegation is already active."
        },
        meta: buildMeta()
      });
    }

    // Cannot reactivate expired temporary
    if (
      existing.delegate_type === "temporary" &&
      existing.ends_at &&
      existing.ends_at < today
    ) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Cannot reactivate an expired temporary delegation. Create a new delegation with updated dates instead."
        },
        meta: buildMeta()
      });
    }

    // Check principal still eligible
    const { data: principal } = await svc
      .from("profiles")
      .select("id, full_name, roles, status")
      .eq("id", existing.principal_id)
      .is("deleted_at", null)
      .single();

    if (!principal || principal.status !== "active") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Principal is no longer eligible for delegation."
        },
        meta: buildMeta()
      });
    }

    const principalRoles: string[] = Array.isArray(principal.roles)
      ? principal.roles
      : [];
    if (
      !principalRoles.some((r) =>
        APPROVAL_CAPABLE_ROLES.includes(r as typeof APPROVAL_CAPABLE_ROLES[number])
      )
    ) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Principal is no longer eligible for delegation."
        },
        meta: buildMeta()
      });
    }

    // Check delegate still active
    const { data: delegate } = await svc
      .from("profiles")
      .select("id, status")
      .eq("id", existing.delegate_id)
      .is("deleted_at", null)
      .single();

    if (!delegate || delegate.status !== "active") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Delegate is no longer active."
        },
        meta: buildMeta()
      });
    }

    // Check duplicate would not be created
    if (existing.delegate_type !== "temporary") {
      const { data: dup } = await svc
        .from("approval_delegates")
        .select("id")
        .eq("org_id", orgId)
        .eq("principal_id", existing.principal_id)
        .eq("delegate_id", existing.delegate_id)
        .eq("delegate_type", existing.delegate_type)
        .eq("is_active", true)
        .neq("id", delegationId)
        .limit(1);

      if (dup && dup.length > 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "CONFLICT",
            message:
              "An active delegation already exists for this principal/delegate/type combination."
          },
          meta: buildMeta()
        });
      }
    } else {
      // Overlap check for temporary reactivation
      const { data: overlapping } = await svc
        .from("approval_delegates")
        .select("id")
        .eq("org_id", orgId)
        .eq("principal_id", existing.principal_id)
        .eq("delegate_id", existing.delegate_id)
        .eq("delegate_type", "temporary")
        .eq("is_active", true)
        .neq("id", delegationId)
        .lte("starts_at", existing.ends_at)
        .gte("ends_at", existing.starts_at);

      if (overlapping && overlapping.length > 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "CONFLICT",
            message:
              "An active delegation already exists for this principal/delegate/type combination."
          },
          meta: buildMeta()
        });
      }
    }
  } else {
    // Deactivate: cannot deactivate if already inactive
    if (!existing.is_active) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Delegation is already inactive."
        },
        meta: buildMeta()
      });
    }
  }

  const newIsActive = requestedAction === "reactivate";

  const { data: updated, error: updateError } = await svc
    .from("approval_delegates")
    .update({
      is_active: newIsActive,
      updated_at: new Date().toISOString()
    })
    .eq("id", delegationId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: `Failed to ${requestedAction} delegation.`
      },
      meta: buildMeta()
    });
  }

  // Resolve names for audit
  const personIds = [existing.principal_id, existing.delegate_id].filter(Boolean);
  const { data: profiles } = await svc
    .from("profiles")
    .select("id, full_name, department")
    .in("id", personIds);

  const nameById = new Map<string, string>();
  const deptById = new Map<string, string | null>();
  for (const p of profiles ?? []) {
    nameById.set(p.id, p.full_name);
    deptById.set(p.id, p.department);
  }

  if (requestedAction === "deactivate") {
    await logAudit({
      action: "deleted",
      tableName: "approval_delegates",
      recordId: delegationId,
      oldValue: {
        principalId: existing.principal_id,
        principalName: nameById.get(existing.principal_id) ?? null,
        delegateId: existing.delegate_id,
        delegateName: nameById.get(existing.delegate_id) ?? null,
        delegateType: existing.delegate_type,
        scope: existing.scope,
        activation: existing.activation,
        startsAt: existing.starts_at,
        endsAt: existing.ends_at,
        isActive: true
      },
      newValue: { isActive: false }
    });
  } else {
    await logAudit({
      action: "updated",
      tableName: "approval_delegates",
      recordId: delegationId,
      oldValue: { isActive: false },
      newValue: {
        principalId: existing.principal_id,
        principalName: nameById.get(existing.principal_id) ?? null,
        delegateId: existing.delegate_id,
        delegateName: nameById.get(existing.delegate_id) ?? null,
        delegateType: existing.delegate_type,
        scope: existing.scope,
        activation: existing.activation,
        startsAt: existing.starts_at,
        endsAt: existing.ends_at,
        isActive: true
      }
    });
  }

  const record: DelegationRecord = {
    ...mapDelegationRow(updated, nameById, deptById),
    effectiveStatus: computeEffectiveStatus(updated, new Set(), today)
  };

  return jsonResponse<{ delegation: DelegationRecord }>(200, {
    data: { delegation: record },
    error: null,
    meta: buildMeta()
  });
}
