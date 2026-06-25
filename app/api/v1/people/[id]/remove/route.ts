import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logger } from "../../../../../../lib/logger";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

/**
 * POST /api/v1/people/[id]/remove
 *
 * Quick removal for someone who left without going through the full offboarding
 * route (sacked / abandoned / historical). In one deliberate, admin-only action
 * it:
 *   1. auto-completes offboarding — cancels any active onboarding instance and
 *      marks any active offboarding instance completed, so no workflow is left
 *      dangling;
 *   2. sets the profile to `inactive`;
 *   3. ARCHIVES the record (soft-delete) so it disappears from the People list
 *      and every other view, while remaining in the database and recoverable;
 *   4. REVOKES access — signs them out everywhere and bans the auth account so
 *      they can neither sign in again nor be accidentally re-invited (the invite
 *      route ignores archived profiles) until an admin explicitly restores them.
 *
 * This bypasses the notice-period date gate and the "all offboarding tasks
 * complete" gate that the normal finalise-offboarding flow enforces.
 */

const REMOVAL_REASONS = [
  "termination",
  "resignation",
  "redundancy",
  "contract_end",
  "abandoned",
  "historical_cleanup",
  "other"
] as const;

const removePayloadSchema = z.object({
  // Typing the name guards against accidental removal of the wrong person.
  confirmName: z.string().trim().min(1, "You must type the employee name to confirm."),
  reason: z.enum(REMOVAL_REASONS).optional(),
  note: z.string().trim().max(500).optional()
});

// Effectively permanent ban (~100 years); restoring clears it.
const PERMANENT_BAN_DURATION = "876000h";

type RemoveResponseData = {
  profileId: string;
  status: "inactive";
  archived: true;
  accessRevoked: boolean;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!hasRole(profile.roles, "SUPER_ADMIN") && !hasRole(profile.roles, "HR_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin and HR Admin can remove people from Crew Hub."
      },
      meta: buildMeta()
    });
  }

  const { id: employeeId } = await context.params;

  if (employeeId === profile.id) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "CANNOT_REMOVE_SELF", message: "You cannot remove your own account." },
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

  const parsed = removePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid removal payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data: employee, error: fetchError } = await serviceClient
    .from("profiles")
    .select("id, full_name, status, org_id")
    .eq("id", employeeId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !employee) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Employee not found (they may already be removed)." },
      meta: buildMeta()
    });
  }

  if (!namesMatch(parsed.data.confirmName, employee.full_name as string)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "NAME_MISMATCH",
        message: "The name you typed does not match this employee. Removal cancelled."
      },
      meta: buildMeta()
    });
  }

  const nowIso = new Date().toISOString();

  // 1) Auto-complete workflows: cancel active onboarding, complete active offboarding.
  await serviceClient
    .from("onboarding_instances")
    .update({ status: "cancelled", updated_at: nowIso })
    .eq("employee_id", employeeId)
    .eq("org_id", profile.org_id)
    .eq("type", "onboarding")
    .eq("status", "active");

  await serviceClient
    .from("onboarding_instances")
    .update({ status: "completed", completed_at: nowIso, updated_at: nowIso })
    .eq("employee_id", employeeId)
    .eq("org_id", profile.org_id)
    .eq("type", "offboarding")
    .eq("status", "active");

  // 2 & 3) Deactivate + archive (soft-delete) the profile.
  const { error: updateError } = await serviceClient
    .from("profiles")
    .update({ status: "inactive", deleted_at: nowIso, updated_at: nowIso })
    .eq("id", employeeId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "REMOVE_FAILED", message: "Unable to remove this employee." },
      meta: buildMeta()
    });
  }

  // 4) Revoke access: sign out everywhere (best-effort) + ban the auth account
  // so they can neither sign in nor be re-invited until explicitly restored.
  // The profile is already archived even if these auth-admin calls hiccup.
  await serviceClient.auth.admin.signOut(employeeId, "global").catch(() => undefined);

  let accessRevoked = true;

  try {
    const { error: banError } = await serviceClient.auth.admin.updateUserById(employeeId, {
      ban_duration: PERMANENT_BAN_DURATION
    });
    if (banError) {
      accessRevoked = false;
      logger.error("Quick-remove: failed to ban the auth account.", {
        employeeId,
        message: banError.message
      });
    }
  } catch (error) {
    accessRevoked = false;
    logger.error("Quick-remove: ban call threw.", {
      employeeId,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "profiles",
    recordId: employeeId,
    oldValue: { status: employee.status, deleted_at: null },
    newValue: {
      status: "inactive",
      deleted_at: nowIso,
      removal: "quick_remove",
      reason: parsed.data.reason ?? null,
      note: parsed.data.note ?? null,
      access_revoked: accessRevoked
    }
  }).catch(() => undefined);

  return jsonResponse<RemoveResponseData>(200, {
    data: { profileId: employeeId, status: "inactive", archived: true, accessRevoked },
    error: null,
    meta: buildMeta()
  });
}
