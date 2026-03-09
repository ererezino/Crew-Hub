import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { logger } from "../../../../../lib/logger";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * GET /api/v1/me/data-export
 *
 * Exports the authenticated user's personal data as JSON.
 * This supports GDPR/data rights compliance for the launch scope.
 */
export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to export your data."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const userId = session.profile.id;
  const orgId = session.profile.org_id;

  // Collect all user data across tables
  const [
    profileResult,
    leaveRequestsResult,
    leaveBalancesResult,
    documentsResult,
    expensesResult,
    notificationsResult,
    performanceResult
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email, department, title, phone, timezone, country_code, start_date, date_of_birth, employment_type, status, bio, pronouns, created_at")
      .eq("id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("leave_requests")
      .select("leave_type, start_date, end_date, total_days, status, reason, created_at")
      .eq("employee_id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("leave_balances")
      .select("leave_type, year, total_days, used_days, pending_days, carried_days")
      .eq("employee_id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("documents")
      .select("title, category, file_name, created_at")
      .eq("owner_user_id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("expenses")
      .select("description, amount, currency, category, status, created_at")
      .eq("employee_id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("notifications")
      .select("type, title, body, is_read, read_at, created_at")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("review_assignments")
      .select("cycle_id, reviewer_id, status, due_at, created_at")
      .eq("employee_id", userId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
  ]);

  const queryErrors: string[] = [];

  if (profileResult.error) queryErrors.push(`profiles: ${profileResult.error.message}`);
  if (leaveRequestsResult.error) queryErrors.push(`leave_requests: ${leaveRequestsResult.error.message}`);
  if (leaveBalancesResult.error) queryErrors.push(`leave_balances: ${leaveBalancesResult.error.message}`);
  if (documentsResult.error) queryErrors.push(`documents: ${documentsResult.error.message}`);
  if (expensesResult.error) queryErrors.push(`expenses: ${expensesResult.error.message}`);
  if (notificationsResult.error) queryErrors.push(`notifications: ${notificationsResult.error.message}`);
  if (performanceResult.error) queryErrors.push(`review_assignments: ${performanceResult.error.message}`);

  if (queryErrors.length > 0) {
    logger.error("Personal data export failed.", {
      userId,
      orgId,
      queryErrors
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DATA_EXPORT_FAILED",
        message:
          "Unable to complete your data export right now. Please try again or contact support."
      },
      meta: buildMeta()
    });
  }

  if (!profileResult.data) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Profile not found for this account."
      },
      meta: buildMeta()
    });
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: profileResult.data,
    leaveRequests: leaveRequestsResult.data ?? [],
    leaveBalances: leaveBalancesResult.data ?? [],
    documents: documentsResult.data ?? [],
    expenses: expensesResult.data ?? [],
    notifications: notificationsResult.data ?? [],
    performanceReviews: performanceResult.data ?? []
  };

  await logAudit({
    action: "created",
    tableName: "data_exports",
    recordId: userId,
    newValue: { event: "personal_data_export" }
  }).catch(() => undefined);

  return jsonResponse<typeof exportData>(200, {
    data: exportData,
    error: null,
    meta: buildMeta()
  });
}
