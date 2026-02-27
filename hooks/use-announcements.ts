"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type { Announcement, AnnouncementsResponse } from "../types/announcements";

type UseAnnouncementsOptions = {
  limit?: number;
};

type UseAnnouncementsResult = {
  announcements: Announcement[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setAnnouncements: Dispatch<SetStateAction<Announcement[]>>;
};

function buildAnnouncementsUrl(limit?: number): string {
  if (!limit) {
    return "/api/v1/announcements";
  }

  const params = new URLSearchParams({
    limit: String(limit)
  });

  return `/api/v1/announcements?${params.toString()}`;
}

export function useAnnouncements({ limit }: UseAnnouncementsOptions = {}): UseAnnouncementsResult {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildAnnouncementsUrl(limit), [limit]);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAnnouncements = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          signal: abortController.signal
        });

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
