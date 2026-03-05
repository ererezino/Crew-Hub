"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  SchedulingSchedulesResponse,
  SchedulingSchedulesResponseData,
  SchedulingShiftsResponse,
  SchedulingShiftsResponseData,
  SchedulingSwapsResponse,
  SchedulingSwapsResponseData,
  SchedulingTemplatesResponse,
  SchedulingTemplatesResponseData
} from "../types/scheduling";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type SchedulesQuery = {
  scope?: "mine" | "team";
  status?: "draft" | "published" | "locked";
  weekStart?: string;
  weekEnd?: string;
};

type ShiftsQuery = {
  scope?: "mine" | "team" | "open";
  scheduleId?: string;
  startDate?: string;
  endDate?: string;
};

type SwapsQuery = {
  scope?: "mine" | "team";
  status?: "pending" | "accepted" | "rejected" | "cancelled";
};

function buildEndpoint(basePath: string, entries: Array<[string, string | undefined]>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of entries) {
    if (!value) {
      continue;
    }

    searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return query.length > 0 ? `${basePath}?${query}` : basePath;
}

function useDataFetch<TPayload, TData>({
  endpoint,
  extractor,
  emptyData
}: {
  endpoint: string;
  extractor: (payload: TPayload) => TData | null;
  emptyData: TData;
}): UseFetchState<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const run = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);
        const payload = (await response.json()) as TPayload;
        const extracted = extractor(payload);

        if (!response.ok || !extracted) {
          setData(emptyData);
          setErrorMessage("Unable to load scheduling data.");
          return;
        }

        setData(extracted);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(emptyData);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load scheduling data.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      abortController.abort();
    };
  }, [emptyData, endpoint, extractor, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}

export function useSchedulingSchedules(query: SchedulesQuery = {}): UseFetchState<SchedulingSchedulesResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/scheduling/schedules", [
        ["scope", query.scope],
        ["status", query.status],
        ["weekStart", query.weekStart],
        ["weekEnd", query.weekEnd]
      ]),
    [query.scope, query.status, query.weekEnd, query.weekStart]
  );

  return useDataFetch<SchedulingSchedulesResponse, SchedulingSchedulesResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { schedules: [] }
  });
}

export function useSchedulingShifts(query: ShiftsQuery = {}): UseFetchState<SchedulingShiftsResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/scheduling/shifts", [
        ["scope", query.scope],
        ["scheduleId", query.scheduleId],
        ["startDate", query.startDate],
        ["endDate", query.endDate]
      ]),
    [query.endDate, query.scheduleId, query.scope, query.startDate]
  );

  return useDataFetch<SchedulingShiftsResponse, SchedulingShiftsResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { shifts: [] }
  });
}

export function useOpenShifts(query: Omit<ShiftsQuery, "scope" | "scheduleId"> = {}): UseFetchState<SchedulingShiftsResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/scheduling/shifts/open", [
        ["startDate", query.startDate],
        ["endDate", query.endDate]
      ]),
    [query.endDate, query.startDate]
  );

  return useDataFetch<SchedulingShiftsResponse, SchedulingShiftsResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { shifts: [] }
  });
}

export function useSchedulingSwaps(query: SwapsQuery = {}): UseFetchState<SchedulingSwapsResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/scheduling/swaps", [
        ["scope", query.scope],
        ["status", query.status]
      ]),
    [query.scope, query.status]
  );

  return useDataFetch<SchedulingSwapsResponse, SchedulingSwapsResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { swaps: [] }
  });
}

export function useSchedulingTemplates(): UseFetchState<SchedulingTemplatesResponseData> {
  return useDataFetch<SchedulingTemplatesResponse, SchedulingTemplatesResponseData>({
    endpoint: "/api/v1/scheduling/templates",
    extractor: (payload) => payload.data ?? null,
    emptyData: { templates: [] }
  });
}
