"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  TravelSupportRequest,
  TravelSupportListResponse
} from "../types/travel-support";

type UsePendingTravelRequestsResult = {
  requests: TravelSupportRequest[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

/**
 * Fetches travel support requests that need admin action.
 * HR_ADMIN sees: pending (needs drafting)
 * SUPER_ADMIN sees: pending_signature (needs signing), plus pending for direct approval
 * The component handles filtering by role.
 */
export function usePendingTravelRequests(): UsePendingTravelRequestsResult {
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
        // Fetch all non-terminal requests for admin views
        const response = await fetchWithRetry("/api/v1/travel-support", abortController.signal);

        const payload = (await response.json()) as TravelSupportListResponse;

        if (!response.ok || !payload.data) {
          setRequests([]);
          setErrorMessage(
            payload.error?.message ?? "Unable to load pending travel requests."
          );
          return;
        }

        // Filter to actionable statuses: pending, hr_draft, pending_signature
        const actionable = payload.data.requests.filter(
          (r) => ["pending", "hr_draft", "pending_signature"].includes(r.status)
        );
        setRequests(actionable);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setRequests([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load pending travel requests."
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
