"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type { Announcement, AnnouncementsResponse } from "../types/announcements";

type UseAnnouncementsOptions = {
  limit?: number;
  dismissed?: boolean;
};

type UseAnnouncementsResult = {
  announcements: Announcement[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setAnnouncements: Dispatch<SetStateAction<Announcement[]>>;
};

function buildAnnouncementsUrl(limit?: number, dismissed?: boolean): string {
  const params = new URLSearchParams();

  if (limit) {
    params.set("limit", String(limit));
  }

  if (dismissed) {
    params.set("dismissed", "true");
  }

  const qs = params.toString();
  return qs ? `/api/v1/announcements?${qs}` : "/api/v1/announcements";
}

export function useAnnouncements({ limit, dismissed }: UseAnnouncementsOptions = {}): UseAnnouncementsResult {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildAnnouncementsUrl(limit, dismissed), [limit, dismissed]);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAnnouncements = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as AnnouncementsResponse;

        if (!response.ok || !payload.data) {
          setAnnouncements([]);
          setErrorMessage(payload.error?.message ?? "Unable to load announcements.");
          return;
        }

        setAnnouncements(payload.data.announcements);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setAnnouncements([]);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load announcements.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchAnnouncements();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    announcements,
    isLoading,
    errorMessage,
    refresh,
    setAnnouncements
  };
}
