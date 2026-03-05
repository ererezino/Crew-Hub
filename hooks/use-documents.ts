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

function buildDocumentsUrl({ scope = "all", category }: UseDocumentsOptions): string {
  const searchParams = new URLSearchParams();
  searchParams.set("scope", scope);

  if (category) {
    searchParams.set("category", category);
  }

  return `/api/v1/documents?${searchParams.toString()}`;
}

export function useDocuments(options: UseDocumentsOptions = {}): UseDocumentsResult {
  const scope = options.scope ?? "all";
  const category = options.category;

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildDocumentsUrl({
        scope,
        category
      }),
    [category, scope]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const fetchDocuments = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as DocumentsResponse;

        if (!response.ok || !payload.data) {
          setDocuments([]);
          setErrorMessage(payload.error?.message ?? "Unable to load documents.");
          return;
        }

        setDocuments(payload.data.documents);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDocuments([]);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load documents.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchDocuments();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentValue) => currentValue + 1);
  }, []);

  return {
    documents,
    isLoading,
    errorMessage,
    refresh,
    setDocuments
  };
}
