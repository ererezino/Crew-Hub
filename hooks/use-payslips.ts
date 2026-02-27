"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  MePayslipsResponse,
  MePayslipsResponseData
} from "../types/payslips";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildMePayslipsUrl(year: number | null): string {
  if (!year) {
    return "/api/v1/me/payslips";
  }

  const searchParams = new URLSearchParams({
    year: String(year)
  });

  return `/api/v1/me/payslips?${searchParams.toString()}`;
}

export function useMePayslips(year: number | null): UseFetchState<MePayslipsResponseData> {
  const [data, setData] = useState<MePayslipsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildMePayslipsUrl(year), [year]);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as MePayslipsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load payment statements.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load payment statements."
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
