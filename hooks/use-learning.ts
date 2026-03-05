"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  LearningCoursesResponse,
  LearningCoursesResponseData,
  LearningMyAssignmentsResponse,
  LearningMyAssignmentsResponseData,
  LearningReportsResponse,
  LearningReportsResponseData
} from "../types/learning";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type CoursesQuery = {
  includeDraft?: boolean;
  category?: string;
};

type AssignmentsQuery = {
  status?: "assigned" | "in_progress" | "completed" | "overdue" | "failed";
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
  emptyData,
  errorFallback
}: {
  endpoint: string;
  extractor: (payload: TPayload) => TData | null;
  emptyData: TData;
  errorFallback: string;
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
          setErrorMessage(errorFallback);
          return;
        }

        setData(extracted);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(emptyData);
        setErrorMessage(error instanceof Error ? error.message : errorFallback);
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
  }, [emptyData, endpoint, errorFallback, extractor, reloadToken]);

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

export function useLearningCourses(query: CoursesQuery = {}): UseFetchState<LearningCoursesResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/learning/courses", [
        ["includeDraft", query.includeDraft ? "true" : undefined],
        ["category", query.category?.trim() || undefined]
      ]),
    [query.category, query.includeDraft]
  );

  return useDataFetch<LearningCoursesResponse, LearningCoursesResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { courses: [] },
    errorFallback: "Unable to load courses."
  });
}

export function useLearningMyAssignments(
  query: AssignmentsQuery = {}
): UseFetchState<LearningMyAssignmentsResponseData> {
  const endpoint = useMemo(
    () =>
      buildEndpoint("/api/v1/learning/my-assignments", [["status", query.status]]),
    [query.status]
  );

  return useDataFetch<LearningMyAssignmentsResponse, LearningMyAssignmentsResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: { assignments: [] },
    errorFallback: "Unable to load learning assignments."
  });
}

export function useLearningReports(): UseFetchState<LearningReportsResponseData> {
  return useDataFetch<LearningReportsResponse, LearningReportsResponseData>({
    endpoint: "/api/v1/learning/admin/reports",
    extractor: (payload) => payload.data ?? null,
    emptyData: {
      summary: {
        totalAssigned: 0,
        totalInProgress: 0,
        totalCompleted: 0,
        totalOverdue: 0,
        totalFailed: 0,
        completionRatePct: 0
      },
      courses: [],
      overdueAssignments: []
    },
    errorFallback: "Unable to load learning reports."
  });
}
