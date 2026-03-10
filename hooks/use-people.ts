"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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

type PeopleQueryData = {
  people: PersonRecord[];
};

function buildPeopleUrl({ scope = "all" }: UsePeopleOptions): string {
  const searchParams = new URLSearchParams({
    scope
  });

  return `/api/v1/people?${searchParams.toString()}`;
}

async function fetchPeople(endpoint: string, signal: AbortSignal): Promise<PeopleQueryData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as PeopleListResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load people.");
  }

  return payload.data;
}

export function usePeople(options: UsePeopleOptions = {}): UsePeopleResult {
  const scope = options.scope ?? "all";
  const endpoint = useMemo(() => buildPeopleUrl({ scope }), [scope]);
  const queryKey = useMemo(() => ["people", scope] as const, [scope]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchPeople(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const setPeople: Dispatch<SetStateAction<PersonRecord[]>> = useCallback(
    (value) => {
      queryClient.setQueryData<PeopleQueryData>(queryKey, (currentData) => {
        const currentPeople = currentData?.people ?? [];
        const nextPeople =
          typeof value === "function"
            ? (value as (previousValue: PersonRecord[]) => PersonRecord[])(currentPeople)
            : value;

        return {
          people: nextPeople
        };
      });
    },
    [queryClient, queryKey]
  );

  return {
    people: query.data?.people ?? [],
    isLoading: query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh,
    setPeople
  };
}
