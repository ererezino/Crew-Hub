/**
 * Feature State System
 *
 * Product-wide, single source of truth for feature readiness states.
 * Every module, page, button, and nav item uses these states to communicate
 * honestly about what is live, limited, disabled, or upcoming.
 *
 * Rules:
 * - LIVE = normal actionability, no ambiguity
 * - LIMITED_PILOT = visible and usable, clearly scoped
 * - UNAVAILABLE = not triggerable, no affordance
 * - COMING_SOON = intentional roadmap signal, not lazy placeholder
 * - SIMULATION = unmistakably not real execution
 * - ADMIN_ONLY = not exposed to non-admins
 * - SETUP_REQUIRED = explains missing prerequisites
 * - BLOCKED = identifies blocker, owner, and next step
 */

// ---------------------------------------------------------------------------
// Feature states
// ---------------------------------------------------------------------------

export const FEATURE_STATES = [
  "LIVE",
  "LIMITED_PILOT",
  "UNAVAILABLE",
  "COMING_SOON",
  "SIMULATION",
  "ADMIN_ONLY",
  "SETUP_REQUIRED",
  "BLOCKED"
] as const;

export type FeatureState = (typeof FEATURE_STATES)[number];

// ---------------------------------------------------------------------------
// State metadata (used by UI components to render consistently)
// ---------------------------------------------------------------------------

export type FeatureStateMeta = {
  /** Short label for badges, e.g. "Pilot", "Coming Soon" */
  label: string;
  /** Longer description for banners/tooltips */
  description: string;
  /** Visual tone mapping to StatusBadge */
  tone: "success" | "info" | "warning" | "draft" | "error" | "pending" | "processing";
  /** Whether the feature's primary actions should be disabled */
  actionsDisabled: boolean;
  /** Whether the feature should be hidden from navigation entirely */
  hideFromNav: boolean;
  /** Whether a banner should appear at the top of the page */
  showBanner: boolean;
};

export const FEATURE_STATE_META: Record<FeatureState, FeatureStateMeta> = {
  LIVE: {
    label: "Live",
    description: "",
    tone: "success",
    actionsDisabled: false,
    hideFromNav: false,
    showBanner: false
  },
  LIMITED_PILOT: {
    label: "Pilot",
    description: "This feature is available for the internal pilot. Some limitations may apply.",
    tone: "info",
    actionsDisabled: false,
    hideFromNav: false,
    showBanner: true
  },
  UNAVAILABLE: {
    label: "Preview",
    description: "This module is built but not yet included in the active release.",
    tone: "draft",
    actionsDisabled: true,
    hideFromNav: true,
    showBanner: true
  },
  COMING_SOON: {
    label: "Coming Soon",
    description: "This capability is on the roadmap and not yet available.",
    tone: "draft",
    actionsDisabled: true,
    hideFromNav: false,
    showBanner: true
  },
  SIMULATION: {
    label: "Simulation Only",
    description: "This feature runs in simulation mode. No real transactions are executed.",
    tone: "warning",
    actionsDisabled: false,
    hideFromNav: false,
    showBanner: true
  },
  ADMIN_ONLY: {
    label: "Admin",
    description: "This feature is restricted to administrators.",
    tone: "info",
    actionsDisabled: false,
    hideFromNav: false,
    showBanner: false
  },
  SETUP_REQUIRED: {
    label: "Setup Required",
    description: "Complete the required setup before using this feature.",
    tone: "warning",
    actionsDisabled: true,
    hideFromNav: false,
    showBanner: true
  },
  BLOCKED: {
    label: "Blocked",
    description: "This feature is blocked. See details for the required next step.",
    tone: "error",
    actionsDisabled: true,
    hideFromNav: false,
    showBanner: true
  }
};

// ---------------------------------------------------------------------------
// Module-level feature state registry
// ---------------------------------------------------------------------------

/**
 * Central registry mapping each module/feature to its current state.
 * This is the single place where launch scope decisions are encoded.
 * Update this registry when promoting features between states.
 */
export type ModuleId =
  | "dashboard"
  | "announcements"
  | "time_off"
  | "my_pay"
  | "documents"
  | "learning"
  | "approvals"
  | "people"
  | "scheduling"
  | "scheduling_auto_generate"
  | "onboarding"
  | "team_hub"
  | "payroll"
  | "payroll_disbursement"
  | "payroll_withholding_gh"
  | "payroll_withholding_ke"
  | "payroll_withholding_za"
  | "payroll_withholding_ca"
  | "expenses"
  | "compensation"
  | "performance"
  | "compliance"
  | "analytics"
  | "signatures"
  | "surveys"
  | "time_attendance"
  | "notifications";

export const MODULE_STATES: Record<ModuleId, FeatureState> = {
  // Core pilot modules — LIVE
  dashboard: "LIVE",
  time_off: "LIVE",
  my_pay: "LIVE",
  documents: "LIVE",
  approvals: "LIVE",
  people: "LIVE",
  onboarding: "LIVE",
  expenses: "LIVE",
  compliance: "LIVE",
  time_attendance: "LIVE",
  notifications: "LIVE",
  announcements: "LIVE",
  compensation: "LIVE",

  // Pilot with known limitations
  scheduling: "LIMITED_PILOT",
  scheduling_auto_generate: "SETUP_REQUIRED",
  payroll: "LIMITED_PILOT",

  // Explicitly unavailable sub-features
  payroll_disbursement: "UNAVAILABLE",
  payroll_withholding_gh: "COMING_SOON",
  payroll_withholding_ke: "COMING_SOON",
  payroll_withholding_za: "COMING_SOON",
  payroll_withholding_ca: "COMING_SOON",

  // Pilot with known limitations
  team_hub: "LIMITED_PILOT",
  performance: "LIMITED_PILOT",

  // Hidden from pilot nav — accessible via direct URL only
  learning: "UNAVAILABLE",
  signatures: "UNAVAILABLE",
  surveys: "UNAVAILABLE",
  analytics: "ADMIN_ONLY"
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the current feature state for a module */
export function getModuleState(moduleId: ModuleId): FeatureState {
  return MODULE_STATES[moduleId];
}

/** Get full metadata for a module's current state */
export function getModuleStateMeta(moduleId: ModuleId): FeatureStateMeta {
  return FEATURE_STATE_META[MODULE_STATES[moduleId]];
}

/** Whether a module's actions should be enabled */
export function isModuleActionable(moduleId: ModuleId): boolean {
  return !FEATURE_STATE_META[MODULE_STATES[moduleId]].actionsDisabled;
}

/** Whether a module should appear in navigation */
export function isModuleVisibleInNav(moduleId: ModuleId): boolean {
  return !FEATURE_STATE_META[MODULE_STATES[moduleId]].hideFromNav;
}

/** Whether a module needs a state banner on its page */
export function shouldShowModuleBanner(moduleId: ModuleId): boolean {
  return FEATURE_STATE_META[MODULE_STATES[moduleId]].showBanner;
}
