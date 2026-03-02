"use client";

import { useQuery } from "@tanstack/react-query";

import type { DashboardResponse, DashboardResponseData } from "../types/dashboard";

async function fetchDashboard(): Promise<DashboardResponseData> {
  const response = await fetch("/api/v1/dashboard", { method: "GET" });
  const payload = (await response.json()) as DashboardResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load dashboard.");
  }

  return payload.data;
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true
  });
}
