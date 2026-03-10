"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  AfkLogsResponse,
  AfkLogsResponseData,
  TimeOffApprovalsResponse,
  TimeOffApprovalsResponseData,
  TimeOffCalendarResponse,
  TimeOffCalendarResponseData,
  TimeOffSummaryResponse,
  TimeOffSummaryResponseData
} from "../types/time-off";

type SummaryQuery = {
  year?: number;
  month?: string;
};

type CalendarQuery = {
  month?: string;
  countryCode?: string;
  department?: string;
};

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildSummaryUrl(query: SummaryQuery): string {
  const searchParams = new URLSearchParams();

  if (query.year) {
    searchParams.set("year", String(query.year));
  }

  if (query.month) {
    searchParams.set("month", query.month);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `/api/v1/time-off/summary?${queryString}` : "/api/v1/time-off/summary";
}

function buildApprovalsUrl(): string {
  return "/api/v1/time-off/approvals?status=pending";
}

function buildCalendarUrl(query: CalendarQuery): string {
  const searchParams = new URLSearchParams();

  if (query.month) {
    searchParams.set("month", query.month);
  }

  if (query.countryCode) {
    searchParams.set("countryCode", query.countryCode);
  }

  if (query.department) {
    searchParams.set("department", query.department);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `/api/v1/time-off/calendar?${queryString}` : "/api/v1/time-off/calendar";
}

async function fetchSummary(endpoint: string, signal: AbortSignal): Promise<TimeOffSummaryResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as TimeOffSummaryResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load time off summary.");
  }

  return payload.data;
}

async function fetchApprovals(
  endpoint: string,
  signal: AbortSignal
): Promise<TimeOffApprovalsResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as TimeOffApprovalsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load leave approvals.");
  }

  return payload.data;
}

async function fetchCalendar(
  endpoint: string,
  signal: AbortSignal
): Promise<TimeOffCalendarResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as TimeOffCalendarResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load time off calendar.");
  }

  return payload.data;
}

async function fetchAfkLogs(signal: AbortSignal): Promise<AfkLogsResponseData> {
  const response = await fetchWithRetry("/api/v1/time-off/afk", signal);
  const payload = (await response.json()) as AfkLogsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load AFK logs.");
  }

  return payload.data;
}

export function useTimeOffSummary(query: SummaryQuery = {}): UseFetchState<TimeOffSummaryResponseData> {
  const year = query.year;
  const month = query.month;

  const endpoint = useMemo(
    () =>
      buildSummaryUrl({
        year,
        month
      }),
    [month, year]
  );

  const queryResult = useQuery({
    queryKey: ["time-off-summary", year ?? "current", month ?? "current"],
    queryFn: ({ signal }) => fetchSummary(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}

export function useTimeOffApprovals(): UseFetchState<TimeOffApprovalsResponseData> {
  const endpoint = useMemo(() => buildApprovalsUrl(), []);

  const queryResult = useQuery({
    queryKey: ["time-off-approvals"],
    queryFn: ({ signal }) => fetchApprovals(endpoint, signal),
    staleTime: 90 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}

export function useTimeOffCalendar(query: CalendarQuery = {}): UseFetchState<TimeOffCalendarResponseData> {
  const endpoint = useMemo(
    () =>
      buildCalendarUrl({
        month: query.month,
        countryCode: query.countryCode,
        department: query.department
      }),
    [query.countryCode, query.department, query.month]
  );

  const queryResult = useQuery({
    queryKey: [
      "time-off-calendar",
      query.month ?? "current",
      query.countryCode ?? "all",
      query.department ?? "all"
    ],
    queryFn: ({ signal }) => fetchCalendar(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}

export function useAfkLogs(): UseFetchState<AfkLogsResponseData> {
  const queryResult = useQuery({
    queryKey: ["time-off-afk-logs"],
    queryFn: ({ signal }) => fetchAfkLogs(signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}
