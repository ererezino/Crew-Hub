"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type PresenceState = "online" | "away" | "offline";

export type PresenceEntry = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  department: string | null;
  presence: PresenceState;
  lastSeenAt: string | null;
  availabilityStatus: string;
  statusNote: string | null;
};

type PresenceApiResponse = {
  data: {
    entries: PresenceEntry[];
    counts: { online: number; away: number; offline: number };
  } | null;
  error: { code: string; message: string } | null;
};

type UsePresenceResult = {
  entries: PresenceEntry[];
  presenceMap: Map<string, PresenceState>;
  counts: { online: number; away: number; offline: number };
  isLoading: boolean;
};

const POLL_INTERVAL_MS = 30_000;

export function usePresence(enabled: boolean): UsePresenceResult {
  const [entries, setEntries] = useState<PresenceEntry[]>([]);
  const [counts, setCounts] = useState({ online: 0, away: 0, offline: 0 });
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const fetchPresence = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/people/presence", { signal });
      const payload = (await response.json()) as PresenceApiResponse;

      if (response.ok && payload.data) {
        setEntries(payload.data.entries);
        setCounts(payload.data.counts);
      }
    } catch {
      /* swallow — presence is best-effort */
    } finally {
      setHasLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void fetchPresence(controller.signal);

    const intervalId = window.setInterval(() => {
      void fetchPresence(controller.signal);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [enabled, fetchPresence]);

  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceState>();
    for (const entry of entries) {
      map.set(entry.id, entry.presence);
    }
    return map;
  }, [entries]);

  const isLoading = enabled && !hasLoadedOnce;

  return { entries, presenceMap, counts, isLoading };
}
