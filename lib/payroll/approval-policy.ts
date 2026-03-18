import { hasRole } from "../roles";
import type { PayrollRunStatus } from "../../types/payroll-runs";
import type { UserRole } from "../navigation";

export type PayrollApprovalAction = "submit" | "approve_first" | "approve_final" | "reject" | "cancel" | "reopen" | "mark_processing" | "mark_completed";

export type PayrollApprovalInput = {
  action: PayrollApprovalAction;
  status: PayrollRunStatus;
  actorId: string;
  initiatedBy: string | null;
  firstApprovedBy: string | null;
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

function canSubmit(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

function canFirstApprove(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

function canFinalApprove(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export function evaluatePayrollApprovalAction(input: PayrollApprovalInput): PayrollApprovalDecision {
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

  if (input.action === "submit") {
    if (!canSubmit(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can submit payroll runs."
      };
    }

    if (input.status !== "calculated") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only calculated runs can be submitted for approval."
      };
    }
  }

  if (input.action === "approve_first") {
    if (!canFirstApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can first-approve payroll runs."
      };
    }

    if (input.status !== "pending_first_approval") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Run must be pending first approval."
      };
    }

    if (input.initiatedBy === input.actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Initiator cannot perform first approval."
      };
    }
  }

  if (input.action === "approve_final") {
    if (!canFinalApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Super Admin can final-approve payroll runs."
      };
    }

    if (input.status !== "pending_final_approval") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Run must be pending final approval."
      };
    }

    if (!input.firstApprovedBy) {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Run must have first approval before final approval."
      };
    }

    if (input.firstApprovedBy === input.actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Final approver must be different from first approver."
      };
    }
  }

  if (input.action === "reject") {
    if (input.status !== "pending_first_approval" && input.status !== "pending_final_approval") {
      return {
        allowed: false,
        code: "INVALID_STATE",
        message: "Only pending approval runs can be rejected."
      };
    }

    if (input.status === "pending_first_approval") {
      if (!canFirstApprove(input.actorRoles)) {
        return {
          allowed: false,
          code: "FORBIDDEN",
          message: "Only Finance Admin and Super Admin can reject at first approval."
        };
      }

      if (input.initiatedBy === input.actorId) {
        return {
          allowed: false,
          code: "FORBIDDEN",
          message: "Initiator cannot reject at first approval."
        };
      }
    }

    if (input.status === "pending_final_approval") {
      if (!canFinalApprove(input.actorRoles)) {
        return {
          allowed: false,
          code: "FORBIDDEN",
          message: "Only Super Admin can reject at final approval."
        };
      }

      if (input.firstApprovedBy === input.actorId) {
        return {
          allowed: false,
          code: "FORBIDDEN",
          message: "Final reviewer must be different from first approver."
        };
      }
    }
  }

  if (input.action === "cancel") {
    if (!canSubmit(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can cancel payroll runs."
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

  if (input.action === "reopen") {
    if (!canFinalApprove(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Super Admin can reopen payroll runs."
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

  if (input.action === "mark_processing") {
    if (!canSubmit(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can mark runs as processing."
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

  if (input.action === "mark_completed") {
    if (!canSubmit(input.actorRoles)) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can mark runs as completed."
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
