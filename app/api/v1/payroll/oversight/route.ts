import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { fetchFinanceOversight } from "../../../../../lib/dashboard/fetch-dashboard-data";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { FinanceOversightData } from "../../../../../types/dashboard";
import { buildMeta, canApprovePayroll, jsonResponse } from "../_helpers";

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!canApprovePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You are not allowed to view finance oversight." },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const responseData = await fetchFinanceOversight(supabase, orgId);

    return jsonResponse<FinanceOversightData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OVERSIGHT_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load finance oversight data."
      },
      meta: buildMeta()
    });
  }
}
