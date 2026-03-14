"use client";

import { useTranslations } from "next-intl";

type OrgChartToolbarProps = {
  showOperationalLeads: boolean;
  onToggleOperationalLeads: () => void;
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoomPercent: number;
};

export function OrgChartToolbar({
  showOperationalLeads,
  onToggleOperationalLeads,
  onFitToScreen,
  onZoomIn,
  onZoomOut,
  zoomPercent
}: OrgChartToolbarProps) {
  const t = useTranslations("orgChart");

  return (
    <div className="org-chart-toolbar">
      {/* Overlay toggles */}
      <div className="org-chart-toolbar-group">
        <button
          type="button"
          className={
            showOperationalLeads
              ? "org-chart-toolbar-toggle org-chart-toolbar-toggle-active"
              : "org-chart-toolbar-toggle"
          }
          onClick={onToggleOperationalLeads}
          aria-pressed={showOperationalLeads}
          title={t("toolbar.showOperationalLeads")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>{t("toolbar.operationalLeads")}</span>
        </button>
      </div>

      {/* Zoom controls */}
      <div className="org-chart-toolbar-group">
        <button
          type="button"
          className="org-chart-toolbar-button"
          onClick={onZoomOut}
          aria-label={t("toolbar.zoomOut")}
          title={t("toolbar.zoomOut")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <span className="org-chart-toolbar-zoom-label">{zoomPercent}%</span>

        <button
          type="button"
          className="org-chart-toolbar-button"
          onClick={onZoomIn}
          aria-label={t("toolbar.zoomIn")}
          title={t("toolbar.zoomIn")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <button
          type="button"
          className="org-chart-toolbar-button"
          onClick={onFitToScreen}
          aria-label={t("toolbar.fitToScreen")}
          title={t("toolbar.fitToScreen")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
