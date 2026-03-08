import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const VALID_ROLES = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
] as const;

const putSchema = z.object({
  role: z.enum(VALID_ROLES),
  modules: z.array(z.string().max(100)).max(50)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function isSuperAdmin(roles: unknown): boolean {
  return Array.isArray(roles) && roles.includes("SUPER_ADMIN");
}

/* ── GET: Fetch role module config for the org ── */
export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!isSuperAdmin(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only super admins can view role permissions." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rows, error } = await supabase
    .from("role_module_config")
    .select("role, enabled_modules")
    .eq("org_id", session.profile.org_id);

  if (error) {
    /* Table may not exist yet — return empty so client uses defaults */
    return jsonResponse<{ configs: { role: string; modules: string[] }[] }>(200, {
      data: { configs: [] },
      error: null,
      meta: buildMeta()
    });
  }

  const configs = (rows ?? []).map((row) => ({
    role: row.role as string,
    modules: (row.enabled_modules ?? []) as string[]
  }));

  return jsonResponse<{ configs: { role: string; modules: string[] }[] }>(200, {
    data: { configs },
    error: null,
    meta: buildMeta()
  });
}

/* ── PUT: Update module config for a specific role ── */
export async function PUT(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!isSuperAdmin(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only super admins can update role permissions." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid request."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("role_module_config")
    .upsert(
      {
        org_id: session.profile.org_id,
        role: parsed.data.role,
        enabled_modules: parsed.data.modules,
        updated_at: new Date().toISOString(),
        updated_by: session.profile.id
      },
      { onConflict: "org_id,role" }
    );

  if (error) {
    console.error("Failed to save role module config:", error.message);
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to save role configuration." },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ saved: boolean }>(200, {
    data: { saved: true },
    error: null,
    meta: buildMeta()
  });
}
