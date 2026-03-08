"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { usePresence, type PresenceEntry, type PresenceState } from "../../hooks/use-presence";

const PRESENCE_LABELS: Record<PresenceState, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline"
};

function PresenceDot({ state }: { state: PresenceState }) {
  return (
    <span
      className={`presence-dot presence-dot-${state}`}
      title={PRESENCE_LABELS[state]}
      aria-label={PRESENCE_LABELS[state]}
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
  const { entries, counts, isLoading } = usePresence(true);
  const [isExpanded, setIsExpanded] = useState(true);

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
      <div className="wio-collapsed" title={`${counts.online} online, ${counts.away} away`}>
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
          <span className="wio-header-label">Who&apos;s Online</span>
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
            <li className="wio-empty">No one online right now</li>
          ) : (
            activeEntries.map((entry) => (
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
                    <PresenceDot state={entry.presence} />
                  </span>
                  <span className="wio-name" title={entry.fullName}>
                    {entry.fullName}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
