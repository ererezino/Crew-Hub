"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  CalibrationResponse,
  CalibrationResponseData,
  GoalsListResponse,
  GoalsListResponseData,
  PerformanceAdminResponse,
  PerformanceAdminResponseData,
  PerformanceOverviewResponse,
  PerformanceOverviewResponseData
} from "../types/performance";

type UseFetchResult<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

export function usePerformanceOverview(): UseFetchResult<PerformanceOverviewResponseData> {
  const [data, setData] = useState<PerformanceOverviewResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/performance/overview", abortController.signal);
        const payload = (await response.json()) as PerformanceOverviewResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load performance overview.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load performance overview.");
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    void load();
    return () => { abortController.abort(); };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return { data, isLoading, errorMessage, refresh };
}

export function usePerformanceAdmin(): UseFetchResult<PerformanceAdminResponseData> {
  const [data, setData] = useState<PerformanceAdminResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/performance/admin", abortController.signal);
        const payload = (await response.json()) as PerformanceAdminResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load performance admin data.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load performance admin data.");
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    void load();
    return () => { abortController.abort(); };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return { data, isLoading, errorMessage, refresh };
}

// ── Goals ──

type GoalsQuery = {
  employeeId?: string;
  status?: string;
  cycleId?: string;
};

function buildGoalsUrl(query: GoalsQuery): string {
  const searchParams = new URLSearchParams();

  if (query.employeeId) searchParams.set("employeeId", query.employeeId);
  if (query.status && query.status !== "all") searchParams.set("status", query.status);
  if (query.cycleId) searchParams.set("cycleId", query.cycleId);

  const qs = searchParams.toString();
  return qs.length > 0 ? `/api/v1/performance/goals?${qs}` : "/api/v1/performance/goals";
}

export function useGoals(query: GoalsQuery = {}): UseFetchResult<GoalsListResponseData> {
  const [data, setData] = useState<GoalsListResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () => buildGoalsUrl(query),
    [query.employeeId, query.status, query.cycleId]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);
        const payload = (await response.json()) as GoalsListResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load goals.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load goals.");
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    void load();
    return () => { abortController.abort(); };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return { data, isLoading, errorMessage, refresh };
}

// ── Calibration ──

type CalibrationQuery = {
  cycleId?: string;
  department?: string;
  country?: string;
};

function buildCalibrationUrl(query: CalibrationQuery): string {
  const searchParams = new URLSearchParams();

  if (query.cycleId) searchParams.set("cycleId", query.cycleId);
  if (query.department && query.department !== "all") searchParams.set("department", query.department);
  if (query.country && query.country !== "all") searchParams.set("country", query.country);

  const qs = searchParams.toString();
  return qs.length > 0
    ? `/api/v1/performance/calibration?${qs}`
    : "/api/v1/performance/calibration";
}

export function useCalibration(query: CalibrationQuery = {}): UseFetchResult<CalibrationResponseData> {
  const [data, setData] = useState<CalibrationResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () => buildCalibrationUrl(query),
    [query.cycleId, query.department, query.country]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);
        const payload = (await response.json()) as CalibrationResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load calibration data.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load calibration data.");
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    void load();
    return () => { abortController.abort(); };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return { data, isLoading, errorMessage, refresh };
}
