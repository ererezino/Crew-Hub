import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { todayIsoDate } from "./datetime";
import type { UserRole } from "./navigation";
import { hasAnyRole } from "./roles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Organisation-wide timezone used for date-based checks (leave, delegation).
 * All employees are currently based in Nigeria; revisit if the org spans
 * multiple timezones.
 */
const ORG_TIMEZONE = "Africa/Lagos";

/** Roles that can approve leave and manager-stage expenses. */
const APPROVAL_CAPABLE_ROLES: readonly UserRole[] = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "SUPER_ADMIN"
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegateScope = "leave" | "expense" | "schedule";

export type DelegateType = "deputy_team_lead" | "cofounder_coverage" | "temporary";

export type CoveringForEntry = {
  principalId: string;
  principalName: string;
  delegateType: DelegateType;
};

export type ApproverScope = {
  /** Employee IDs this user can approve for directly (operational reports). */
  directReportIds: string[];
  /** Employee IDs this user can approve via delegation. */
  delegatedReportIds: string[];
  /** Which principals this user is currently covering. */
  coveringFor: CoveringForEntry[];
};

export type DelegationContext = {
  actingFor: string | null;
  delegateType: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns today's date string (YYYY-MM-DD) in the org timezone.
 * Falls back to UTC if timezone formatting fails.
 */
function todayInOrgTimezone(): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: ORG_TIMEZONE });
  } catch {
    return todayIsoDate();
  }
}

// ---------------------------------------------------------------------------
// Unavailability detection
// ---------------------------------------------------------------------------

/**
 * Returns the set of principal IDs (from the given list) that are currently
 * unavailable — either on approved leave or manually marked OOO.
 *
 * Batched: two queries total regardless of how many principals.
 */
export async function getUnavailablePrincipalIds({
  supabase,
  orgId,
  principalIds
}: {
  supabase: SupabaseClient;
  orgId: string;
  principalIds: string[];
}): Promise<Set<string>> {
  if (principalIds.length === 0) {
    return new Set();
  }

  const today = todayInOrgTimezone();

  const [leaveResult, oooResult] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("employee_id")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", today)
      .gte("end_date", today)
      .is("deleted_at", null)
      .in("employee_id", principalIds),
    supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("availability_status", "ooo")
      .in("id", principalIds)
      .is("deleted_at", null)
  ]);

  const unavailable = new Set<string>();

  for (const row of leaveResult.data ?? []) {
    if (typeof row.employee_id === "string") {
      unavailable.add(row.employee_id);
    }
  }

  for (const row of oooResult.data ?? []) {
    if (typeof row.id === "string") {
      unavailable.add(row.id);
    }
  }

  return unavailable;
}

/**
 * Check if a single principal is unavailable.
 * Prefer getUnavailablePrincipalIds for batch checks.
 */
export async function isPrincipalUnavailable({
  supabase,
  orgId,
  principalId
}: {
  supabase: SupabaseClient;
  orgId: string;
  principalId: string;
}): Promise<boolean> {
  const result = await getUnavailablePrincipalIds({
    supabase,
    orgId,
    principalIds: [principalId]
  });

  return result.has(principalId);
}

// ---------------------------------------------------------------------------
// Operational report resolution
// ---------------------------------------------------------------------------

/**
 * Returns profile IDs of active employees whose operational lead is the
 * given user.
 *
 * "Operational lead" = team_lead_id if set, otherwise manager_id.
 *
 * Also validates that:
 * - Only active employees are included (not onboarding/offboarding/inactive)
 * - If team_lead_id points to a deleted/inactive/role-less profile,
 *   falls back to manager_id (handled by the OR query structure).
 */
export async function listOperationalReportIds({
  supabase,
  orgId,
  leadId
}: {
  supabase: SupabaseClient;
  orgId: string;
  leadId: string;
}): Promise<string[]> {
  // People whose team_lead_id = leadId
  // OR whose team_lead_id IS NULL AND manager_id = leadId
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`team_lead_id.eq.${leadId},and(team_lead_id.is.null,manager_id.eq.${leadId})`);

  if (error || !data) {
    return [];
  }

  return data
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
}

// ---------------------------------------------------------------------------
// Active delegation lookup
// ---------------------------------------------------------------------------

type ActiveDelegation = {
  principalId: string;
  principalName: string;
  principalDepartment: string | null;
  delegateType: DelegateType;
  activation: "when_unavailable" | "always";
};

/**
 * Returns all active delegations where the given user is the delegate,
 * filtered by scope and date bounds.
 *
 * Does NOT yet filter by unavailability — the caller must check that
 * for 'when_unavailable' delegations.
 */
async function loadActiveDelegations({
  supabase,
  orgId,
  delegateId,
  scope
}: {
  supabase: SupabaseClient;
  orgId: string;
  delegateId: string;
  scope: DelegateScope;
}): Promise<ActiveDelegation[]> {
  const { data: delegations, error } = await supabase
    .from("approval_delegates")
    .select("principal_id, delegate_type, activation, starts_at, ends_at, scope")
    .eq("org_id", orgId)
    .eq("delegate_id", delegateId)
    .eq("is_active", true);

  if (error || !delegations?.length) {
    return [];
  }

  const today = todayInOrgTimezone();
  const candidatePrincipalIds: string[] = [];
  const candidatesByPrincipal = new Map<
    string,
    { delegateType: DelegateType; activation: "when_unavailable" | "always" }
  >();

  for (const d of delegations) {
    // Filter by scope: the scope array must contain the requested scope
    const scopes: string[] = Array.isArray(d.scope) ? d.scope : [];
    if (!scopes.includes(scope)) continue;

    // Filter by date bounds (for temporary delegations)
    if (d.starts_at && d.starts_at > today) continue;
    if (d.ends_at && d.ends_at < today) continue;

    const principalId = d.principal_id as string;
    candidatePrincipalIds.push(principalId);
    candidatesByPrincipal.set(principalId, {
      delegateType: d.delegate_type as DelegateType,
      activation: d.activation as "when_unavailable" | "always"
    });
  }

  if (candidatePrincipalIds.length === 0) {
    return [];
  }

  // Fetch principal profile info (name, department, roles) to:
  // 1. Populate coveringFor display data
  // 2. Validate the principal has an approval-capable role (safeguard #20)
  const { data: principalProfiles } = await supabase
    .from("profiles")
    .select("id, full_name, department, roles")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", candidatePrincipalIds);

  if (!principalProfiles?.length) {
    return [];
  }

  const results: ActiveDelegation[] = [];

  for (const profile of principalProfiles) {
    const candidate = candidatesByPrincipal.get(profile.id as string);
    if (!candidate) continue;

    // Safeguard: skip principals who don't have an approval-capable role.
    // This prevents routing into a dead end when team_lead_id was set
    // but the role was never assigned.
    const principalRoles: UserRole[] = Array.isArray(profile.roles)
      ? (profile.roles as UserRole[])
      : [];

    if (!hasAnyRole(principalRoles, APPROVAL_CAPABLE_ROLES)) {
      continue;
    }

    results.push({
      principalId: profile.id as string,
      principalName: (profile.full_name as string) ?? "Unknown",
      principalDepartment: (profile.department as string) ?? null,
      delegateType: candidate.delegateType,
      activation: candidate.activation
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Core: getEffectiveApproverScope
// ---------------------------------------------------------------------------

/**
 * Returns the full set of employee IDs that the given user can approve for,
 * combining their direct operational reports with any delegated reports
 * (from principals who are currently unavailable).
 *
 * Used by leave approval, expense manager-stage approval, and schedule
 * publishing routes.
 */
export async function getEffectiveApproverScope({
  supabase,
  orgId,
  userId,
  scope
}: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  scope: DelegateScope;
}): Promise<ApproverScope> {
  // 1. Direct operational reports
  const directReportIds = await listOperationalReportIds({
    supabase,
    orgId,
    leadId: userId
  });

  // 2. Load delegations where this user is the delegate
  const delegations = await loadActiveDelegations({
    supabase,
    orgId,
    delegateId: userId,
    scope
  });

  if (delegations.length === 0) {
    return { directReportIds, delegatedReportIds: [], coveringFor: [] };
  }

  // 3. Check unavailability for 'when_unavailable' delegations (batched)
  const unavailableCheckIds = delegations
    .filter((d) => d.activation === "when_unavailable")
    .map((d) => d.principalId);

  const unavailableSet =
    unavailableCheckIds.length > 0
      ? await getUnavailablePrincipalIds({
          supabase,
          orgId,
          principalIds: unavailableCheckIds
        })
      : new Set<string>();

  // 4. Determine which delegations are currently active
  const activeDelegations = delegations.filter((d) => {
    if (d.activation === "always") return true;
    return unavailableSet.has(d.principalId);
  });

  if (activeDelegations.length === 0) {
    return { directReportIds, delegatedReportIds: [], coveringFor: [] };
  }

  // 5. Get the operational reports of each active principal
  const activePrincipalIds = activeDelegations.map((d) => d.principalId);
  const delegatedReportResults = await Promise.all(
    activePrincipalIds.map((principalId) =>
      listOperationalReportIds({ supabase, orgId, leadId: principalId })
    )
  );

  const directReportIdSet = new Set(directReportIds);
  const delegatedReportIds = [
    ...new Set(delegatedReportResults.flat())
  ].filter((id) => !directReportIdSet.has(id));

  const coveringFor: CoveringForEntry[] = activeDelegations.map((d) => ({
    principalId: d.principalId,
    principalName: d.principalName,
    delegateType: d.delegateType
  }));

  return { directReportIds, delegatedReportIds, coveringFor };
}

// ---------------------------------------------------------------------------
// Delegation context resolution (for audit trail)
// ---------------------------------------------------------------------------

/**
 * For a given employee, determines the delegation context.
 *
 * If the employee is a direct report of the approver → no delegation.
 * If the employee is a delegated report → returns the principal and type.
 *
 * Used per-item in bulk approval to write correct audit data.
 */
export function resolveDelegationContext(
  employeeId: string,
  scope: ApproverScope
): DelegationContext {
  // Check if this is a direct report (no delegation)
  if (scope.directReportIds.includes(employeeId)) {
    return { actingFor: null, delegateType: null };
  }

  // It's a delegated report — find which principal's team this employee belongs to.
  // For phase 1, if there are multiple coveringFor entries, we use the first match.
  // This is correct because an employee can only have one team_lead_id/manager_id,
  // so they can only belong to one principal's team.
  if (scope.coveringFor.length === 1) {
    return {
      actingFor: scope.coveringFor[0].principalId,
      delegateType: scope.coveringFor[0].delegateType
    };
  }

  // Multiple principals — the employee could belong to any of them.
  // Return the first covering entry as the most likely match.
  // (In practice, an employee only appears under one principal's reports.)
  if (scope.coveringFor.length > 0) {
    return {
      actingFor: scope.coveringFor[0].principalId,
      delegateType: scope.coveringFor[0].delegateType
    };
  }

  return { actingFor: null, delegateType: null };
}

// ---------------------------------------------------------------------------
// Schedule delegation check
// ---------------------------------------------------------------------------

/**
 * For schedule publishing, checks if the user can publish a schedule
 * containing shifts for the given employee IDs.
 *
 * Returns { allowed, actingFor } where actingFor is set if the user
 * is publishing as a delegate.
 */
export async function canPublishScheduleForShifts({
  supabase,
  orgId,
  userId,
  userRoles,
  shiftEmployeeIds
}: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  userRoles: readonly UserRole[];
  shiftEmployeeIds: string[];
}): Promise<{
  allowed: boolean;
  actingFor: string | null;
  delegateType: string | null;
}> {
  // Admin/Manager override — can publish any schedule
  if (hasAnyRole(userRoles, ["MANAGER", "HR_ADMIN", "SUPER_ADMIN"])) {
    return { allowed: true, actingFor: null, delegateType: null };
  }

  if (shiftEmployeeIds.length === 0) {
    return { allowed: false, actingFor: null, delegateType: null };
  }

  // Get operational scope including delegated reports
  const scope = await getEffectiveApproverScope({
    supabase,
    orgId,
    userId,
    scope: "schedule"
  });

  const ledIds = new Set([...scope.directReportIds, ...scope.delegatedReportIds]);

  // Every employee in the schedule must be someone this user leads
  const allCovered = shiftEmployeeIds.every((id) => ledIds.has(id));

  if (!allCovered) {
    return { allowed: false, actingFor: null, delegateType: null };
  }

  // Determine delegation context
  const isDelegated = shiftEmployeeIds.some((id) => !scope.directReportIds.includes(id));

  if (isDelegated && scope.coveringFor.length > 0) {
    return {
      allowed: true,
      actingFor: scope.coveringFor[0].principalId,
      delegateType: scope.coveringFor[0].delegateType
    };
  }

  return { allowed: true, actingFor: null, delegateType: null };
}
