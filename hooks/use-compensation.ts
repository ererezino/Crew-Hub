"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AdminCompensationResponse,
  AdminCompensationResponseData,
  MeCompensationResponse,
  MeCompensationResponseData
} from "../types/compensation";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type AdminCompensationOptions = {
  employeeId: string | null;
  enabled?: boolean;
};

function buildAdminCompensationUrl(employeeId: string | null): string {
  if (!employeeId) {
    return "/api/v1/compensation/admin";
  }

  const params = new URLSearchParams({ employeeId });
  return `/api/v1/compensation/admin?${params.toString()}`;
}

export function useMeCompensation(
  enabled = true
): UseFetchState<MeCompensationResponseData> {
  const [data, setData] = useState<MeCompensationResponseData | null>(null);
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
        const response = await fetch("/api/v1/compensation/me", {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as MeCompensationResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load compensation data.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load compensation data.");
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
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}

export function useAdminCompensation({
  employeeId,
  enabled = true
}: AdminCompensationOptions): UseFetchState<AdminCompensationResponseData> {
  const [data, setData] = useState<AdminCompensationResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildAdminCompensationUrl(employeeId), [employeeId]);

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
        const response = await fetch(endpoint, {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as AdminCompensationResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load compensation admin data.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load compensation admin data.");
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
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}
