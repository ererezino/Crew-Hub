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

// ── Mark cycle paid ─────────────────────────────────────────────────

export type MarkCyclePaidInput = {
  cycleStatus: PayrollCycleStatus;
  actorRoles: readonly UserRole[];
};

export function evaluateMarkCyclePaidAction(input: MarkCyclePaidInput): PayrollApprovalDecision {
  const isFinanceUser =
    hasRole(input.actorRoles, "FINANCE_ADMIN") ||
    hasRole(input.actorRoles, "FINANCE_APPROVER") ||
    hasRole(input.actorRoles, "SUPER_ADMIN");

  if (!isFinanceUser) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: "Only Finance users can mark cycles as paid."
    };
  }

  if (input.cycleStatus !== "ready" && input.cycleStatus !== "processing") {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only ready or processing cycles can be marked as paid."
    };
  }

  return { allowed: true };
}

// ── Create amendment ────────────────────────────────────────────────

export type CreateAmendmentInput = {
  runLockedAt: string | null;
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

  if (!input.runLockedAt) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Only locked (completed/paid) runs can be amended."
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
