import { hasRole } from "../roles";
import type { UserRole } from "../navigation";
import type { PayrollApprovalDecision } from "./approval-policy";

export type PayrollCycleStatus = "draft" | "ready" | "processing" | "paid" | "failed" | "cancelled";

// ── Prepare payout ──────────────────────────────────────────────────

export type PreparePayoutInput = {
  runStatus: string;
  flaggedCount: number;
  overrideHolds: boolean;
  actorRoles: readonly UserRole[];
  existingCycleCount: number;
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

  if (input.runStatus !== "approved") {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only approved runs can have payout cycles prepared."
    };
  }

  if (input.existingCycleCount > 0) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Payout cycles already exist for this run."
    };
  }

  if (input.flaggedCount > 0 && !input.overrideHolds) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: `${input.flaggedCount} flagged item(s) must be resolved or overridden before payout.`
    };
  }

  if (input.flaggedCount > 0 && input.overrideHolds) {
    const canOverride =
      hasRole(input.actorRoles, "FINANCE_APPROVER") ||
      hasRole(input.actorRoles, "SUPER_ADMIN");

    if (!canOverride) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Approver or Super Admin can override flagged-item holds."
      };
    }
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
  hasPaidCycles: boolean;
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

  if (!input.hasPaidCycles) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only runs with paid cycles can be amended."
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
