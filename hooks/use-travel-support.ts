"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  TravelSupportRequest,
  TravelSupportListResponse
} from "../types/travel-support";

type UseTravelSupportResult = {
  requests: TravelSupportRequest[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

export function useTravelSupport(): UseTravelSupportResult {
  const [requests, setRequests] = useState<TravelSupportRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchRequests = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/travel-support", abortController.signal);

        const payload = (await response.json()) as TravelSupportListResponse;

        if (!response.ok || !payload.data) {
          setRequests([]);
          setErrorMessage(payload.error?.message ?? "Unable to load travel support requests.");
          return;
        }

        setRequests(payload.data.requests);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setRequests([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load travel support requests."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchRequests();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((v) => v + 1);
  }, []);

  return { requests, isLoading, errorMessage, refresh };
}
