"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  ExpenseApprovalStage,
  ExpenseApprovalsResponse,
  ExpenseApprovalsResponseData,
  ExpenseReportsResponse,
  ExpenseReportsResponseData,
  ExpensesListResponse,
  ExpensesListResponseData,
  ExpenseStatus
} from "../types/expenses";

type UseFetchState<T> = {
  data: T | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

type ExpensesQuery = {
  status?: ExpenseStatus;
  month?: string;
};

type ExpenseApprovalsQuery = {
  month?: string;
  stage?: ExpenseApprovalStage;
};

type ExpenseReportsQuery = {
  month?: string;
  country?: string;
  department?: string;
  status?: string;
  category?: string;
};

function buildExpensesUrl(query: ExpensesQuery): string {
  const searchParams = new URLSearchParams();

  if (query.status) {
    searchParams.set("status", query.status);
  }

  if (query.month) {
    searchParams.set("month", query.month);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `/api/v1/expenses?${queryString}` : "/api/v1/expenses";
}

function buildApprovalsUrl(query: ExpenseApprovalsQuery): string {
  const searchParams = new URLSearchParams();

  if (query.month) {
    searchParams.set("month", query.month);
  }

  if (query.stage) {
    searchParams.set("stage", query.stage);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0
    ? `/api/v1/expenses/approvals?${queryString}`
    : "/api/v1/expenses/approvals";
}

function buildReportsUrl(query: ExpenseReportsQuery): string {
  const searchParams = new URLSearchParams();

  if (query.month) {
    searchParams.set("month", query.month);
  }

  if (query.country && query.country !== "all") {
    searchParams.set("country", query.country);
  }

  if (query.department && query.department !== "all") {
    searchParams.set("department", query.department);
  }

  if (query.status && query.status !== "all") {
    searchParams.set("status", query.status);
  }

  if (query.category && query.category !== "all") {
    searchParams.set("category", query.category);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0
    ? `/api/v1/expenses/reports?${queryString}`
    : "/api/v1/expenses/reports";
}

export function useExpenses(query: ExpensesQuery = {}): UseFetchState<ExpensesListResponseData> {
  const [data, setData] = useState<ExpensesListResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildExpensesUrl({
        status: query.status,
        month: query.month
      }),
    [query.month, query.status]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as ExpensesListResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load expenses.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load expenses.");
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

export function useExpenseApprovals(
  query: ExpenseApprovalsQuery = {}
): UseFetchState<ExpenseApprovalsResponseData> {
  const month = query.month;
  const stage = query.stage;
  const [data, setData] = useState<ExpenseApprovalsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(() => buildApprovalsUrl({ month, stage }), [month, stage]);

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as ExpenseApprovalsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load expense approvals.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load expense approvals."
        );
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

export function useExpenseReports(
  query: ExpenseReportsQuery = {}
): UseFetchState<ExpenseReportsResponseData> {
  const month = query.month;
  const country = query.country;
  const department = query.department;
  const status = query.status;
  const category = query.category;
  const [data, setData] = useState<ExpenseReportsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () => buildReportsUrl({ month, country, department, status, category }),
    [month, country, department, status, category]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as ExpenseReportsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load expense reports.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load expense reports."
        );
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
