"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  LetterheadEntity,
  LetterheadEntityListResponse
} from "../types/travel-support";

type UseLetterheadEntitiesResult = {
  entities: LetterheadEntity[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

export function useLetterheadEntities(): UseLetterheadEntitiesResult {
  const [entities, setEntities] = useState<LetterheadEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchEntities = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry("/api/v1/letterhead-entities", abortController.signal);

        const payload = (await response.json()) as LetterheadEntityListResponse;

        if (!response.ok || !payload.data) {
          setEntities([]);
          setErrorMessage(
            payload.error?.message ?? "Unable to load letterhead entities."
          );
          return;
        }

        setEntities(payload.data.entities);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setEntities([]);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load letterhead entities."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchEntities();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((v) => v + 1);
  }, []);

  return { entities, isLoading, errorMessage, refresh };
}
