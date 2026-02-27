import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { countryNameFromCode } from "../../../../../../../lib/countries";
import {
  DOCUMENT_BUCKET_NAME,
  sanitizeFileName
} from "../../../../../../../lib/documents";
import { renderPaymentStatementPdf } from "../../../../../../../lib/payroll/payment-statement-pdf";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type {
  GeneratePayslipsResponseData,
  GeneratePayslipsResultItem
} from "../../../../../../../types/payslips";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  payrollAdjustmentSchema,
  payrollDeductionSchema,
  payrollRunRowSchema
} from "../../../_helpers";

export const runtime = "nodejs";

const payrollItemRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  gross_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  base_salary_amount: z.union([z.number(), z.string()]),
  allowances: z.unknown(),
  adjustments: z.unknown(),
  deductions: z.unknown(),
  net_amount: z.union([z.number(), z.string()]),
  withholding_applied: z.boolean(),
  payment_reference: z.string().nullable()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  title: z.string().nullable(),
  country_code: z.string().nullable()
});

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function toPeriodValue(payPeriodEnd: string): string {
  return payPeriodEnd.slice(0, 7);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to generate payment statements."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can generate payment statements."
      },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYSLIP_GENERATION_FAILED",
          message: "Unable to load payroll run."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(rawRun);

    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll run was not found."
        },
        meta: buildMeta()
      });
    }

    if (parsedRun.data.status !== "approved") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Payment statements can only be generated after final approval."
        },
        meta: buildMeta()
      });
    }

    const { data: rawItems, error: itemsError } = await supabase
      .from("payroll_items")
      .select(
        "id, employee_id, org_id, gross_amount, currency, base_salary_amount, allowances, adjustments, deductions, net_amount, withholding_applied, payment_reference"
      )
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYSLIP_GENERATION_FAILED",
          message: "Unable to load payroll items."
        },
        meta: buildMeta()
      });
    }

    const parsedItems = z.array(payrollItemRowSchema).safeParse(rawItems ?? []);

    if (!parsedItems.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYSLIP_GENERATION_FAILED",
          message: "Payroll item data is invalid."
        },
        meta: buildMeta()
      });
    }

    if (parsedItems.data.length === 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Payroll run has no items to generate statements for."
        },
        meta: buildMeta()
      });
    }

    const employeeIds = [...new Set(parsedItems.data.map((row) => row.employee_id))];

    const [{ data: rawProfiles, error: profilesError }, { data: orgRow, error: orgError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, department, title, country_code")
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .in("id", employeeIds),
        supabase
          .from("orgs")
          .select("name")
          .eq("id", session.profile.org_id)
          .maybeSingle()
      ]);

    if (profilesError || orgError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYSLIP_GENERATION_FAILED",
          message: "Unable to resolve statement metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYSLIP_GENERATION_FAILED",
          message: "Employee profile metadata is invalid."
        },
        meta: buildMeta()
      });
    }

    const profileById = new Map(parsedProfiles.data.map((profile) => [profile.id, profile]));
    const organizationName =
      typeof orgRow?.name === "string" && orgRow.name.trim().length > 0
        ? orgRow.name
        : "Crew Hub";
    const payPeriod = toPeriodValue(parsedRun.data.pay_period_end);

    const storageClient = createSupabaseServiceRoleClient();
    const generatedRows: {
      payroll_item_id: string;
      employee_id: string;
      org_id: string;
      pay_period: string;
      file_path: string;
      generated_at: string;
    }[] = [];
    const generatedStatements: GeneratePayslipsResultItem[] = [];
    let skippedCount = 0;

    for (const item of parsedItems.data) {
      const profile = profileById.get(item.employee_id);

      if (!profile) {
        skippedCount += 1;
        continue;
      }

      const allowances = z.array(
        z.object({
          label: z.string(),
          amount: z.union([z.number(), z.string()]),
          currency: z.string().length(3)
        })
      ).safeParse(item.allowances);

      const adjustments = z.array(payrollAdjustmentSchema).safeParse(item.adjustments);
      const deductions = z.array(payrollDeductionSchema).safeParse(item.deductions);

      const safeAllowances = allowances.success
        ? allowances.data.map((allowance) => ({
            label: allowance.label,
            amount: parseAmount(allowance.amount)
          }))
        : [];
      const safeAdjustments = adjustments.success
        ? adjustments.data.map((adjustment) => ({
            label: adjustment.label,
            amount: adjustment.amount
          }))
        : [];
      const safeDeductions = deductions.success
        ? deductions.data.map((deduction) => ({
            label: deduction.ruleName,
            amount: deduction.amount
          }))
        : [];

      const pdfBytes = await renderPaymentStatementPdf({
        companyName: organizationName,
        periodLabel: payPeriod,
        contractorName: profile.full_name,
        department: profile.department,
        title: profile.title,
        country: countryNameFromCode(profile.country_code),
        baseSalaryAmount: parseAmount(item.base_salary_amount),
        allowances: safeAllowances,
        adjustments: safeAdjustments,
        grossAmount: parseAmount(item.gross_amount),
        deductions: safeDeductions,
        deductionsTotal: safeDeductions.reduce((sum, row) => sum + row.amount, 0),
        paymentAmount: parseAmount(item.net_amount),
        currency: item.currency,
        paymentReference: item.payment_reference,
        withholdingApplied: item.withholding_applied
      });

      const safeName = sanitizeFileName(profile.full_name).replace(/_+/g, "-");
      const filePath = `${session.profile.org_id}/payslips/${item.employee_id}/${payPeriod}/${item.id}-${safeName}.pdf`;

      const { error: uploadError } = await storageClient.storage
        .from(DOCUMENT_BUCKET_NAME)
        .upload(filePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true
        });

      if (uploadError) {
        skippedCount += 1;
        continue;
      }

      const generatedAt = new Date().toISOString();

      generatedRows.push({
        payroll_item_id: item.id,
        employee_id: item.employee_id,
        org_id: item.org_id,
        pay_period: payPeriod,
        file_path: filePath,
        generated_at: generatedAt
      });
    }

    if (generatedRows.length > 0) {
      const { data: upsertedRows, error: upsertError } = await supabase
        .from("payslips")
        .upsert(generatedRows, { onConflict: "payroll_item_id" })
        .select("id, payroll_item_id, employee_id, pay_period");

      if (upsertError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYSLIP_GENERATION_FAILED",
            message: `Unable to save payment statement records: ${upsertError.message}`
          },
          meta: buildMeta()
        });
      }

      for (const row of upsertedRows ?? []) {
        if (
          typeof row.id === "string" &&
          typeof row.payroll_item_id === "string" &&
          typeof row.employee_id === "string" &&
          typeof row.pay_period === "string"
        ) {
          generatedStatements.push({
            payslipId: row.id,
            payrollItemId: row.payroll_item_id,
            employeeId: row.employee_id,
            payPeriod: row.pay_period
          });
        }
      }
    }

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      newValue: {
        generatedStatements: generatedStatements.length,
        skippedStatements: skippedCount,
        payPeriod
      }
    });

    const responseData: GeneratePayslipsResponseData = {
      runId,
      generatedCount: generatedStatements.length,
      skippedCount,
      statements: generatedStatements
    };

    return jsonResponse<GeneratePayslipsResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYSLIP_GENERATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to generate payment statements."
      },
      meta: buildMeta()
    });
  }
}
