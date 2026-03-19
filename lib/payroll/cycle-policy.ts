import { hasRole } from "../roles";
import type { UserRole } from "../navigation";
import type { PayrollApprovalDecision } from "./approval-policy";
import type { PayrollCycleStatus } from "../../types/payroll-runs";

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

  // Semimonthly model: cycles are auto-created with the run in draft/calculated state.
  // Manual cycle creation is allowed on approved or processing runs (legacy compat).
  if (
    input.runStatus !== "draft" &&
    input.runStatus !== "calculated" &&
    input.runStatus !== "approved" &&
    input.runStatus !== "processing"
  ) {
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: "Payout cycles can only be created on draft, calculated, approved, or processing runs."
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

// ── Cycle action (submit / approve / reject / mark_ready / mark_processing / mark_paid) ──

export type CycleActionType =
  | "submit"
  | "approve"
  | "reject"
  | "mark_ready"
  | "mark_processing"
  | "mark_paid";

export type CycleActionInput = {
  action: CycleActionType;
  cycleStatus: PayrollCycleStatus;
  actorId: string;
  /** The user who submitted this cycle. Used for separation of duties. */
  submittedBy: string | null;
  actorRoles: readonly UserRole[];
};

function isFinanceUser(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canApproveCycle(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

/** Valid source statuses per action. */
const CYCLE_ACTION_TRANSITIONS: Record<CycleActionType, readonly PayrollCycleStatus[]> = {
  submit: ["draft", "rejected"],
  approve: ["submitted"],
  reject: ["submitted"],
  mark_ready: ["approved"],
  mark_processing: ["ready"],
  mark_paid: ["approved", "ready", "processing"]
};

const CYCLE_ACTION_LABELS: Record<CycleActionType, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  mark_ready: "ready",
  mark_processing: "processing",
  mark_paid: "paid"
};

export function evaluateCycleAction(input: CycleActionInput): PayrollApprovalDecision {
  if (!isFinanceUser(input.actorRoles)) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: "Only Finance users can update cycle status."
    };
  }

  // Check valid status transition
  const validFrom = CYCLE_ACTION_TRANSITIONS[input.action];
  if (!validFrom.includes(input.cycleStatus)) {
    const target = CYCLE_ACTION_LABELS[input.action];
    return {
      allowed: false,
      code: "INVALID_STATE",
      message: `Cannot mark cycle as ${target} from current status "${input.cycleStatus}".`
    };
  }

  // Approve/reject requires FINANCE_APPROVER or SUPER_ADMIN
  if (input.action === "approve" || input.action === "reject") {
    if (!canApproveCycle(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Approver and Super Admin can approve or reject cycles."
      };
    }

    // Separation of duties: submitter cannot approve/reject their own cycle
    if (input.submittedBy && input.submittedBy === input.actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "The person who submitted the cycle cannot approve or reject it."
      };
    }
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
    actorId: "",
    submittedBy: null,
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
