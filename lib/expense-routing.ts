import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getEffectiveApproverScope,
  resolveDelegationContext,
  type ApproverScope,
  type DelegationContext
} from "./delegation";
import { hasRole } from "./roles";
import type { UserRole } from "./navigation";
import { createSupabaseServiceRoleClient } from "./supabase/service-role";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpenseRoute = {
  requiresAdditionalApproval: boolean;
  additionalApproverId: string | null;
  matchedRuleId: string | null;
};

export type StageInfo = {
  /** The approval stage this expense is currently at. */
  currentStage: "manager" | "additional" | "finance" | "complete" | "terminal";
  /** The status value(s) the expense should be in for this stage. */
  expectedStatus: string;
};

export type StageAuthResult = {
  allowed: boolean;
  delegationCtx: DelegationContext;
};

type RoutingRule = {
  id: string;
  department: string | null;
  min_amount: number | null;
  max_amount: number | null;
  category: string | null;
  approver_type: "department_owner" | "specific_person";
  approver_id: string | null;
};

// ---------------------------------------------------------------------------
// resolveExpenseRoute — called once at submission time
// ---------------------------------------------------------------------------

/**
 * Evaluates routing rules for an expense and determines whether an
 * additional approval stage is needed.
 *
 * First-match-wins: rules are ordered by priority (lowest first).
 * One additional approver max.
 *
 * If the resolved additional approver is the same as the submitter's
 * manager, the additional stage is skipped (same-person optimization).
 */
export async function resolveExpenseRoute({
  supabase,
  orgId,
  employeeId,
  department,
  amount,
  category
}: {
  supabase: SupabaseClient;
  orgId: string;
  employeeId: string;
  department: string | null;
  amount: number;
  category: string;
}): Promise<ExpenseRoute> {
  const svc = createSupabaseServiceRoleClient();

  // 1. Load active routing rules ordered by priority
  const { data: rules } = await svc
    .from("expense_routing_rules")
    .select("id, department, min_amount, max_amount, category, approver_type, approver_id")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("priority", { ascending: true });

  if (!rules || rules.length === 0) {
    return { requiresAdditionalApproval: false, additionalApproverId: null, matchedRuleId: null };
  }

  // 2. Find the first matching rule
  const matchedRule = (rules as RoutingRule[]).find((rule) => {
    if (rule.department !== null && rule.department !== department) return false;
    if (rule.min_amount !== null && amount < rule.min_amount) return false;
    if (rule.max_amount !== null && amount > rule.max_amount) return false;
    if (rule.category !== null && rule.category !== category) return false;
    return true;
  });

  if (!matchedRule) {
    return { requiresAdditionalApproval: false, additionalApproverId: null, matchedRuleId: null };
  }

  // 3. Resolve the approver
  let approverId: string | null = null;

  if (matchedRule.approver_type === "specific_person") {
    approverId = matchedRule.approver_id;
  } else if (matchedRule.approver_type === "department_owner") {
    approverId = await resolveDepartmentOwner(svc, orgId, department);
  }

  if (!approverId) {
    // Rule matched but no approver could be resolved — skip additional stage
    return { requiresAdditionalApproval: false, additionalApproverId: null, matchedRuleId: matchedRule.id };
  }

  // 4. Same-person check: if additional approver IS the employee's manager, skip
  const { data: employeeProfile } = await svc
    .from("profiles")
    .select("manager_id, team_lead_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeProfile) {
    const managerId = employeeProfile.team_lead_id ?? employeeProfile.manager_id;
    if (managerId === approverId) {
      // Rule matched, but manager = additional approver. Record rule for audit, skip stage.
      return { requiresAdditionalApproval: false, additionalApproverId: null, matchedRuleId: matchedRule.id };
    }
  }

  // 5. Self-approval check: if the additional approver IS the submitter, skip
  if (approverId === employeeId) {
    return { requiresAdditionalApproval: false, additionalApproverId: null, matchedRuleId: matchedRule.id };
  }

  return {
    requiresAdditionalApproval: true,
    additionalApproverId: approverId,
    matchedRuleId: matchedRule.id
  };
}

// ---------------------------------------------------------------------------
// resolveDepartmentOwner — looks up function_owners table
// ---------------------------------------------------------------------------

async function resolveDepartmentOwner(
  supabase: SupabaseClient,
  orgId: string,
  department: string | null
): Promise<string | null> {
  if (!department) return null;

  // Prefer executive, fall back to operational_lead
  const { data: owners } = await supabase
    .from("function_owners")
    .select("owner_id, ownership_type")
    .eq("org_id", orgId)
    .eq("department", department)
    .eq("is_active", true)
    .in("ownership_type", ["executive", "operational_lead"])
    .order("ownership_type", { ascending: true }); // 'executive' < 'operational_lead' alphabetically

  if (!owners || owners.length === 0) return null;

  // executive first
  const exec = owners.find((o) => o.ownership_type === "executive");
  if (exec) return exec.owner_id as string;

  return (owners[0]?.owner_id as string) ?? null;
}

// ---------------------------------------------------------------------------
// resolveCurrentStage — determines where an expense is in the pipeline
// ---------------------------------------------------------------------------

/**
 * Given an expense's status and routing flags, returns what stage
 * it's currently at and what the next valid transitions are.
 */
export function resolveCurrentStage(expense: {
  status: string;
  requires_additional_approval?: boolean;
  requiresAdditionalApproval?: boolean;
  manager_approved_by?: string | null;
  managerApprovedBy?: string | null;
  additional_approver_id?: string | null;
  additionalApproverId?: string | null;
}): StageInfo {
  const requiresAdditional = expense.requires_additional_approval ?? expense.requiresAdditionalApproval ?? false;
  const managerApprovedBy = expense.manager_approved_by ?? expense.managerApprovedBy ?? null;
  const additionalApproverId = expense.additional_approver_id ?? expense.additionalApproverId ?? null;

  switch (expense.status) {
    case "pending":
      return { currentStage: "manager", expectedStatus: "pending" };

    case "manager_approved":
      // If additional approval is required, check if same person already approved
      if (requiresAdditional && additionalApproverId) {
        // Auto-skip: if manager who approved = additional approver
        if (managerApprovedBy === additionalApproverId) {
          return { currentStage: "finance", expectedStatus: "manager_approved" };
        }
        return { currentStage: "additional", expectedStatus: "manager_approved" };
      }
      return { currentStage: "finance", expectedStatus: "manager_approved" };

    case "additional_approved":
      return { currentStage: "finance", expectedStatus: "additional_approved" };

    case "reimbursed":
      return { currentStage: "complete", expectedStatus: "reimbursed" };

    case "rejected":
    case "finance_rejected":
    case "cancelled":
      return { currentStage: "terminal", expectedStatus: expense.status };

    default:
      // Legacy 'approved' status — treat as finance stage
      return { currentStage: "finance", expectedStatus: expense.status };
  }
}

// ---------------------------------------------------------------------------
// canApproveAtStage — centralized authorization for all 3 stages
// ---------------------------------------------------------------------------

/**
 * Checks whether a user can approve/reject at the given stage.
 * Returns { allowed, delegationCtx } for audit trail.
 */
export async function canApproveAtStage({
  supabase,
  userId,
  userRoles,
  orgId,
  expense,
  stage
}: {
  supabase: SupabaseClient;
  userId: string;
  userRoles: readonly UserRole[];
  orgId: string;
  expense: {
    employee_id: string;
    additional_approver_id?: string | null;
  };
  stage: "manager" | "additional" | "finance";
}): Promise<StageAuthResult> {
  const noAuth: StageAuthResult = { allowed: false, delegationCtx: { actingFor: null, delegateType: null } };
  const isSuperAdmin = hasRole(userRoles, "SUPER_ADMIN");

  // Self-approval prevention (all stages)
  if (userId === expense.employee_id) {
    return noAuth;
  }

  if (stage === "manager") {
    if (isSuperAdmin) {
      return { allowed: true, delegationCtx: { actingFor: null, delegateType: null } };
    }

    const hasManagerRole = hasRole(userRoles, "MANAGER") || hasRole(userRoles, "TEAM_LEAD");
    if (!hasManagerRole) return noAuth;

    const scope = await getEffectiveApproverScope({ supabase, orgId, userId, scope: "expense" });
    const allReportIds = [...scope.directReportIds, ...scope.delegatedReportIds];

    if (!allReportIds.includes(expense.employee_id)) return noAuth;

    return {
      allowed: true,
      delegationCtx: resolveDelegationContext(expense.employee_id, scope)
    };
  }

  if (stage === "additional") {
    const additionalApproverId = expense.additional_approver_id ?? null;
    if (!additionalApproverId) return noAuth;

    if (isSuperAdmin) {
      return { allowed: true, delegationCtx: { actingFor: null, delegateType: null } };
    }

    // Direct match: user IS the additional approver
    if (userId === additionalApproverId) {
      return { allowed: true, delegationCtx: { actingFor: null, delegateType: null } };
    }

    // Delegation check: is the user a delegate for the additional approver?
    const scope = await getEffectiveApproverScope({ supabase, orgId, userId, scope: "expense" });

    // Check if any of the user's delegation entries cover the additional approver
    const coveringEntry = scope.coveringFor.find((c) => c.principalId === additionalApproverId);
    if (coveringEntry) {
      return {
        allowed: true,
        delegationCtx: {
          actingFor: coveringEntry.principalId,
          delegateType: coveringEntry.delegateType
        }
      };
    }

    return noAuth;
  }

  if (stage === "finance") {
    const hasFinanceRole = hasRole(userRoles, "FINANCE_ADMIN") || isSuperAdmin;
    if (!hasFinanceRole) return noAuth;

    return { allowed: true, delegationCtx: { actingFor: null, delegateType: null } };
  }

  return noAuth;
}
