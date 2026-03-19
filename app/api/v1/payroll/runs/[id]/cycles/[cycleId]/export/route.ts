import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import type { PayrollCycleApprovalSnapshot } from "../../../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canViewPayroll,
  jsonResponse,
  PAYROLL_CYCLE_SELECT_COLUMNS,
  payrollCycleRowSchema
} from "../../../../../_helpers";

/** GET /api/v1/payroll/runs/[id]/cycles/[cycleId]/export?format=csv
 *
 *  Exports the cycle's **frozen approval snapshot** as CSV.
 *  Per Amendment 2: the snapshot is THE authoritative record —
 *  exports always read from the snapshot, never from live worksheet rows.
 *
 *  The cycle must be in submitted, approved, ready, processing, or paid
 *  status (i.e. a snapshot must exist).
 */

const EXPORTABLE_STATUSES = new Set(["submitted", "approved", "ready", "processing", "paid"]);

function formatCentsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cycleId: string }> }
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
      error: { code: "FORBIDDEN", message: "You are not allowed to export payroll data." },
      meta: buildMeta()
    });
  }

  const url = new URL(request.url);
  const formatResult = z.enum(["csv"]).safeParse(url.searchParams.get("format") ?? "csv");

  if (!formatResult.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Only CSV export is currently supported." },
      meta: buildMeta()
    });
  }

  const { id: runId, cycleId } = await params;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawCycle, error: cycleError } = await supabase
      .from("payroll_cycles")
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("id", cycleId)
      .is("deleted_at", null)
      .maybeSingle();

    if (cycleError || !rawCycle) {
      return jsonResponse<null>(cycleError ? 500 : 404, {
        data: null,
        error: {
          code: cycleError ? "PAYROLL_CYCLE_FETCH_FAILED" : "NOT_FOUND",
          message: "Payout cycle not found."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = payrollCycleRowSchema.safeParse(rawCycle);
    if (!parsedCycle.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_PARSE_FAILED", message: "Payout cycle data is invalid." },
        meta: buildMeta()
      });
    }

    if (!EXPORTABLE_STATUSES.has(parsedCycle.data.status)) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Cycle must be submitted for approval before it can be exported."
        },
        meta: buildMeta()
      });
    }

    // Read from the frozen approval snapshot — THE authoritative record
    const snapshotRaw = parsedCycle.data.approval_snapshot;
    if (!snapshotRaw || typeof snapshotRaw !== "object" || Array.isArray(snapshotRaw)) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "This cycle has no approval snapshot. Submit the cycle first."
        },
        meta: buildMeta()
      });
    }

    const snapshot = snapshotRaw as PayrollCycleApprovalSnapshot;
    const rows = snapshot.rows ?? [];

    // Build CSV
    const headers = [
      "Employee Name",
      "Designation",
      "Department",
      "Accrue Username",
      "Monthly Salary",
      "Cycle Base Amount",
      "Overtime Hours",
      "Overtime Rate",
      "Overtime Amount",
      "Bonus",
      "Fees",
      "Final Payable",
      "Comment",
      "Exception Reason"
    ];

    const csvLines: string[] = [headers.join(",")];

    for (const row of rows) {
      csvLines.push([
        escapeCsvField(row.employeeName),
        escapeCsvField(row.designation),
        escapeCsvField(row.department),
        escapeCsvField(row.accrueUsername),
        formatCentsToDollars(row.monthlySalary),
        formatCentsToDollars(row.cycleBaseAmount),
        String(row.overtimeHours),
        formatCentsToDollars(row.overtimeRate),
        formatCentsToDollars(row.overtimeAmount),
        formatCentsToDollars(row.bonus),
        formatCentsToDollars(row.fees),
        formatCentsToDollars(row.finalPayable),
        escapeCsvField(row.comment),
        escapeCsvField(row.exceptionReason)
      ].join(","));
    }

    // Summary row
    csvLines.push("");
    csvLines.push([
      "TOTALS",
      "", "", "", "",
      formatCentsToDollars(snapshot.totalNet),
      "", "",
      formatCentsToDollars(snapshot.totalOvertime),
      formatCentsToDollars(snapshot.totalBonus),
      formatCentsToDollars(snapshot.totalFees),
      formatCentsToDollars(snapshot.totalNet),
      "", ""
    ].join(","));
    csvLines.push(`Employee Count,${snapshot.employeeCount}`);
    csvLines.push(`Submitted At,${snapshot.submittedAt}`);
    csvLines.push(`Submitted By,${escapeCsvField(snapshot.submittedByName)}`);

    const csvContent = csvLines.join("\n");
    const filename = `${snapshot.cycleLabel.replace(/[^a-zA-Z0-9 -]/g, "").replace(/\s+/g, "_")}_export.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CYCLE_EXPORT_FAILED",
        message: error instanceof Error ? error.message : "Unable to export cycle."
      },
      meta: buildMeta()
    });
  }
}
