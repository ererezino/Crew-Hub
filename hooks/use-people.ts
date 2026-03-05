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
import type { PersonRecord, PeopleListResponse } from "../types/people";

type PeopleScope = "all" | "reports" | "me";

type UsePeopleOptions = {
  scope?: PeopleScope;
};

type UsePeopleResult = {
  people: PersonRecord[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setPeople: Dispatch<SetStateAction<PersonRecord[]>>;
};

function buildPeopleUrl({ scope = "all" }: UsePeopleOptions): string {
  const searchParams = new URLSearchParams({
    scope
  });

  return `/api/v1/people?${searchParams.toString()}`;
}

export function usePeople(options: UsePeopleOptions = {}): UsePeopleResult {
  const scope = options.scope ?? "all";

  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildPeopleUrl({
        scope
      }),
    [scope]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const fetchPeople = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as PeopleListResponse;

        if (!response.ok || !payload.data) {
          setPeople([]);
          setErrorMessage(payload.error?.message ?? "Unable to load people.");
          return;
        }

        setPeople(payload.data.people);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setPeople([]);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load people.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchPeople();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    people,
    isLoading,
    errorMessage,
    refresh,
    setPeople
  };
}
