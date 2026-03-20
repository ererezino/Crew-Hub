import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { buildMeta, canApprovePayroll, jsonResponse } from "../_helpers";

/** Finance Oversight API — dedicated endpoint for the /payroll/oversight page.
 *
 *  Returns cycle-level oversight data aligned with the semimonthly model:
 *  - Cycles awaiting approval (submitted status)
 *  - Active cycles in progress (approved/ready/processing)
 *  - Completed cycles (paid) for recent runs
 *  - Payout blockers (flagged items)
 *  - Historical runs needing review/authorize/publish
 */

const oversightCycleSchema = z.object({
  id: z.string(),
  payroll_run_id: z.string(),
  label: z.string().nullable(),
  cycle_number: z.number().int().nullable().optional(),
  status: z.string(),
  total_net: z.union([z.number(), z.string()]),
  currency: z.string(),
  target_pay_date: z.string().nullable(),
  submitted_at: z.string().nullable().optional(),
  submitted_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  paid_at: z.string().nullable().optional(),
  employee_count: z.number().int()
});

export type OversightCycleSummary = {
  id: string;
  runId: string;
  label: string | null;
  cycleNumber: number | null;
  status: string;
  totalNet: number;
  currency: string;
  targetPayDate: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  paidAt: string | null;
  employeeCount: number;
  payPeriod: string;
};

export type OversightFlaggedRun = {
  runId: string;
  payPeriod: string;
  flaggedCount: number;
};

export type OversightHistoricalRun = {
  id: string;
  payPeriod: string;
  nextStep: "review" | "authorize" | "publish";
};

export type FinanceOversightResponseData = {
  cyclesAwaitingApproval: OversightCycleSummary[];
  activeCycles: OversightCycleSummary[];
  recentlyPaidCycles: OversightCycleSummary[];
  payoutBlockers: OversightFlaggedRun[];
  historicalAwaitingAction: OversightHistoricalRun[];
};

function parseAmount(value: string | number | unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

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
    const supabase = await createSupabaseServerClient();

    const [
      submittedCyclesResult,
      activeCyclesResult,
      recentlyPaidResult,
      flaggedItemsResult,
      historicalRunsResult
    ] = await Promise.all([
      // 1. Cycles awaiting approval (submitted)
      supabase
        .from("payroll_cycles")
        .select("id, payroll_run_id, label, cycle_number, status, total_net, currency, target_pay_date, submitted_at, submitted_by, approved_at, approved_by, paid_at, employee_count, payroll_runs!inner(pay_period_start, pay_period_end)")
        .eq("org_id", orgId)
        .eq("status", "submitted")
        .is("deleted_at", null)
        .order("submitted_at", { ascending: false })
        .limit(20),

      // 2. Active cycles (approved/ready/processing)
      supabase
        .from("payroll_cycles")
        .select("id, payroll_run_id, label, cycle_number, status, total_net, currency, target_pay_date, submitted_at, submitted_by, approved_at, approved_by, paid_at, employee_count, payroll_runs!inner(pay_period_start, pay_period_end)")
        .eq("org_id", orgId)
        .in("status", ["approved", "ready", "processing"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),

      // 3. Recently paid cycles (last 10)
      supabase
        .from("payroll_cycles")
        .select("id, payroll_run_id, label, cycle_number, status, total_net, currency, target_pay_date, submitted_at, submitted_by, approved_at, approved_by, paid_at, employee_count, payroll_runs!inner(pay_period_start, pay_period_end)")
        .eq("org_id", orgId)
        .eq("status", "paid")
        .is("deleted_at", null)
        .order("paid_at", { ascending: false })
        .limit(10),

      // 4. Flagged items (payout blockers)
      supabase
        .from("payroll_items")
        .select("payroll_run_id")
        .eq("org_id", orgId)
        .eq("flagged", true)
        .is("deleted_at", null),

      // 5. Historical runs needing review/authorize/publish
      supabase
        .from("payroll_runs")
        .select("id, pay_period_start, pay_period_end, reviewed_at, authorized_at, published_at")
        .eq("org_id", orgId)
        .eq("is_historical", true)
        .is("deleted_at", null)
        .or("reviewed_at.is.null,authorized_at.is.null,published_at.is.null")
        .order("created_at", { ascending: false })
        .limit(10)
    ]);

    // Collect actor IDs for name resolution
    const actorIds = new Set<string>();
    for (const result of [submittedCyclesResult, activeCyclesResult, recentlyPaidResult]) {
      for (const row of result.data ?? []) {
        if (row.submitted_by) actorIds.add(row.submitted_by as string);
        if (row.approved_by) actorIds.add(row.approved_by as string);
      }
    }

    const actorNameById = new Map<string, string>();
    if (actorIds.size > 0) {
      const { data: actors } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", orgId)
        .in("id", [...actorIds]);

      for (const a of actors ?? []) {
        actorNameById.set(a.id, a.full_name);
      }
    }

    function mapCycles(rows: unknown[]): OversightCycleSummary[] {
      return rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        const runData = row.payroll_runs as { pay_period_start?: string; pay_period_end?: string } | null;
        const period = runData?.pay_period_end ?? runData?.pay_period_start ?? "";

        return {
          id: row.id as string,
          runId: row.payroll_run_id as string,
          label: (row.label as string) ?? null,
          cycleNumber: (row.cycle_number as number) ?? null,
          status: row.status as string,
          totalNet: parseAmount(row.total_net),
          currency: (row.currency as string) ?? "USD",
          targetPayDate: (row.target_pay_date as string) ?? null,
          submittedAt: (row.submitted_at as string) ?? null,
          submittedByName: row.submitted_by ? actorNameById.get(row.submitted_by as string) ?? null : null,
          approvedAt: (row.approved_at as string) ?? null,
          approvedByName: row.approved_by ? actorNameById.get(row.approved_by as string) ?? null : null,
          paidAt: (row.paid_at as string) ?? null,
          employeeCount: (row.employee_count as number) ?? 0,
          payPeriod: period as string
        };
      });
    }

    const cyclesAwaitingApproval = mapCycles(submittedCyclesResult.data ?? []);
    const activeCycles = mapCycles(activeCyclesResult.data ?? []);
    const recentlyPaidCycles = mapCycles(recentlyPaidResult.data ?? []);

    // Payout blockers: aggregate flags per run, only include active runs
    const payoutBlockers: OversightFlaggedRun[] = [];
    if (flaggedItemsResult.data) {
      const flagsByRun = new Map<string, number>();
      for (const row of flaggedItemsResult.data) {
        const runId = row.payroll_run_id as string;
        flagsByRun.set(runId, (flagsByRun.get(runId) ?? 0) + 1);
      }

      // Get active run IDs from cycles
      const activeRunIds = new Set<string>([
        ...cyclesAwaitingApproval.map((c) => c.runId),
        ...activeCycles.map((c) => c.runId)
      ]);

      for (const [runId, count] of flagsByRun) {
        if (activeRunIds.has(runId)) {
          payoutBlockers.push({ runId, payPeriod: "", flaggedCount: count });
        }
      }
    }

    // Historical runs
    const historicalAwaitingAction: OversightHistoricalRun[] = [];
    if (historicalRunsResult.data) {
      for (const row of historicalRunsResult.data) {
        const period = (row.pay_period_end ?? row.pay_period_start ?? "") as string;
        let nextStep: "review" | "authorize" | "publish" = "review";
        if (row.reviewed_at && !row.authorized_at) nextStep = "authorize";
        else if (row.reviewed_at && row.authorized_at && !row.published_at) nextStep = "publish";
        else if (row.reviewed_at && row.authorized_at && row.published_at) continue;

        historicalAwaitingAction.push({
          id: row.id as string,
          payPeriod: period,
          nextStep
        });
      }
    }

    const responseData: FinanceOversightResponseData = {
      cyclesAwaitingApproval,
      activeCycles,
      recentlyPaidCycles,
      payoutBlockers,
      historicalAwaitingAction
    };

    return jsonResponse<FinanceOversightResponseData>(200, {
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
