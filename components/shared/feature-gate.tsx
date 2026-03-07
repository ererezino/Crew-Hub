"use client";

import type { ReactNode } from "react";
import {
  type FeatureState,
  type ModuleId,
  FEATURE_STATE_META,
  getModuleState
} from "../../lib/feature-state";
import { EmptyState } from "./empty-state";

type FeatureGateProps = {
  /** Module to gate */
  moduleId?: ModuleId;
  state?: FeatureState;
  /** Content to render when the feature is actionable */
  children: ReactNode;
  /** What to show when gated — defaults to an appropriate EmptyState */
  fallback?: ReactNode;
  /**
   * Behavior when actions are disabled:
   * - "block" (default): show fallback instead of children
   * - "overlay": show children dimmed with a banner overlay
   * - "disable": render children but disable interactive elements
   */
  behavior?: "block" | "overlay" | "disable";
};

const STATE_EMPTY_STATES: Partial<Record<FeatureState, { title: string; description: string }>> = {
  UNAVAILABLE: {
    title: "Not available",
    description: "This feature is not available in the current release."
  },
  COMING_SOON: {
    title: "Coming soon",
    description: "This capability is on the roadmap. It will be available in a future release."
  },
  SETUP_REQUIRED: {
    title: "Setup required",
    description: "Complete the required configuration before this feature can be used."
  },
  BLOCKED: {
    title: "Blocked",
    description: "This feature is currently blocked. Contact your administrator for next steps."
  },
  SIMULATION: {
    title: "Simulation mode",
    description: "This feature runs in simulation mode. No real transactions are executed."
  }
};

/**
 * Conditional renderer based on feature state.
 * Wraps content and replaces or overlays it when the feature is not actionable.
 *
 * Use this to gate entire page sections, action panels, or feature areas.
 */
export function FeatureGate({
  moduleId,
  state,
  children,
  fallback,
  behavior = "block"
}: FeatureGateProps) {
  const resolvedState = state ?? (moduleId ? getModuleState(moduleId) : "LIVE");
  const meta = FEATURE_STATE_META[resolvedState];

  // If actions are enabled, just render children
  if (!meta.actionsDisabled) {
    return <>{children}</>;
  }

  // If a custom fallback is provided, use it
  if (fallback) {
    return <>{behavior === "block" ? fallback : children}</>;
  }

  // Default gating behaviors
  if (behavior === "overlay") {
    return (
      <div className="feature-gate-overlay" aria-disabled="true">
        <div className="feature-gate-overlay-content" aria-hidden="true">
          {children}
        </div>
        <div className="feature-gate-overlay-barrier">
          <p className="feature-gate-overlay-label">{meta.label}</p>
          <p className="feature-gate-overlay-text">{meta.description}</p>
        </div>
      </div>
    );
  }

  if (behavior === "disable") {
    return (
      <fieldset disabled aria-disabled="true" className="feature-gate-disabled">
        {children}
      </fieldset>
    );
  }

  // Default: block with EmptyState
  const emptyConfig = STATE_EMPTY_STATES[resolvedState] ?? {
    title: meta.label,
    description: meta.description
  };

  return <EmptyState title={emptyConfig.title} description={emptyConfig.description} />;
}
