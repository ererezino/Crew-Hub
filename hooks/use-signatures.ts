"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import {
  type SignatureRequestRecord,
  type SignatureRequestStatus,
  type SignaturesResponse
} from "../types/esignatures";

type SignatureScope = "all" | "mine";

type UseSignaturesOptions = {
  scope?: SignatureScope;
  status?: SignatureRequestStatus;
};

type UseSignaturesResult = {
  requests: SignatureRequestRecord[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setRequests: Dispatch<SetStateAction<SignatureRequestRecord[]>>;
};

function buildSignaturesUrl({ scope = "mine", status }: UseSignaturesOptions): string {
  const searchParams = new URLSearchParams();
  searchParams.set("scope", scope);

  if (status) {
    searchParams.set("status", status);
  }

  return `/api/v1/signatures?${searchParams.toString()}`;
}

export function useSignatures(options: UseSignaturesOptions = {}): UseSignaturesResult {
  const scope = options.scope ?? "mine";
  const status = options.status;

  const [requests, setRequests] = useState<SignatureRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildSignaturesUrl({
        scope,
        status
      }),
    [scope, status]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const fetchRequests = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as SignaturesResponse;

        if (!response.ok || !payload.data) {
          setRequests([]);
          setErrorMessage(payload.error?.message ?? "Unable to load signatures.");
          return;
        }

        setRequests(payload.data.requests);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setRequests([]);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load signatures.");
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
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    requests,
    isLoading,
    errorMessage,
    refresh,
    setRequests
  };
}
