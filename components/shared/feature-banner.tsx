"use client";

import { useTranslations } from "next-intl";
import {
  type FeatureState,
  type ModuleId,
  FEATURE_STATE_META,
  getModuleState
} from "../../lib/feature-state";

type FeatureBannerProps = {
  /** Either provide a moduleId to look up state, or a direct state */
  moduleId?: ModuleId;
  state?: FeatureState;
  /** Override the default description */
  description?: string;
  /** Optional: who owns the next step */
  owner?: string;
  /** Optional: what resolves this state */
  resolution?: string;
  /** Optional: link to more info or the setup flow */
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
};

const TONE_TO_BANNER_CLASS: Record<string, string> = {
  success: "feature-banner-success",
  info: "feature-banner-info",
  warning: "feature-banner-warning",
  draft: "feature-banner-neutral",
  error: "feature-banner-error",
  pending: "feature-banner-warning",
  processing: "feature-banner-info"
};

/**
 * Page-level banner that communicates feature state.
 * Place at the top of any page whose module is not LIVE.
 *
 * Renders nothing for LIVE state.
 */
export function FeatureBanner({
  moduleId,
  state,
  description,
  owner,
  resolution,
  actionLabel,
  actionHref,
  onAction
}: FeatureBannerProps) {
  const t = useTranslations("common");
  const resolvedState = state ?? (moduleId ? getModuleState(moduleId) : "LIVE");

  // LIVE features don't need a banner
  if (resolvedState === "LIVE") {
    return null;
  }

  const meta = FEATURE_STATE_META[resolvedState];

  // Only show banner if the state calls for it
  if (!meta.showBanner) {
    return null;
  }

  const bannerClass = TONE_TO_BANNER_CLASS[meta.tone] ?? "feature-banner-neutral";
  const text = description ?? meta.description;

  return (
    <div className={`feature-banner ${bannerClass}`} role="status" aria-live="polite">
      <div className="feature-banner-content">
        <p className="feature-banner-label">{meta.label}</p>
        {text ? <p className="feature-banner-description">{text}</p> : null}
        {owner ? (
          <p className="feature-banner-meta">
            <strong>{t("featureBanner.ownerLabel")}</strong> {owner}
          </p>
        ) : null}
        {resolution ? (
          <p className="feature-banner-meta">
            <strong>{t("featureBanner.nextStepLabel")}</strong> {resolution}
          </p>
        ) : null}
      </div>
      {actionLabel && (actionHref || onAction) ? (
        actionHref ? (
          <a className="feature-banner-action" href={actionHref}>
            {actionLabel}
          </a>
        ) : (
          <button type="button" className="feature-banner-action" onClick={onAction}>
            {actionLabel}
          </button>
        )
      ) : null}
    </div>
  );
}
