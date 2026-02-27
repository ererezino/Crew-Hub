"use client";

import { useQuery } from "@tanstack/react-query";

import type { AnalyticsResponse, AnalyticsResponseData } from "../types/analytics";

type AnalyticsDateRangeQuery = {
  startDate: string;
  endDate: string;
};

function buildAnalyticsUrl(query: AnalyticsDateRangeQuery): string {
  const searchParams = new URLSearchParams();
  searchParams.set("startDate", query.startDate);
  searchParams.set("endDate", query.endDate);
  return `/api/v1/analytics?${searchParams.toString()}`;
}

async function fetchAnalytics(query: AnalyticsDateRangeQuery): Promise<AnalyticsResponseData> {
  const response = await fetch(buildAnalyticsUrl(query), {
    method: "GET"
  });

  const payload = (await response.json()) as AnalyticsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load analytics.");
  }

  return payload.data;
}

export function useAnalytics(query: AnalyticsDateRangeQuery) {
  return useQuery({
    queryKey: ["analytics", query.startDate, query.endDate],
    queryFn: () => fetchAnalytics(query),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  });
}
