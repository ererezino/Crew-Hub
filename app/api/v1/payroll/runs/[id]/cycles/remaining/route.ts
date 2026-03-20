import { z } from "zod";
import { getAuthenticatedSession } from "../../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../../lib/supabase/server";
import {
  buildMeta,
  canViewPayroll,
  jsonResponse
} from "../../../../_helpers";

const paramsSchema = z.object({ id: z.string().uuid() });

export type EmployeeRemainingEntry = {
  employeeId: string;
  employeeName: string;
  payrollItemId: string;
  netAmount: number;
  disbursed: number;
  remaining: number;
  currency: string;
};

export type RemainingResponseData = {
  entries: EmployeeRemainingEntry[];
};

function toInt(value: number | string | unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!canViewPayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You are not allowed to view payout data." },
      meta: buildMeta()
    });
  }

  const rawParams = await params;
  const parsed = paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid run ID." },
      meta: buildMeta()
    });
  }
  const { id: runId } = parsed.data;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    // Load payroll items with employee names
    const { data: rawItems, error: itemsError } = await supabase
      .from("payroll_items")
      .select("id, employee_id, net_amount, pay_currency, profiles!inner(full_name)")
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null);

    if (itemsError || !rawItems || rawItems.length === 0) {
      return jsonResponse<RemainingResponseData>(200, {
        data: { entries: [] },
        error: null,
        meta: buildMeta()
      });
    }

    // Get active (non-cancelled) cycle IDs
    const { data: activeCycleRows } = await supabase
      .from("payroll_cycles")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    const activeCycleIds = (activeCycleRows ?? []).map((c: { id: string }) => c.id);

    // Sum already-disbursed amounts per payroll item
    const disbursedByItem = new Map<string, number>();
    if (activeCycleIds.length > 0) {
      const { data: existingCycleItems } = await supabase
        .from("payroll_cycle_items")
        .select("payroll_item_id, disbursement_amount")
        .in("payroll_cycle_id", activeCycleIds)
        .is("deleted_at", null);

      for (const ci of existingCycleItems ?? []) {
        const prev = disbursedByItem.get(ci.payroll_item_id) ?? 0;
        disbursedByItem.set(ci.payroll_item_id, prev + toInt(ci.disbursement_amount));
      }
    }

    const entries: EmployeeRemainingEntry[] = rawItems.map((item: Record<string, unknown>) => {
      const net = toInt(item.net_amount);
      const disbursed = disbursedByItem.get(item.id as string) ?? 0;
      const remaining = Math.max(0, net - disbursed);
      const profileData = item.profiles as { full_name: string } | null;

      return {
        employeeId: item.employee_id as string,
        employeeName: profileData?.full_name ?? "Unknown",
        payrollItemId: item.id as string,
        netAmount: net,
        disbursed,
        remaining,
        currency: (item.pay_currency as string) ?? "USD"
      };
    });

    // Sort by employee name
    entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return jsonResponse<RemainingResponseData>(200, {
      data: { entries },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REMAINING_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load remaining amounts."
      },
      meta: buildMeta()
    });
  }
}
