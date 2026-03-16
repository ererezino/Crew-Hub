import { NextResponse } from "next/server";

import type { ApiResponse, ApiMeta } from "../../../../types/auth";

export function buildMeta(): ApiMeta {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export const CREW_GAMES_ADMIN_ROLES = ["HR_ADMIN", "SUPER_ADMIN"] as const;
