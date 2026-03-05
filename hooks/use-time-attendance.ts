"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  TimeAttendanceApprovalsResponse,
  TimeAttendanceApprovalsResponseData,
  TimeAttendanceEntriesResponse,
  TimeAttendanceEntriesResponseData,
  TimeAttendanceOverviewResponse,
  TimeAttendanceOverviewResponseData,
  TimeAttendancePoliciesResponse,
  TimeAttendancePoliciesResponseData
} from "../types/time-attendance";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type EntriesQuery = {
  scope?: "mine" | "team";
  employeeId?: string;
  startDate?: string;
  endDate?: string;
};

type ApprovalsQuery = {
  status?: "pending" | "submitted" | "approved" | "rejected" | "locked";
};

function buildEntriesEndpoint(query: EntriesQuery): string {
  const searchParams = new URLSearchParams();

  if (query.scope) {
    searchParams.set("scope", query.scope);
  }

  if (query.employeeId) {
    searchParams.set("employeeId", query.employeeId);
  }

  if (query.startDate) {
    searchParams.set("startDate", query.startDate);
  }

  if (query.endDate) {
    searchParams.set("endDate", query.endDate);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0
    ? `/api/v1/time-attendance/entries?${queryString}`
    : "/api/v1/time-attendance/entries";
}

function buildApprovalsEndpoint(query: ApprovalsQuery): string {
  const searchParams = new URLSearchParams();

  if (query.status) {
    searchParams.set("status", query.status);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0
    ? `/api/v1/time-attendance/approvals?${queryString}`
    : "/api/v1/time-attendance/approvals";
}

export function useTimeAttendanceOverview(weekStart?: string): UseFetchState<TimeAttendanceOverviewResponseData> {
  const [data, setData] = useState<TimeAttendanceOverviewResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => {
    if (!weekStart) {
      return "/api/v1/time-attendance/overview";
    }

    const searchParams = new URLSearchParams({ weekStart });
    return `/api/v1/time-attendance/overview?${searchParams.toString()}`;
  }, [weekStart]);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as TimeAttendanceOverviewResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load attendance overview.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load attendance overview.");
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

export function useTimeAttendanceEntries(query: EntriesQuery = {}): UseFetchState<TimeAttendanceEntriesResponseData> {
  const [data, setData] = useState<TimeAttendanceEntriesResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildEntriesEndpoint({
        scope: query.scope,
        employeeId: query.employeeId,
        startDate: query.startDate,
        endDate: query.endDate
      }),
    [query.employeeId, query.endDate, query.scope, query.startDate]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as TimeAttendanceEntriesResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load time entries.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load time entries.");
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

export function useTimeAttendanceApprovals(query: ApprovalsQuery = {}): UseFetchState<TimeAttendanceApprovalsResponseData> {
  const [data, setData] = useState<TimeAttendanceApprovalsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildApprovalsEndpoint({
        status: query.status
      }),
    [query.status]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as TimeAttendanceApprovalsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load approvals.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load approvals.");
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

export function useTimeAttendancePolicies(): UseFetchState<TimeAttendancePoliciesResponseData> {
  const [data, setData] = useState<TimeAttendancePoliciesResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/time-attendance/policies", abortController.signal);

        const payload = (await response.json()) as TimeAttendancePoliciesResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load attendance policies.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load attendance policies.");
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
