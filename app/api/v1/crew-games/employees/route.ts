import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { buildMeta, jsonResponse } from "../_helpers";

type EmployeeOption = {
  id: string;
  fullName: string;
};

/* ── GET /api/v1/crew-games/employees ── */

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", session.profile.org_id)
    .in("status", ["active", "onboarding"])
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .limit(500);

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load employees." },
      meta: buildMeta()
    });
  }

  const employees: EmployeeOption[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    fullName: r.full_name as string
  }));

  return jsonResponse<{ employees: EmployeeOption[] }>(200, {
    data: { employees },
    error: null,
    meta: buildMeta()
  });
}
