/**
 * Shared display label formatting for enums, statuses, and roles.
 * Every raw enum value shown to a user must go through one of these functions.
 *
 * Each function accepts an optional `locale` parameter ('en' | 'fr').
 * Default is 'en' for backward compatibility. Callers in React components
 * pass locale from useLocale(); email functions pass from the recipient's
 * preferred_locale. This keeps the module pure (no React hooks).
 */

type SupportedLocale = "en" | "fr";

/* ─── Roles ─── */

const ROLE_LABELS_EN: Record<string, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR admin",
  FINANCE_ADMIN: "Finance admin",
  SUPER_ADMIN: "Super admin"
};

const ROLE_LABELS_FR: Record<string, string> = {
  EMPLOYEE: "Employé",
  TEAM_LEAD: "Chef d'équipe",
  MANAGER: "Responsable",
  HR_ADMIN: "Admin RH",
  FINANCE_ADMIN: "Admin financier",
  SUPER_ADMIN: "Super admin"
};

export function formatRoleLabel(role: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? ROLE_LABELS_FR : ROLE_LABELS_EN;
  return labels[role] ?? toSentenceCase(role);
}

/* ─── Employment type ─── */

const EMPLOYMENT_TYPE_LABELS_EN: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contractor: "Contractor"
};

const EMPLOYMENT_TYPE_LABELS_FR: Record<string, string> = {
  full_time: "Temps plein",
  part_time: "Temps partiel",
  contractor: "Prestataire"
};

export function formatEmploymentType(type: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? EMPLOYMENT_TYPE_LABELS_FR : EMPLOYMENT_TYPE_LABELS_EN;
  return labels[type] ?? toSentenceCase(type);
}

/* ─── Profile status ─── */

const PROFILE_STATUS_LABELS_EN: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  pre_start: "Pre-start",
  suspended: "Suspended",
  terminated: "Terminated"
};

const PROFILE_STATUS_LABELS_FR: Record<string, string> = {
  active: "Actif",
  inactive: "Inactif",
  onboarding: "Intégration",
  offboarding: "Départ",
  pre_start: "Pré-embauche",
  suspended: "Suspendu",
  terminated: "Résilié"
};

export function formatProfileStatus(status: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? PROFILE_STATUS_LABELS_FR : PROFILE_STATUS_LABELS_EN;
  return labels[status] ?? toSentenceCase(status);
}

/* ─── Leave request status ─── */

const LEAVE_STATUS_LABELS_EN: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled"
};

const LEAVE_STATUS_LABELS_FR: Record<string, string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Refusé",
  cancelled: "Annulé"
};

export function formatLeaveStatus(status: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? LEAVE_STATUS_LABELS_FR : LEAVE_STATUS_LABELS_EN;
  return labels[status] ?? toSentenceCase(status);
}

/* ─── Shift / schedule / swap statuses ─── */

const SHIFT_STATUS_LABELS_EN: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  locked: "Locked",
  open: "Open",
  assigned: "Assigned",
  cancelled: "Cancelled",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  completed: "Completed"
};

const SHIFT_STATUS_LABELS_FR: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  locked: "Verrouillé",
  open: "Ouvert",
  assigned: "Attribué",
  cancelled: "Annulé",
  pending: "En attente",
  accepted: "Accepté",
  rejected: "Refusé",
  completed: "Terminé"
};

export function formatShiftStatus(status: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? SHIFT_STATUS_LABELS_FR : SHIFT_STATUS_LABELS_EN;
  return labels[status] ?? toSentenceCase(status);
}

export function formatScheduleStatus(status: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? SHIFT_STATUS_LABELS_FR : SHIFT_STATUS_LABELS_EN;
  return labels[status] ?? toSentenceCase(status);
}

export function formatSwapStatus(status: string, locale?: SupportedLocale): string {
  const labels = locale === "fr" ? SHIFT_STATUS_LABELS_FR : SHIFT_STATUS_LABELS_EN;
  return labels[status] ?? toSentenceCase(status);
}

/* ─── Generic sentence case utility ─── */

/**
 * Converts SCREAMING_SNAKE_CASE or snake_case to "Sentence case".
 * Used as a fallback when no explicit label mapping exists.
 */
export function toSentenceCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
