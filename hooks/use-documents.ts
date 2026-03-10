"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type { DocumentCategory, DocumentRecord, DocumentsResponse } from "../types/documents";

type DocumentsScope = "all" | "mine";

type UseDocumentsOptions = {
  scope?: DocumentsScope;
  category?: DocumentCategory;
};

type UseDocumentsResult = {
  documents: DocumentRecord[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  setDocuments: Dispatch<SetStateAction<DocumentRecord[]>>;
};

type DocumentsQueryData = {
  documents: DocumentRecord[];
};

function buildDocumentsUrl({ scope = "all", category }: UseDocumentsOptions): string {
  const searchParams = new URLSearchParams();
  searchParams.set("scope", scope);

  if (category) {
    searchParams.set("category", category);
  }

  return `/api/v1/documents?${searchParams.toString()}`;
}

async function fetchDocuments(endpoint: string, signal: AbortSignal): Promise<DocumentsQueryData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as DocumentsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load documents.");
  }

  return payload.data;
}

export function useDocuments(options: UseDocumentsOptions = {}): UseDocumentsResult {
  const scope = options.scope ?? "all";
  const category = options.category;
  const endpoint = useMemo(() => buildDocumentsUrl({ scope, category }), [scope, category]);
  const queryKey = useMemo(() => ["documents", scope, category ?? "all"] as const, [scope, category]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchDocuments(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const setDocuments: Dispatch<SetStateAction<DocumentRecord[]>> = useCallback(
    (value) => {
      queryClient.setQueryData<DocumentsQueryData>(queryKey, (currentData) => {
        const currentDocuments = currentData?.documents ?? [];
        const nextDocuments =
          typeof value === "function"
            ? (value as (previousValue: DocumentRecord[]) => DocumentRecord[])(currentDocuments)
            : value;

        return {
          documents: nextDocuments
        };
      });
    },
    [queryClient, queryKey]
  );

  return {
    documents: query.data?.documents ?? [],
    isLoading: query.isPending && !query.data,
    errorMessage: query.error instanceof Error ? query.error.message : null,
    refresh,
    setDocuments
  };
}
