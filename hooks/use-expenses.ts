"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

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

async function fetchExpenses(endpoint: string, signal: AbortSignal): Promise<ExpensesListResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as ExpensesListResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load expenses.");
  }

  return payload.data;
}

async function fetchExpenseApprovals(
  endpoint: string,
  signal: AbortSignal
): Promise<ExpenseApprovalsResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as ExpenseApprovalsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load expense approvals.");
  }

  return payload.data;
}

async function fetchExpenseReports(
  endpoint: string,
  signal: AbortSignal
): Promise<ExpenseReportsResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as ExpenseReportsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load expense reports.");
  }

  return payload.data;
}

export function useExpenses(query: ExpensesQuery = {}): UseFetchState<ExpensesListResponseData> {
  const endpoint = useMemo(
    () =>
      buildExpensesUrl({
        status: query.status,
        month: query.month
      }),
    [query.month, query.status]
  );

  const queryResult = useQuery({
    queryKey: ["expenses", query.status ?? "all", query.month ?? "all"],
    queryFn: ({ signal }) => fetchExpenses(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}

export function useExpenseApprovals(
  query: ExpenseApprovalsQuery = {}
): UseFetchState<ExpenseApprovalsResponseData> {
  const month = query.month;
  const stage = query.stage;
  const endpoint = useMemo(() => buildApprovalsUrl({ month, stage }), [month, stage]);

  const queryResult = useQuery({
    queryKey: ["expense-approvals", month ?? "all", stage ?? "all"],
    queryFn: ({ signal }) => fetchExpenseApprovals(endpoint, signal),
    staleTime: 90 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
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

  const endpoint = useMemo(
    () => buildReportsUrl({ month, country, department, status, category }),
    [month, country, department, status, category]
  );

  const queryResult = useQuery({
    queryKey: [
      "expense-reports",
      month ?? "all",
      country ?? "all",
      department ?? "all",
      status ?? "all",
      category ?? "all"
    ],
    queryFn: ({ signal }) => fetchExpenseReports(endpoint, signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh
  };
}
