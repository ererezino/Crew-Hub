"use client";

import { useQuery } from "@tanstack/react-query";

import type { AnalyticsResponse, AnalyticsResponseData } from "../types/analytics";

export type AnalyticsQuery = {
  startDate: string;
  endDate: string;
  country?: string;
  department?: string;
};

function buildAnalyticsUrl(query: AnalyticsQuery): string {
  const searchParams = new URLSearchParams();
  searchParams.set("startDate", query.startDate);
  searchParams.set("endDate", query.endDate);

  if (query.country && query.country !== "all") {
    searchParams.set("country", query.country);
  }

  if (query.department && query.department !== "all") {
    searchParams.set("department", query.department);
  }

  return `/api/v1/analytics?${searchParams.toString()}`;
}

async function fetchAnalytics(query: AnalyticsQuery): Promise<AnalyticsResponseData> {
  const response = await fetch(buildAnalyticsUrl(query), {
    method: "GET"
  });

  const payload = (await response.json()) as AnalyticsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load analytics.");
  }

  return payload.data;
}

export function useAnalytics(query: AnalyticsQuery) {
  return useQuery({
    queryKey: ["analytics", query.startDate, query.endDate, query.country ?? "all", query.department ?? "all"],
    queryFn: () => fetchAnalytics(query),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  });
}
