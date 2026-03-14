import { z } from "zod";

// ── Constants ───────────────────────────────────────────────────────────

export const DELEGATE_TYPES = [
  "deputy_team_lead",
  "cofounder_coverage",
  "temporary"
] as const;

export const DELEGATE_SCOPES = ["leave", "expense", "schedule"] as const;

export const ACTIVATION_MODES = ["when_unavailable", "always"] as const;

export const APPROVAL_CAPABLE_ROLES = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "SUPER_ADMIN"
] as const;

// ── Types ───────────────────────────────────────────────────────────────

export type DelegateType = (typeof DELEGATE_TYPES)[number];
export type DelegateScope = (typeof DELEGATE_SCOPES)[number];
export type ActivationMode = (typeof ACTIVATION_MODES)[number];
export type EffectiveStatus = "in_effect" | "standby" | "expired" | "inactive";

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

// ── Schemas ─────────────────────────────────────────────────────────────

export const createDelegationSchema = z.object({
  principalId: z.string().uuid("Principal ID must be a valid UUID."),
  delegateId: z.string().uuid("Delegate ID must be a valid UUID."),
  delegateType: z.enum(DELEGATE_TYPES, {
    message: `Delegate type must be one of: ${DELEGATE_TYPES.join(", ")}.`
  }),
  scope: z
    .array(z.enum(DELEGATE_SCOPES))
    .min(1, "At least one scope is required.")
    .refine(
      (arr) => new Set(arr).size === arr.length,
      "Duplicate scopes are not allowed."
    ),
  activation: z.enum(ACTIVATION_MODES, {
    message: `Activation must be one of: ${ACTIVATION_MODES.join(", ")}.`
  }),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD.").nullable().optional(),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD.").nullable().optional()
});

export type CreateDelegationPayload = z.infer<typeof createDelegationSchema>;

// ── Row Mapping ─────────────────────────────────────────────────────────

export function mapDelegationRow(
  row: Record<string, unknown>,
  nameById: Map<string, string>,
  deptById: Map<string, string | null>
): Omit<DelegationRecord, "effectiveStatus"> {
  const principalId = row.principal_id as string;
  const delegateId = row.delegate_id as string;

  return {
    id: row.id as string,
    principalId,
    principalName: nameById.get(principalId) ?? "Unknown",
    principalDepartment: deptById.get(principalId) ?? null,
    delegateId,
    delegateName: nameById.get(delegateId) ?? "Unknown",
    delegateDepartment: deptById.get(delegateId) ?? null,
    delegateType: row.delegate_type as DelegateType,
    scope: (Array.isArray(row.scope) ? row.scope : []) as DelegateScope[],
    activation: row.activation as ActivationMode,
    startsAt: (row.starts_at as string) ?? null,
    endsAt: (row.ends_at as string) ?? null,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string
  };
}

// ── Effective Status Computation ────────────────────────────────────────

export function computeEffectiveStatus(
  row: Record<string, unknown>,
  unavailableSet: Set<string>,
  today: string
): EffectiveStatus {
  if (!row.is_active) {
    return "inactive";
  }

  // Check if temporary and expired
  if (row.delegate_type === "temporary" && row.ends_at && row.ends_at < today) {
    return "expired";
  }

  // Check if temporary and hasn't started yet
  if (row.delegate_type === "temporary" && row.starts_at && row.starts_at > today) {
    return "standby";
  }

  // For "always" activation — if date range is valid (or not temporary), it's in effect
  if (row.activation === "always") {
    return "in_effect";
  }

  // For "when_unavailable" — check if principal is currently unavailable
  if (unavailableSet.has(row.principal_id as string)) {
    return "in_effect";
  }

  return "standby";
}

// ── Human-Readable Labels ───────────────────────────────────────────────

export const DELEGATE_TYPE_LABELS: Record<DelegateType, string> = {
  deputy_team_lead: "Deputy Team Lead",
  cofounder_coverage: "Cofounder Coverage",
  temporary: "Temporary"
};
