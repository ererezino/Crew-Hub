import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { fetchTimeOffSummaryData } from "../../../../../lib/time-off/fetch-time-off-summary";
import type { ApiResponse } from "../../../../../types/auth";
import type { TimeOffSummaryResponseData } from "../../../../../types/time-off";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view time off data."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid time off query parameters."
      },
      meta: buildMeta()
    });
  }

  try {
    const data = await fetchTimeOffSummaryData(session.profile, parsedQuery.data);

    return jsonResponse<TimeOffSummaryResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIME_OFF_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load time off summary data."
      },
      meta: buildMeta()
    });
  }
}
