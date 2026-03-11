"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";

import { usePresence, type PresenceEntry, type PresenceState } from "../../hooks/use-presence";

function PresenceDot({ state, labels }: { state: PresenceState; labels: Record<PresenceState, string> }) {
  return (
    <span
      className={`presence-dot presence-dot-${state}`}
      title={labels[state]}
      aria-label={labels[state]}
    />
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

type WhoIsOnlineProps = {
  isSidebarCollapsed: boolean;
};

export function WhoIsOnline({ isSidebarCollapsed }: WhoIsOnlineProps) {
  const t = useTranslations("presence");
  const { entries, counts, isLoading } = usePresence(true);
  const [isExpanded, setIsExpanded] = useState(true);

  const presenceLabels = useMemo<Record<PresenceState, string>>(() => ({
    online: t("state.online"),
    away: t("state.away"),
    offline: t("state.offline"),
  }), [t]);

  const statusLabels = useMemo<Record<string, string>>(() => ({
    afk: t("status.afk"),
    ooo: t("status.ooo"),
  }), [t]);

  const activeEntries = entries.filter(
    (entry) => entry.presence === "online" || entry.presence === "away"
  );

  const activeCount = counts.online + counts.away;

  if (isLoading && entries.length === 0) {
    return null;
  }

  /* Collapsed sidebar: just show a small indicator */
  if (isSidebarCollapsed) {
    return (
      <div className="wio-collapsed" title={t("collapsedTooltip", { online: counts.online, away: counts.away })}>
        <span className="wio-collapsed-dot" />
        {activeCount > 0 ? (
          <span className="wio-collapsed-count">{activeCount}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wio-panel">
      <button
        type="button"
        className="wio-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <span className="wio-header-left">
          <span className="wio-header-dot" />
          <span className="wio-header-label">{t("header")}</span>
        </span>
        <span className="wio-header-right">
          <span className="wio-count-badge">{activeCount}</span>
          <svg
            className={`wio-chevron${isExpanded ? " wio-chevron-open" : ""}`}
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="M4.5 6.5L8 10l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
      </button>

      {isExpanded ? (
        <ul className="wio-list">
          {activeEntries.length === 0 ? (
            <li className="wio-empty">{t("empty")}</li>
          ) : (
            activeEntries.map((entry) => {
              const statusLabel = statusLabels[entry.availabilityStatus];
              const statusTooltip = statusLabel
                ? entry.statusNote
                  ? `${statusLabel}: ${entry.statusNote}`
                  : statusLabel
                : undefined;

              return (
                <li key={entry.id} className="wio-entry">
                  <Link href={`/people/${entry.id}`} className="wio-entry-link">
                    <span className="wio-avatar">
                      {entry.avatarUrl ? (
                        <Image
                          src={entry.avatarUrl}
                          alt=""
                          width={24}
                          height={24}
                          className="wio-avatar-image"
                        />
                      ) : (
                        <span className="wio-avatar-fallback">
                          {getInitials(entry.fullName)}
                        </span>
                      )}
                      <PresenceDot state={entry.presence} labels={presenceLabels} />
                    </span>
                    <span className="wio-entry-info">
                      <span className="wio-name" title={entry.fullName}>
                        {entry.fullName}
                      </span>
                      {statusLabel ? (
                        <span
                          className={`wio-status-badge wio-status-${entry.availabilityStatus}`}
                          title={statusTooltip}
                        >
                          {statusLabel}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
