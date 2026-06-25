import "server-only";

import { z } from "zod";

import { createSupabaseServiceRoleClient } from "../supabase/service-role";

/**
 * Scheduling-safe identity resolution (SCHED-01).
 *
 * Profile RLS deliberately lets an ordinary employee SELECT only their own
 * profile, so enriching a roster/calendar through the authenticated client
 * renders every *other* assignee as "Unknown". This module is the single,
 * narrow chokepoint that resolves the minimum identity fields the scheduling
 * surfaces need — `id`, `full_name`, `department`, `country_code` — for an
 * EXACT set of employee IDs that authorization has *already* produced from
 * RLS-filtered shift/schedule rows.
 *
 * Safety contract (do not weaken):
 *   - IDs must be derived server-side from already-authorized rows, never from
 *     raw user input — this is not an arbitrary employee-lookup endpoint.
 *   - The lookup is constrained by org_id (tenant boundary), deleted_at IS NULL
 *     (no leaking departed staff), and the exact ID list.
 *   - Only the four scheduling-safe fields are projected. Never email,
 *     compensation, or personal details.
 */

export type SchedulingIdentity = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
};

const identityRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

/** The exact, minimal column projection this resolver is allowed to read. */
export const SCHEDULING_IDENTITY_COLUMNS = "id, full_name, department, country_code" as const;

/**
 * Resolve scheduling-safe identities for an already-authorized set of employee
 * IDs within a single organization. Returns a Map keyed by employee id.
 * Throws if the underlying query fails or returns an unexpected shape, so the
 * caller can fail closed rather than silently degrade names to null.
 */
export async function resolveSchedulingIdentities(
  employeeIds: ReadonlyArray<string | null | undefined>,
  orgId: string
): Promise<Map<string, SchedulingIdentity>> {
  const uniqueIds = [
    ...new Set(employeeIds.filter((value): value is string => typeof value === "string" && value.length > 0))
  ];

  const identities = new Map<string, SchedulingIdentity>();

  if (uniqueIds.length === 0) {
    return identities;
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(SCHEDULING_IDENTITY_COLUMNS)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", uniqueIds);

  if (error) {
    throw new Error("Unable to resolve scheduling identities.");
  }

  const parsed = z.array(identityRowSchema).safeParse(data ?? []);

  if (!parsed.success) {
    throw new Error("Scheduling identity data is not in the expected shape.");
  }

  for (const row of parsed.data) {
    identities.set(row.id, {
      id: row.id,
      fullName: row.full_name,
      department: row.department,
      countryCode: row.country_code
    });
  }

  return identities;
}
