"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData
} from "@tanstack/react-query";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  PersonRecord,
  PeopleListResponse,
  PeopleListResponseData
} from "../types/people";

type PeopleScope = "all" | "reports" | "me";

/**
 * Historical full-list limit (also the server-side maximum page size). It is
 * the largest `limit` the API accepts in a single request — NOT a cap on how
 * many people a consumer can load. Callers that need the entire org use
 * {@link useAllPeople}, which pages through every record.
 */
export const PEOPLE_FULL_LIST_LIMIT = 250;

/** Default page size for the paginated directory view. */
export const PEOPLE_PAGE_SIZE = 50;

/**
 * Hard ceiling on pages accumulated by {@link accumulatePeoplePages}. Acts as
 * a circuit-breaker so a misbehaving server that always returns `hasMore`
 * cannot spin forever. At {@link PEOPLE_PAGE_SIZE} this allows 50k people —
 * far above any real org — so it never truncates legitimate data.
 */
const PEOPLE_ACCUMULATE_MAX_PAGES = 1000;

type UsePeopleOptions = {
  scope?: PeopleScope;
  enabled?: boolean;
  initialData?: PeopleListResponseData;
  /** Page size sent to the API. Defaults to the full list (250). */
  limit?: number;
};

type UsePeopleResult = {
  people: PersonRecord[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setPeople: Dispatch<SetStateAction<PersonRecord[]>>;
};

function buildPeopleUrl(scope: PeopleScope, limit: number, offset = 0): string {
  const searchParams = new URLSearchParams({
    scope,
    limit: String(limit)
  });

  if (offset > 0) {
    searchParams.set("offset", String(offset));
  }

  return `/api/v1/people?${searchParams.toString()}`;
}

async function fetchPeople(
  endpoint: string,
  signal: AbortSignal
): Promise<PeopleListResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as PeopleListResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load people.");
  }

  return payload.data;
}

export function usePeople(options: UsePeopleOptions = {}): UsePeopleResult {
  const scope = options.scope ?? "all";
  const enabled = options.enabled ?? true;
  const limit = options.limit ?? PEOPLE_FULL_LIST_LIMIT;
  const endpoint = useMemo(() => buildPeopleUrl(scope, limit), [scope, limit]);
  const queryKey = useMemo(() => ["people", scope, limit] as const, [scope, limit]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchPeople(endpoint, signal),
    initialData: options.initialData,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const setPeople: Dispatch<SetStateAction<PersonRecord[]>> = useCallback(
    (value) => {
      queryClient.setQueryData<PeopleListResponseData>(queryKey, (currentData) => {
        const currentPeople = currentData?.people ?? [];
        const nextPeople =
          typeof value === "function"
            ? (value as (previousValue: PersonRecord[]) => PersonRecord[])(currentPeople)
            : value;

        return {
          people: nextPeople,
          total: currentData?.total ?? nextPeople.length,
          hasMore: currentData?.hasMore ?? false
        };
      });
    },
    [queryClient, queryKey]
  );

  return {
    people: query.data?.people ?? [],
    isLoading: enabled && query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh,
    setPeople
  };
}

/* ── Accumulating (whole-org) variant for pickers/grids/dropdowns ── */

/**
 * Page-fetching function used by {@link accumulatePeoplePages}. Given an
 * `offset`, returns one page of data (people + total + hasMore).
 */
type PeoplePageFetcher = (offset: number) => Promise<PeopleListResponseData>;

/**
 * Accumulate EVERY page of people by walking offsets until the server reports
 * no more records. This is the core of {@link useAllPeople}: it removes the
 * historical 250 ceiling for consumers that genuinely need the whole org
 * (org chart, manager/approver pickers, scheduling grids, signer dropdowns).
 *
 * Pure and React-free so the pagination-advance logic is unit-testable: pass
 * any `fetchPage` and a `pageSize`, get back the fully-accumulated list plus
 * the final `total`.
 */
export async function accumulatePeoplePages(
  fetchPage: PeoplePageFetcher,
  pageSize: number
): Promise<PeopleListResponseData> {
  const people: PersonRecord[] = [];
  let total = 0;
  let offset = 0;

  for (let page = 0; page < PEOPLE_ACCUMULATE_MAX_PAGES; page += 1) {
    const data = await fetchPage(offset);
    people.push(...data.people);
    total = data.total;

    // Stop when the server says there's nothing left, or when a page comes
    // back short/empty (defensive: avoids an infinite loop if `hasMore` is
    // ever wrong while the page itself is not full).
    if (!data.hasMore || data.people.length === 0 || data.people.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return { people, total: total || people.length, hasMore: false };
}

type UseAllPeopleOptions = {
  scope?: PeopleScope;
  enabled?: boolean;
  /** First page fetched server-side; seeds the cache for a fast first paint. */
  initialData?: PeopleListResponseData;
  /** Page size used while walking the list. Defaults to the directory size. */
  pageSize?: number;
};

/**
 * Fetch the COMPLETE people list for a scope, paging through every record so
 * no one is silently omitted past the API's per-request maximum. Use this for
 * any consumer that needs everyone (pickers, dropdowns, org chart, scheduling
 * roster). For the browsable directory prefer {@link usePeopleInfinite}, which
 * loads pages on demand instead of all at once.
 */
export function useAllPeople(options: UseAllPeopleOptions = {}): UsePeopleResult {
  const scope = options.scope ?? "all";
  const enabled = options.enabled ?? true;
  const pageSize = options.pageSize ?? PEOPLE_PAGE_SIZE;
  const queryKey = useMemo(
    () => ["people", "all", scope, pageSize] as const,
    [scope, pageSize]
  );
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      accumulatePeoplePages(
        (offset) => fetchPeople(buildPeopleUrl(scope, pageSize, offset), signal),
        pageSize
      ),
    initialData: options.initialData,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const setPeople: Dispatch<SetStateAction<PersonRecord[]>> = useCallback(
    (value) => {
      queryClient.setQueryData<PeopleListResponseData>(queryKey, (currentData) => {
        const currentPeople = currentData?.people ?? [];
        const nextPeople =
          typeof value === "function"
            ? (value as (previousValue: PersonRecord[]) => PersonRecord[])(currentPeople)
            : value;

        return {
          people: nextPeople,
          total: currentData?.total ?? nextPeople.length,
          hasMore: false
        };
      });
    },
    [queryClient, queryKey]
  );

  return {
    people: query.data?.people ?? [],
    isLoading: enabled && query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh,
    setPeople
  };
}

/* ── Paginated (infinite) variant for the People directory ── */

type UsePeopleInfiniteOptions = {
  scope?: PeopleScope;
  enabled?: boolean;
  /** First page fetched server-side, used to render the initial HTML. */
  initialData?: PeopleListResponseData;
  pageSize?: number;
};

type UsePeopleInfiniteResult = UsePeopleResult & {
  /** Total number of people in the current scope (across all pages). */
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
};

type PeopleInfiniteData = InfiniteData<PeopleListResponseData, number>;

function countLoadedPeople(pages: readonly PeopleListResponseData[]): number {
  return pages.reduce((sum, page) => sum + page.people.length, 0);
}

export function usePeopleInfinite(
  options: UsePeopleInfiniteOptions = {}
): UsePeopleInfiniteResult {
  const scope = options.scope ?? "all";
  const enabled = options.enabled ?? true;
  const pageSize = options.pageSize ?? PEOPLE_PAGE_SIZE;
  const queryKey = useMemo(
    () => ["people", "infinite", scope, pageSize] as const,
    [scope, pageSize]
  );
  const queryClient = useQueryClient();

  const initialData = options.initialData;

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      fetchPeople(buildPeopleUrl(scope, pageSize, pageParam), signal),
    initialPageParam: 0,
    // Compute the next offset from how many records are actually loaded so
    // optimistic cache edits (setPeople) cannot desync pagination.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? countLoadedPeople(allPages) : undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [0] }
      : undefined,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const people = useMemo(
    () => query.data?.pages.flatMap((page) => page.people) ?? [],
    [query.data]
  );

  const lastPage = query.data?.pages[query.data.pages.length - 1];

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const setPeople: Dispatch<SetStateAction<PersonRecord[]>> = useCallback(
    (value) => {
      queryClient.setQueryData<PeopleInfiniteData>(queryKey, (currentData) => {
        const currentPages = currentData?.pages ?? [];
        const currentPeople = currentPages.flatMap((page) => page.people);
        const nextPeople =
          typeof value === "function"
            ? (value as (previousValue: PersonRecord[]) => PersonRecord[])(currentPeople)
            : value;
        const lastLoadedPage = currentPages[currentPages.length - 1];

        // Collapse the loaded pages into a single page holding the updated
        // list. `getNextPageParam` derives the next offset from the loaded
        // count, so "Load more" keeps working after the edit.
        return {
          pages: [
            {
              people: nextPeople,
              total: lastLoadedPage?.total ?? nextPeople.length,
              hasMore: lastLoadedPage?.hasMore ?? false
            }
          ],
          pageParams: [0]
        };
      });
    },
    [queryClient, queryKey]
  );

  return {
    people,
    total: lastPage?.total ?? people.length,
    hasMore: lastPage?.hasMore ?? false,
    isLoading: enabled && query.isPending && !query.data,
    isLoadingMore: query.isFetchingNextPage,
    loadMore,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh,
    setPeople
  };
}
