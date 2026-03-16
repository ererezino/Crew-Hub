"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CrewNightEvent,
  CrewNightResult,
  CrewNightPresenter,
  LeaderboardEntry,
  LeaderboardAdjustment,
  CrewGamesEventsResponse,
  CrewGamesEventDetailResponse,
  CrewGamesLeaderboardResponse
} from "../types/crew-games";

/* ── Fetch helpers ── */

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  const json = await response.json();
  return json as T;
}

/* ── Events hook ── */

export function useCrewGameEvents(eventType?: "games_night" | "presentation_night") {
  const params = new URLSearchParams();
  if (eventType) params.set("type", eventType);

  const endpoint = `/api/v1/crew-games/events?${params.toString()}`;
  const queryKey = ["crew-games-events", eventType ?? "all"] as const;

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchJson<CrewGamesEventsResponse>(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const queryClient = useQueryClient();

  const events = useMemo(() => query.data?.data?.events ?? [], [query.data]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["crew-games-events"] });
  }, [queryClient]);

  return {
    events,
    isLoading: query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh
  };
}

/* ── Event detail hook ── */

export function useCrewGameEventDetail(eventId: string | null) {
  const queryKey = ["crew-games-event-detail", eventId] as const;

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchJson<CrewGamesEventDetailResponse>(
        `/api/v1/crew-games/events/${eventId}`,
        signal
      ),
    enabled: Boolean(eventId),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const queryClient = useQueryClient();

  return {
    event: query.data?.data?.event ?? null,
    results: query.data?.data?.results ?? [],
    presenters: query.data?.data?.presenters ?? [],
    isLoading: query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh: useCallback(() => {
      void queryClient.invalidateQueries({ queryKey });
    }, [queryClient, queryKey])
  };
}

/* ── Leaderboard hook ── */

export function useCrewGamesLeaderboard(season?: string) {
  const currentSeason = season ?? String(new Date().getFullYear());
  const queryKey = ["crew-games-leaderboard", currentSeason] as const;

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchJson<CrewGamesLeaderboardResponse>(
        `/api/v1/crew-games/leaderboard?season=${currentSeason}`,
        signal
      ),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const queryClient = useQueryClient();

  return {
    leaderboard: query.data?.data?.leaderboard ?? [],
    adjustments: query.data?.data?.adjustments ?? [],
    season: query.data?.data?.season ?? currentSeason,
    isLoading: query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh: useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["crew-games-leaderboard"] });
    }, [queryClient])
  };
}

/* ── Mutation helpers ── */

export function useCrewGamesMutations() {
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["crew-games-events"] });
    void queryClient.invalidateQueries({ queryKey: ["crew-games-event-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["crew-games-leaderboard"] });
  }, [queryClient]);

  const createEvent = useCallback(
    async (payload: Record<string, unknown>): Promise<CrewNightEvent | null> => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/v1/crew-games/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "Failed to create event.");
        invalidateAll();
        return json.data?.event ?? null;
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const updateEvent = useCallback(
    async (id: string, payload: Record<string, unknown>): Promise<CrewNightEvent | null> => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/v1/crew-games/events/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "Failed to update event.");
        invalidateAll();
        return json.data?.event ?? null;
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const deleteEvent = useCallback(
    async (id: string): Promise<void> => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/v1/crew-games/events/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message ?? "Failed to delete event.");
        }
        invalidateAll();
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const saveResults = useCallback(
    async (eventId: string, results: Record<string, unknown>[]): Promise<void> => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/v1/crew-games/events/${eventId}/results`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ results })
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message ?? "Failed to save results.");
        }
        invalidateAll();
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const savePresenters = useCallback(
    async (eventId: string, presenters: Record<string, unknown>[]): Promise<void> => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/v1/crew-games/events/${eventId}/presenters`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presenters })
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message ?? "Failed to save presenters.");
        }
        invalidateAll();
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const addAdjustment = useCallback(
    async (payload: {
      employeeId: string;
      pointsDelta: number;
      reason: string;
      season?: string;
    }): Promise<void> => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/v1/crew-games/leaderboard/adjustments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message ?? "Failed to save adjustment.");
        }
        invalidateAll();
      } finally {
        setIsSaving(false);
      }
    },
    [invalidateAll]
  );

  const uploadFile = useCallback(
    async (
      file: File,
      type: "event_image" | "slides",
      path: string
    ): Promise<{ path: string; filename: string } | null> => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("type", type);
      formData.set("path", path);

      const res = await fetch("/api/v1/crew-games/upload", {
        method: "POST",
        body: formData
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Upload failed.");
      return json.data ?? null;
    },
    []
  );

  const deleteFile = useCallback(async (path: string): Promise<void> => {
    const res = await fetch("/api/v1/crew-games/upload", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error?.message ?? "Delete failed.");
    }
  }, []);

  return {
    isSaving,
    createEvent,
    updateEvent,
    deleteEvent,
    saveResults,
    savePresenters,
    addAdjustment,
    uploadFile,
    deleteFile
  };
}
