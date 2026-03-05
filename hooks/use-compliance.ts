"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  ComplianceResponse,
  ComplianceResponseData,
  UpdateComplianceDeadlinePayload,
  UpdateComplianceDeadlineResponse
} from "../types/compliance";

type ComplianceQuery = {
  startDate: string;
  endDate: string;
};

type UseComplianceResult = {
  data: ComplianceResponseData | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

function buildComplianceUrl(query: ComplianceQuery): string {
  const searchParams = new URLSearchParams({
    startDate: query.startDate,
    endDate: query.endDate
  });

  return `/api/v1/compliance?${searchParams.toString()}`;
}

export function useCompliance(query: ComplianceQuery): UseComplianceResult {
  const [data, setData] = useState<ComplianceResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildComplianceUrl({
        startDate: query.startDate,
        endDate: query.endDate
      }),
    [query.endDate, query.startDate]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as ComplianceResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load compliance.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load compliance.");
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
    setReloadToken((current) => current + 1);
  }, []);

  return {
    data,
    isLoading,
    errorMessage,
    refresh
  };
}

export async function updateComplianceDeadline({
  deadlineId,
  payload
}: {
  deadlineId: string;
  payload: UpdateComplianceDeadlinePayload;
}): Promise<UpdateComplianceDeadlineResponse> {
  const response = await fetch(`/api/v1/compliance/deadlines/${deadlineId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = (await response.json()) as UpdateComplianceDeadlineResponse;

  if (!response.ok) {
    return {
      data: null,
      error: body.error ?? {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Unable to update compliance deadline."
      },
      meta: body.meta
    };
  }

  return body;
}
