"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  PayrollRunDetailResponse,
  PayrollRunDetailResponseData,
  PayrollRunsDashboardResponse,
  PayrollRunsDashboardResponseData
} from "../types/payroll-runs";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildRunDetailEndpoint(runId: string | null): string | null {
  if (!runId) {
    return null;
  }

  return `/api/v1/payroll/runs/${runId}`;
}

export function usePayrollRunsDashboard(
  enabled = true
): UseFetchState<PayrollRunsDashboardResponseData> {
  const [data, setData] = useState<PayrollRunsDashboardResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setErrorMessage(null);
      setData(null);
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/payroll/runs", abortController.signal);

        const payload = (await response.json()) as PayrollRunsDashboardResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load payroll runs.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load payroll runs.");
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
  }, [enabled, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}

export function usePayrollRunDetail({
  runId,
  enabled = true
}: {
  runId: string | null;
  enabled?: boolean;
}): UseFetchState<PayrollRunDetailResponseData> {
  const [data, setData] = useState<PayrollRunDetailResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildRunDetailEndpoint(runId), [runId]);

  useEffect(() => {
    if (!enabled || !endpoint) {
      setIsLoading(false);
      setErrorMessage(null);
      setData(null);
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as PayrollRunDetailResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load payroll run details.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load payroll run details."
        );
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
  }, [enabled, endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}
