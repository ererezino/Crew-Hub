import {
  type FeatureState,
  type ModuleId,
  FEATURE_STATE_META,
  getModuleState
} from "../../lib/feature-state";

type FeatureBadgeProps = {
  /** Either provide a moduleId to look up state, or a direct state */
  moduleId?: ModuleId;
  state?: FeatureState;
  /** Override the default label */
  label?: string;
};

/**
 * Compact inline badge that communicates feature state.
 * Use in nav items, table headers, card titles, or button groups.
 *
 * Renders nothing for LIVE state — no badge needed when things are normal.
 */
export function FeatureBadge({ moduleId, state, label }: FeatureBadgeProps) {
  const resolvedState = state ?? (moduleId ? getModuleState(moduleId) : "LIVE");

  // LIVE features don't need a badge
  if (resolvedState === "LIVE") {
    return null;
  }

  const meta = FEATURE_STATE_META[resolvedState];
  const displayLabel = label ?? meta.label;

  return (
    <span
      className={`status-badge status-badge-${meta.tone}`}
      aria-label={`Feature status: ${displayLabel}`}
    >
      {displayLabel}
    </span>
  );
}
