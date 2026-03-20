import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { formatCurrency } from "../../../../../../../../../lib/format-currency";
import { renderPayrollCycleAuditPdf } from "../../../../../../../../../lib/payroll/cycle-audit-pdf";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import type { PayrollCycleApprovalSnapshot } from "../../../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canViewPayroll,
  jsonResponse,
  PAYROLL_CYCLE_SELECT_COLUMNS,
  payrollCycleRowSchema
} from "../../../../../_helpers";

/** GET /api/v1/payroll/runs/[id]/cycles/[cycleId]/export?format=csv|pdf
 *
 *  Exports the cycle's **frozen approval snapshot** as CSV or PDF.
 *  Per Amendment 2: the snapshot is THE authoritative record —
 *  exports always read from the snapshot, never from live worksheet rows.
 *
 *  The cycle must be in submitted, approved, ready, processing, or paid
 *  status (i.e. a snapshot must exist).
 */

const EXPORTABLE_STATUSES = new Set(["submitted", "approved", "ready", "processing", "paid"]);

function formatCentsForCurrency(cents: number, currency: string): string {
  return formatCurrency(cents / 100, currency);
}

function formatSnapshotTotals(
  totals: Record<string, number> | null | undefined,
  fallbackCurrency: string,
  fallbackAmount: number
): string {
  const entries = Object.entries(totals ?? {}).filter(([, amount]) => Number.isFinite(amount) && amount !== 0);

  if (entries.length === 0) {
    return formatCentsForCurrency(fallbackAmount, fallbackCurrency);
  }

  return entries
    .sort((left, right) => right[1] - left[1])
    .map(([currency, amount]) => formatCentsForCurrency(amount, currency))
    .join(" | ");
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
  const formatResult = z.enum(["csv", "pdf"]).safeParse(url.searchParams.get("format") ?? "csv");

  if (!formatResult.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Only CSV and PDF export are currently supported." },
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
    const format = formatResult.data;
    const sanitizedLabel = snapshot.cycleLabel.replace(/[^a-zA-Z0-9 -]/g, "").replace(/\s+/g, "_");

    const { data: orgRow } = await supabase
      .from("orgs")
      .select("name")
      .eq("id", profile.org_id)
      .maybeSingle();

    const companyName =
      orgRow && typeof (orgRow as { name?: unknown }).name === "string"
        ? (orgRow as { name: string }).name
        : "Crew Hub";

    if (format === "pdf") {
      const pdfBytes = await renderPayrollCycleAuditPdf({
        companyName,
        cycleLabel: snapshot.cycleLabel,
        currency: snapshot.currency,
        targetPayDate: parsedCycle.data.target_pay_date,
        submittedAt: snapshot.submittedAt,
        submittedByName: snapshot.submittedByName,
        approvedAt: parsedCycle.data.approved_at ?? null,
        paidAt: parsedCycle.data.paid_at ?? null,
        paymentReference: parsedCycle.data.payment_reference ?? null,
        paymentNote: parsedCycle.data.payment_note ?? null,
        snapshot
      });

      return new Response(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sanitizedLabel}_audit.pdf"`,
          "Cache-Control": "no-store"
        }
      });
    }

    const headers = [
      "Employee Name",
      "Designation",
      "Department",
      "Accrue Username",
      "Currency",
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
        escapeCsvField(row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.monthlySalary, row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.cycleBaseAmount, row.currency ?? snapshot.currency),
        String(row.overtimeHours),
        formatCentsForCurrency(row.overtimeRate, row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.overtimeAmount, row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.bonus, row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.fees, row.currency ?? snapshot.currency),
        formatCentsForCurrency(row.finalPayable, row.currency ?? snapshot.currency),
        escapeCsvField(row.comment),
        escapeCsvField(row.exceptionReason)
      ].join(","));
    }

    // Summary row
    csvLines.push("");
    csvLines.push([
      "TOTALS",
      "", "", "", "", "",
      formatSnapshotTotals(snapshot.totalNetByCurrency, snapshot.currency, snapshot.totalNet),
      "", "",
      formatSnapshotTotals(snapshot.totalOvertimeByCurrency, snapshot.currency, snapshot.totalOvertime),
      formatSnapshotTotals(snapshot.totalBonusByCurrency, snapshot.currency, snapshot.totalBonus),
      formatSnapshotTotals(snapshot.totalFeesByCurrency, snapshot.currency, snapshot.totalFees),
      formatSnapshotTotals(snapshot.totalNetByCurrency, snapshot.currency, snapshot.totalNet),
      "", ""
    ].join(","));
    csvLines.push(`Employee Count,${snapshot.employeeCount}`);
    csvLines.push(`Submitted At,${snapshot.submittedAt}`);
    csvLines.push(`Submitted By,${escapeCsvField(snapshot.submittedByName)}`);

    const csvContent = csvLines.join("\n");

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizedLabel}_export.csv"`,
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
