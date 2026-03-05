import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export type OverlapMember = {
  name: string;
  leaveType: string;
  startDate: string;
  endDate: string;
};

export type OverlapResponseData = {
  overlap: OverlapMember[];
};

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthenticatedSession();

    if (!session?.profile) {
      return jsonResponse<null>(401, {
        data: null,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
        meta: buildMeta()
      });
    }

    const profile = session.profile;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate")
    });

    if (!parsed.success) {
      return jsonResponse<null>(400, {
        data: null,
        error: { code: "INVALID_PARAMS", message: "startDate and endDate are required (YYYY-MM-DD)." },
        meta: buildMeta()
      });
    }

    const { startDate, endDate } = parsed.data;
    const supabase = await createSupabaseServerClient();

    // Find team members in the same department who have overlapping approved/pending leave
    const { data: requests, error } = await supabase
      .from("leave_requests")
      .select("leave_type, start_date, end_date, profiles!inner(full_name, department)")
      .eq("org_id", profile.org_id)
      .neq("employee_id", profile.id)
      .in("status", ["approved", "pending"])
      .lte("start_date", endDate)
      .gte("end_date", startDate)
      .is("deleted_at", null)
      .order("start_date", { ascending: true })
      .limit(10);

    if (error) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "FETCH_FAILED", message: "Unable to check team overlap." },
        meta: buildMeta()
      });
    }

    // Filter to same department only
    const overlap: OverlapMember[] = (requests ?? [])
      .filter((r) => {
        const p = r.profiles as unknown as { full_name: string; department: string | null };
        return p.department && p.department === profile.department;
      })
      .map((r) => {
        const p = r.profiles as unknown as { full_name: string; department: string | null };
        return {
          name: p.full_name,
          leaveType: r.leave_type,
          startDate: r.start_date,
          endDate: r.end_date
        };
      });

    return jsonResponse<OverlapResponseData>(200, {
      data: { overlap },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error."
      },
      meta: buildMeta()
    });
  }
}
