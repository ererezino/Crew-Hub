"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";

import { usePresence, type PresenceEntry, type PresenceState } from "../../hooks/use-presence";

/* ── Helpers ── */

function PresenceDot({ state, tooltip }: { state: PresenceState; tooltip: string }) {
  return (
    <span
      className={`presence-dot presence-dot-${state}`}
      title={tooltip}
      aria-label={tooltip}
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

/**
 * Format a duration in ms to a human-readable string.
 * Rounds down to the nearest minute.
 * Examples: "5m", "1h 23m", "3h 0m", "2d", ">7d"
 */
function formatDuration(ms: number): string {
  if (ms < 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d`;
  return ">7d";
}

/**
 * Compute a display string for away/last-seen duration.
 * Uses serverTime as reference to avoid client clock skew.
 */
function computeDurationMs(since: string | null, serverTime: string | null): number {
  if (!since || !serverTime) return 0;
  return new Date(serverTime).getTime() - new Date(since).getTime();
}

/* ── Sub-components ── */

function EntryAvatar({ entry, dotTooltip }: { entry: PresenceEntry; dotTooltip: string }) {
  return (
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
      <PresenceDot state={entry.presence} tooltip={dotTooltip} />
    </span>
  );
}

function StatusBadge({ entry, statusLabels }: { entry: PresenceEntry; statusLabels: Record<string, string> }) {
  const label = statusLabels[entry.availabilityStatus];
  if (!label) return null;

  const tooltip = entry.statusNote ? `${label}: ${entry.statusNote}` : label;
  return (
    <span
      className={`wio-status-badge wio-status-${entry.availabilityStatus}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}

function PresenceEntryRow({
  entry,
  serverTime,
  statusLabels,
  presenceLabels,
}: {
  entry: PresenceEntry;
  serverTime: string | null;
  statusLabels: Record<string, string>;
  presenceLabels: Record<PresenceState, string>;
}) {
  const hasManualStatus = entry.availabilityStatus === "afk" || entry.availabilityStatus === "ooo";

  /* Determine the secondary text (away duration / last seen) */
  let secondaryText: string | null = null;
  let dotTooltip: string = presenceLabels[entry.presence];

  if (entry.presence === "away") {
    if (hasManualStatus) {
      /* Manual status takes visual precedence — no "Away Xm" */
      dotTooltip = `${presenceLabels.away}`;
    } else {
      const ms = computeDurationMs(entry.awaySince, serverTime);
      const dur = formatDuration(ms);
      secondaryText = `Away ${dur}`;
      dotTooltip = `Away for ${dur}`;
    }
  } else if (entry.presence === "offline") {
    if (entry.lastSeenAt) {
      const ms = computeDurationMs(entry.lastSeenAt, serverTime);
      const dur = formatDuration(ms);
      secondaryText = `Last seen ${dur} ago`;
      dotTooltip = `Offline — Last seen ${dur} ago`;
    } else {
      secondaryText = "Never seen";
      dotTooltip = "Offline — Never seen";
    }
  }

  return (
    <li className="wio-entry">
      <Link href={`/people/${entry.id}`} className="wio-entry-link">
        <EntryAvatar entry={entry} dotTooltip={dotTooltip} />
        <span className="wio-entry-info">
          <span className="wio-name" title={entry.fullName}>
            {entry.fullName}
          </span>
          {hasManualStatus ? (
            <StatusBadge entry={entry} statusLabels={statusLabels} />
          ) : null}
          {secondaryText && !hasManualStatus ? (
            <span className="wio-secondary-text">{secondaryText}</span>
          ) : null}
          {/* Offline + manual status: show both badge and last seen */}
          {entry.presence === "offline" && hasManualStatus && secondaryText ? (
            <span className="wio-secondary-text">{secondaryText}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/* Chevron SVG shared between sections */
function ChevronIcon({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <svg
      className={`wio-chevron${isOpen ? " wio-chevron-open" : ""}${className ? ` ${className}` : ""}`}
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
  );
}

/* ── Main component ── */

type WhoIsOnlineProps = {
  isSidebarCollapsed: boolean;
};

export function WhoIsOnline({ isSidebarCollapsed }: WhoIsOnlineProps) {
  const t = useTranslations("presence");
  const { entries, counts, serverTime, isLoading } = usePresence(true);
  const [isActiveExpanded, setIsActiveExpanded] = useState(true);
  const [isOfflineExpanded, setIsOfflineExpanded] = useState(false);

  /* Re-render every 60s to keep durations fresh between API polls */
  const [, setTick] = useState(0);
  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const presenceLabels = useMemo<Record<PresenceState, string>>(() => ({
    online: t("state.online"),
    away: t("state.away"),
    offline: t("state.offline"),
  }), [t]);

  const statusLabels = useMemo<Record<string, string>>(() => ({
    afk: t("status.afk"),
    ooo: t("status.ooo"),
  }), [t]);

  const activeEntries = useMemo(
    () => entries.filter((e) => e.presence === "online" || e.presence === "away"),
    [entries]
  );

  const offlineEntries = useMemo(
    () => entries.filter((e) => e.presence === "offline"),
    [entries]
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
      {/* ── Active section header ── */}
      <button
        type="button"
        className="wio-header"
        onClick={() => setIsActiveExpanded((prev) => !prev)}
        aria-expanded={isActiveExpanded}
      >
        <span className="wio-header-left">
          <span className="wio-header-dot" />
          <span className="wio-header-label">{t("header")}</span>
        </span>
        <span className="wio-header-right">
          <span className="wio-count-badge">{activeCount}</span>
          <ChevronIcon isOpen={isActiveExpanded} />
        </span>
      </button>

      {/* ── Active entries list ── */}
      {isActiveExpanded ? (
        <ul className="wio-list">
          {activeEntries.length === 0 ? (
            <li className="wio-empty">{t("empty")}</li>
          ) : (
            activeEntries.map((entry) => (
              <PresenceEntryRow
                key={entry.id}
                entry={entry}
                serverTime={serverTime}
                statusLabels={statusLabels}
                presenceLabels={presenceLabels}
              />
            ))
          )}
        </ul>
      ) : null}

      {/* ── Offline section (collapsed by default) ── */}
      {offlineEntries.length > 0 ? (
        <>
          <button
            type="button"
            className="wio-offline-header"
            onClick={() => setIsOfflineExpanded((prev) => !prev)}
            aria-expanded={isOfflineExpanded}
          >
            <span className="wio-offline-header-left">
              <ChevronIcon isOpen={isOfflineExpanded} />
              <span>{t("offlineSection", { count: counts.offline })}</span>
            </span>
          </button>

          {isOfflineExpanded ? (
            <ul className="wio-list wio-list-offline">
              {offlineEntries.map((entry) => (
                <PresenceEntryRow
                  key={entry.id}
                  entry={entry}
                  serverTime={serverTime}
                  statusLabels={statusLabels}
                  presenceLabels={presenceLabels}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
