import { hasRole } from "../roles";
import type { UserRole } from "../navigation";
import type { PayrollApprovalDecision } from "./approval-policy";

export type PayrollCycleStatus = "draft" | "ready" | "processing" | "paid" | "failed" | "cancelled";

// ── Prepare payout ──────────────────────────────────────────────────

export type PreparePayoutInput = {
  runStatus: string;
  actorRoles: readonly UserRole[];
  /** True when at least one employee is not yet assigned to an active cycle. */
  hasEligibleEmployees: boolean;
};

export function evaluatePreparePayoutAction(input: PreparePayoutInput): PayrollApprovalDecision {
  const isFinanceUser =
    hasRole(input.actorRoles, "FINANCE_ADMIN") ||
    hasRole(input.actorRoles, "FINANCE_APPROVER") ||
    hasRole(input.actorRoles, "SUPER_ADMIN");

  if (!isFinanceUser) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: "Only Finance users can prepare payout cycles."
    };
  }

  // Multi-cycle: allow new cycles on approved or processing runs
  if (input.runStatus !== "approved" && input.runStatus !== "processing") {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only approved or processing runs can have payout cycles created."
    };
  }

  if (!input.hasEligibleEmployees) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "All employees are already assigned to active payout cycles."
    };
  }

  return { allowed: true };
}

// ── Cycle action (mark_ready / mark_processing / mark_paid) ────────

export type CycleActionType = "mark_ready" | "mark_processing" | "mark_paid";

export type CycleActionInput = {
  action: CycleActionType;
  cycleStatus: PayrollCycleStatus;
  actorRoles: readonly UserRole[];
};

/** Valid transitions per action. */
const CYCLE_ACTION_TRANSITIONS: Record<CycleActionType, readonly PayrollCycleStatus[]> = {
  mark_ready: ["draft"],
  mark_processing: ["ready"],
  mark_paid: ["ready", "processing"]
};

const CYCLE_ACTION_LABELS: Record<CycleActionType, string> = {
  mark_ready: "ready",
  mark_processing: "processing",
  mark_paid: "paid"
};

export function evaluateCycleAction(input: CycleActionInput): PayrollApprovalDecision {
  const isFinanceUser =
    hasRole(input.actorRoles, "FINANCE_ADMIN") ||
    hasRole(input.actorRoles, "FINANCE_APPROVER") ||
    hasRole(input.actorRoles, "SUPER_ADMIN");

  if (!isFinanceUser) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: "Only Finance users can update cycle status."
    };
  }

  const validFrom = CYCLE_ACTION_TRANSITIONS[input.action];
  if (!validFrom.includes(input.cycleStatus)) {
    const target = CYCLE_ACTION_LABELS[input.action];
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: `Cannot mark cycle as ${target} from current status "${input.cycleStatus}".`
    };
  }

  return { allowed: true };
}

// ── Mark cycle paid (legacy convenience — delegates to evaluateCycleAction) ─

export type MarkCyclePaidInput = {
  cycleStatus: PayrollCycleStatus;
  actorRoles: readonly UserRole[];
};

export function evaluateMarkCyclePaidAction(input: MarkCyclePaidInput): PayrollApprovalDecision {
  return evaluateCycleAction({
    action: "mark_paid",
    cycleStatus: input.cycleStatus,
    actorRoles: input.actorRoles
  });
}

// ── Create amendment ────────────────────────────────────────────────

export type CreateAmendmentInput = {
  allCyclesPaid: boolean;
  hasActiveAmendment: boolean;
  actorRoles: readonly UserRole[];
};

export function evaluateCreateAmendmentAction(input: CreateAmendmentInput): PayrollApprovalDecision {
  const canAmend =
    hasRole(input.actorRoles, "FINANCE_APPROVER") ||
    hasRole(input.actorRoles, "SUPER_ADMIN");

  if (!canAmend) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: "Only Finance Approver or Super Admin can create amendment runs."
    };
  }

  if (!input.allCyclesPaid) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only fully completed runs (all cycles paid) can be amended."
    };
  }

  if (input.hasActiveAmendment) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "An active amendment already exists for this run."
    };
  }

  return { allowed: true };
}
