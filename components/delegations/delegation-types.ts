// ── Shared types for delegation UI components ──────────────────────────

export type DelegateType = "deputy_team_lead" | "cofounder_coverage" | "temporary";
export type DelegateScope = "leave" | "expense" | "schedule";
export type ActivationMode = "when_unavailable" | "always";
export type EffectiveStatus = "in_effect" | "standby" | "expired" | "inactive";
export type StatusFilter = "active" | "expired" | "inactive" | "all";

export type DelegationRecord = {
  id: string;
  principalId: string;
  principalName: string;
  principalDepartment: string | null;
  delegateId: string;
  delegateName: string;
  delegateDepartment: string | null;
  delegateType: DelegateType;
  scope: DelegateScope[];
  activation: ActivationMode;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  effectiveStatus: EffectiveStatus;
  createdAt: string;
};

export type DelegationFormValues = {
  principalId: string;
  delegateId: string;
  delegateType: DelegateType;
  scope: DelegateScope[];
  activation: ActivationMode;
  startsAt: string | null;
  endsAt: string | null;
};

export type PersonOption = {
  id: string;
  fullName: string;
  department: string | null;
  roles: string[];
};

export const APPROVAL_CAPABLE_ROLES = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "SUPER_ADMIN"
] as const;
