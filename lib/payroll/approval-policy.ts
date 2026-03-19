import { hasRole } from "../roles";
import type { PayrollRunStatus } from "../../types/payroll-runs";
import type { UserRole } from "../navigation";

export type PayrollApprovalAction = "submit" | "approve" | "reject" | "cancel" | "reopen" | "mark_processing" | "mark_completed";

export type PayrollApprovalInput = {
  action: PayrollApprovalAction;
  status: PayrollRunStatus;
  actorId: string;
  /** The user who submitted the run (written to submitted_by). */
  submittedBy: string | null;
  actorRoles: readonly UserRole[];
};

export type PayrollApprovalDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      code: "FORBIDDEN" | "INVALID_STATE" | "PAYROLL_LOCKED";
      message: string;
    };

function isFinanceUser(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

function canApprove(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export function evaluatePayrollApprovalAction(input: PayrollApprovalInput): PayrollApprovalDecision {
  // Locked-state guards — only specific actions can escape these states.
  if (input.status === "approved" && input.action !== "reopen" && input.action !== "mark_processing") {
    return {
      allowed: false,
      code: "PAYROLL_LOCKED",
      message: "Payroll locked. Approved runs cannot be modified."
    };
  }

  if (input.status === "processing" && input.action !== "reopen" && input.action !== "mark_completed") {
    return {
      allowed: false,
      code: "PAYROLL_LOCKED",
      message: "Payroll locked. Processing runs cannot be modified."
    };
  }

  if (input.status === "completed") {
    return {
      allowed: false,
      code: "PAYROLL_LOCKED",
      message: "Payroll locked. Completed runs cannot be modified."
    };
  }

  // ── submit ──────────────────────────────────────────────────────────
  if (input.action === "submit") {
    if (!isFinanceUser(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance users can submit payroll runs."
      };
    }

    if (input.status !== "calculated" && input.status !== "rejected") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only calculated or rejected runs can be submitted for approval."
      };
    }
  }

  // ── approve (single step) ──────────────────────────────────────────
  if (input.action === "approve") {
    if (!canApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Approver and Super Admin can approve payroll runs."
      };
    }

    if (input.status !== "submitted") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only submitted runs can be approved."
      };
    }

    // Separation of duties — submitter cannot approve their own submission.
    if (input.submittedBy === input.actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "The person who submitted the run cannot approve it."
      };
    }
  }

  // ── reject ──────────────────────────────────────────────────────────
  if (input.action === "reject") {
    if (!canApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Approver and Super Admin can reject payroll runs."
      };
    }

    if (input.status !== "submitted") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only submitted runs can be rejected."
      };
    }

    // Submitter cannot reject their own submission (they should cancel instead).
    if (input.submittedBy === input.actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "The person who submitted the run cannot reject it."
      };
    }
  }

  // ── cancel ──────────────────────────────────────────────────────────
  if (input.action === "cancel") {
    if (!isFinanceUser(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance users can cancel payroll runs."
      };
    }

    if (input.status === "cancelled") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Run is already cancelled."
      };
    }
  }

  // ── reopen ──────────────────────────────────────────────────────────
  if (input.action === "reopen") {
    if (!canApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Approver and Super Admin can reopen payroll runs."
      };
    }

    if (input.status !== "approved" && input.status !== "processing") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only approved or processing runs can be reopened."
      };
    }
  }

  // ── mark_processing ─────────────────────────────────────────────────
  if (input.action === "mark_processing") {
    if (!isFinanceUser(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance users can mark runs as processing."
      };
    }

    if (input.status !== "approved") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only approved runs can be marked as processing."
      };
    }
  }

  // ── mark_completed ──────────────────────────────────────────────────
  if (input.action === "mark_completed") {
    if (!isFinanceUser(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance users can mark runs as completed."
      };
    }

    if (input.status !== "processing") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only processing runs can be marked as completed."
      };
    }
  }

  return {
    allowed: true
  };
}
