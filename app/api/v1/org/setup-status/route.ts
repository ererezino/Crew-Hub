import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { normalizeUserRoles } from "../../../../../lib/navigation";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ── */

type SetupItem = {
  id: string;
  label: string;
  completed: boolean;
  href: string;
};

type SetupStatusData = {
  items: SetupItem[];
  completed_count: number;
  total_count: number;
};

/* ── Helpers ── */

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * Safely checks whether a table has any rows for the given org_id.
 * Wraps in try-catch so tables that do not exist yet resolve to `completed: false`.
 */
async function safeCountCheck(
  supabase: SupabaseClient,
  table: string,
  orgId: string,
  id: string,
  label: string,
  href: string
): Promise<SetupItem> {
  try {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("deleted_at", null);
    return { id, label, completed: (count ?? 0) > 0, href };
  } catch {
    return { id, label, completed: false, href };
  }
}

/* ── Main handler ── */

export async function GET() {
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
    const roles = normalizeUserRoles(profile.roles);

    if (!hasRole(roles, "SUPER_ADMIN")) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "Super admin access required." },
        meta: buildMeta()
      });
    }

    const orgId = profile.org_id;
    const supabase = createSupabaseServiceRoleClient();

    const checks = await Promise.all([
      // 1. Add first employee (more than just the admin)
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .then(({ count }) => ({
          id: "add_employee",
          label: "Add first employee",
          completed: (count ?? 0) > 1,
          href: "/people"
        })),

      // 2. Configure departments (check if any profile has a department set)
      safeCountCheck(supabase, "departments", orgId, "configure_departments", "Configure departments", "/settings"),

      // 3. Set up leave policy
      safeCountCheck(supabase, "leave_policies", orgId, "leave_policy", "Set up leave policy", "/time-off"),

      // 4. Upload first document
      safeCountCheck(supabase, "documents", orgId, "document_template", "Upload first document", "/documents"),

      // 5. Set up compliance policy
      safeCountCheck(supabase, "compliance_policies", orgId, "compliance_policy", "Set up compliance policy", "/compliance"),

      // 6. Configure payroll (check if any payroll run exists)
      safeCountCheck(supabase, "payroll_runs", orgId, "payroll_settings", "Configure payroll", "/payroll"),

      // 7. Create onboarding template
      safeCountCheck(supabase, "onboarding_templates", orgId, "onboarding_template", "Create onboarding template", "/onboarding"),

      // 8. Add company announcement
      safeCountCheck(supabase, "announcements", orgId, "announcement", "Add company announcement", "/announcements"),

      // 9. Invite a team member (more than 2 profiles means someone was invited)
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .then(({ count }) => ({
          id: "invite_member",
          label: "Invite a team member",
          completed: (count ?? 0) > 2,
          href: "/people"
        })),

      // 10. Complete org profile (name AND logo_url must be set)
      supabase
        .from("orgs")
        .select("name, logo_url")
        .eq("id", orgId)
        .single()
        .then(({ data }) => ({
          id: "org_profile",
          label: "Complete organization profile",
          completed: !!(data?.name && data?.logo_url),
          href: "/settings"
        }))
    ]);

    const completedCount = checks.filter((c) => c.completed).length;

    return jsonResponse<SetupStatusData>(200, {
      data: {
        items: checks,
        completed_count: completedCount,
        total_count: checks.length
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Unexpected error checking setup status."
      },
      meta: buildMeta()
    });
  }
}
