"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useTimeOffSummary(query: SummaryQuery = {}): UseFetchState<TimeOffSummaryResponseData> {
  const year = query.year;
  const month = query.month;

  const [data, setData] = useState<TimeOffSummaryResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildSummaryUrl({
        year,
        month
      }),
    [month, year]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);
        const payload = (await response.json()) as TimeOffSummaryResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load time off summary.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load time off summary.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

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

export function useTimeOffApprovals(): UseFetchState<TimeOffApprovalsResponseData> {
  const [data, setData] = useState<TimeOffApprovalsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildApprovalsUrl(), []);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as TimeOffApprovalsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load leave approvals.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load leave approvals.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

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

export function useTimeOffCalendar(query: CalendarQuery = {}): UseFetchState<TimeOffCalendarResponseData> {
  const [data, setData] = useState<TimeOffCalendarResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildCalendarUrl({
        month: query.month,
        countryCode: query.countryCode,
        department: query.department
      }),
    [query.countryCode, query.department, query.month]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as TimeOffCalendarResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load time off calendar.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load time off calendar.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

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

export function useAfkLogs(): UseFetchState<AfkLogsResponseData> {
  const [data, setData] = useState<AfkLogsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/time-off/afk", abortController.signal);

        const payload = (await response.json()) as AfkLogsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load AFK logs.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load AFK logs.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

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
