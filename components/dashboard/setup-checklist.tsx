"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";

/* ── Types ── */

type SetupItem = {
  id: string;
  label: string;
  completed: boolean;
  href: string;
};

type SetupData = {
  items: SetupItem[];
  completed_count: number;
  total_count: number;
};

/* ── Constants ── */

const DISMISS_KEY = "crew_hub_setup_dismissed";

/* ── Component ── */

export function SetupChecklist() {
  const t = useTranslations("dashboard");
  const [data, setData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored === "true") setDismissed(true);
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/org/setup-status");
      if (res.ok) {
        const json = await res.json() as { data: SetupData };
        setData(json.data);
      }
    } catch {
      // Silent fail - checklist is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!dismissed) {
      fetchStatus();
    } else {
      setLoading(false);
    }
  }, [dismissed, fetchStatus]);

  /* Refetch when window regains focus — catches returning from setup pages */
  useEffect(() => {
    if (dismissed) return;

    const handleFocus = () => {
      void fetchStatus();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [dismissed, fetchStatus]);

  /* Refetch on custom badge-refresh event (fired by other components) */
  useEffect(() => {
    if (dismissed) return;

    const handleBadgeRefresh = () => {
      void fetchStatus();
    };

    window.addEventListener("crew-hub:badge-refresh", handleBadgeRefresh);
    return () => window.removeEventListener("crew-hub:badge-refresh", handleBadgeRefresh);
  }, [dismissed, fetchStatus]);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // localStorage may be unavailable
    }
    setDismissed(true);
  };

  /**
   * Resolve the display label for a checklist item.
   * Prefer the i18n key `setupChecklist.item_{id}`; fall back to the API-provided label.
   */
  const resolveLabel = useCallback(
    (item: SetupItem): string => {
      const key = `setupChecklist.item_${item.id}`;
      try {
        return t(key as Parameters<typeof t>[0]);
      } catch {
        return item.label;
      }
    },
    [t]
  );

  if (loading || dismissed || !data) return null;
  if (data.completed_count === data.total_count) return null;

  const progressPercent = Math.round(
    (data.completed_count / data.total_count) * 100
  );

  return (
    <div className="setup-checklist">
      <div className="setup-checklist-header">
        <div className="setup-checklist-header-left">
          <h3 className="setup-checklist-title">{t('setupChecklist.title')}</h3>
          <span className="setup-checklist-progress-text">
            {t('setupChecklist.progress', { completed: data.completed_count, total: data.total_count })}
          </span>
        </div>
        <div className="setup-checklist-header-right">
          <button
            className="setup-checklist-toggle"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? t('setupChecklist.expand') : t('setupChecklist.collapse')}
            type="button"
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button
            className="setup-checklist-dismiss"
            onClick={handleDismiss}
            title={t('setupChecklist.dismiss')}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="setup-checklist-progress-bar">
        <div
          className="setup-checklist-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {!collapsed && (
        <div className="setup-checklist-items">
          {data.items.map((item) => (
            <button
              key={item.id}
              className={`setup-checklist-item${item.completed ? " setup-checklist-item-done" : ""}`}
              onClick={() => {
                if (!item.completed) {
                  router.push(item.href);
                }
              }}
              disabled={item.completed}
              type="button"
            >
              <span
                className={`setup-checklist-check${item.completed ? " setup-checklist-check-done" : ""}`}
              >
                {item.completed && <Check size={12} />}
              </span>
              <span className="setup-checklist-item-label">{resolveLabel(item)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
