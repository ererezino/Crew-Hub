"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  SurveyAdminListResponse,
  SurveyAdminListResponseData,
  SurveyDetailResponse,
  SurveyDetailResponseData,
  SurveyPendingListResponse,
  SurveyPendingListResponseData,
  SurveyRecord,
  SurveyResultsResponse,
  SurveyResultsResponseData
} from "../types/surveys";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildFallbackSurvey(): SurveyRecord {
  return {
    id: "",
    orgId: "",
    title: "",
    description: null,
    type: "engagement",
    questions: [],
    isAnonymous: true,
    minResponsesForResults: 0,
    targetAudience: {
      departments: [],
      employmentTypes: [],
      countries: []
    },
    status: "draft",
    startDate: null,
    endDate: null,
    recurrence: null,
    createdBy: null,
    createdByName: null,
    createdAt: "",
    updatedAt: "",
    responseCount: 0,
    hasResponded: false
  };
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
        const response = await fetch(endpoint, {
          method: "GET",
          signal: abortController.signal
        });

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

export function usePendingSurveys(): UseFetchState<SurveyPendingListResponseData> {
  return useDataFetch<SurveyPendingListResponse, SurveyPendingListResponseData>({
    endpoint: "/api/v1/surveys",
    extractor: (payload) => payload.data ?? null,
    emptyData: { surveys: [] },
    errorFallback: "Unable to load pending surveys."
  });
}

export function useAdminSurveys(): UseFetchState<SurveyAdminListResponseData> {
  return useDataFetch<SurveyAdminListResponse, SurveyAdminListResponseData>({
    endpoint: "/api/v1/surveys?mode=admin",
    extractor: (payload) => payload.data ?? null,
    emptyData: { surveys: [] },
    errorFallback: "Unable to load surveys."
  });
}

export function useSurveyDetail(surveyId: string): UseFetchState<SurveyDetailResponseData> {
  const endpoint = useMemo(() => `/api/v1/surveys/${surveyId}`, [surveyId]);

  return useDataFetch<SurveyDetailResponse, SurveyDetailResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: {
      survey: buildFallbackSurvey(),
      hasResponded: false,
      responseId: null
    },
    errorFallback: "Unable to load survey detail."
  });
}

export function useSurveyResults(surveyId: string): UseFetchState<SurveyResultsResponseData> {
  const endpoint = useMemo(() => `/api/v1/surveys/${surveyId}/results`, [surveyId]);

  return useDataFetch<SurveyResultsResponse, SurveyResultsResponseData>({
    endpoint,
    extractor: (payload) => payload.data ?? null,
    emptyData: {
      survey: buildFallbackSurvey(),
      totalResponses: 0,
      minResponsesForResults: 0,
      hasMinimumResponses: false,
      message: null,
      questionResults: []
    },
    errorFallback: "Unable to load survey results."
  });
}
