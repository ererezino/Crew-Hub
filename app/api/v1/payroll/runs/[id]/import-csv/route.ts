import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema,
  parseIntegerAmount
} from "../../../_helpers";

/* ── CSV import types ─────────────────── */

type CsvImportPreviewRow = {
  rowNumber: number;
  employeeEmail: string;
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  currency: string;
  allowances: { label: string; amount: number }[];
  bonus: { label: string; amount: number } | null;
  deduction: { label: string; amount: number } | null;
  notes: string | null;
  hasConflict: boolean;
};

type CsvImportError = {
  row: number;
  field: string;
  message: string;
};

type CsvImportSummary = {
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  conflictCount: number;
};

type CsvImportPreviewResponseData = {
  validRows: CsvImportPreviewRow[];
  errors: CsvImportError[];
  duplicates: string[];
  conflicts: string[];
  summary: CsvImportSummary;
  committed: boolean;
};

/* ── CSV parsing ──────────────────────── */

function parseQuotedCsv(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseCsvContent(raw: string): { headers: string[]; rows: string[][] } {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseQuotedCsv(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((line) => parseQuotedCsv(line));

  return { headers, rows };
}

/* ── Validation helpers ───────────────── */

const EXPECTED_HEADERS = [
  "employee_email",
  "base_salary",
  "currency"
];

const CURRENCY_REGEX = /^[A-Z]{3}$/;

function getField(row: string[], headers: string[], fieldName: string): string {
  const index = headers.indexOf(fieldName);
  if (index === -1 || index >= row.length) {
    return "";
  }
  return row[index].trim();
}

function validateRow(
  row: string[],
  headers: string[],
  rowNumber: number,
  employeeMap: Map<string, { id: string; fullName: string }>
): {
  parsed: CsvImportPreviewRow | null;
  errors: CsvImportError[];
} {
  const errors: CsvImportError[] = [];

  const email = getField(row, headers, "employee_email").toLowerCase();
  const baseSalaryRaw = getField(row, headers, "base_salary");
  const currencyRaw = getField(row, headers, "currency").toUpperCase();

  /* Required fields */
  if (!email) {
    errors.push({ row: rowNumber, field: "employee_email", message: "Email is required." });
  } else if (!email.includes("@")) {
    errors.push({ row: rowNumber, field: "employee_email", message: "Invalid email address." });
  }

  if (!baseSalaryRaw) {
    errors.push({ row: rowNumber, field: "base_salary", message: "Base salary is required." });
  }

  if (!currencyRaw) {
    errors.push({ row: rowNumber, field: "currency", message: "Currency is required." });
  } else if (!CURRENCY_REGEX.test(currencyRaw)) {
    errors.push({ row: rowNumber, field: "currency", message: "Currency must be a 3-letter ISO code (e.g., NGN, USD)." });
  }

  const baseSalary = parseIntegerAmount(baseSalaryRaw);

  if (baseSalaryRaw && (baseSalary === null || baseSalary <= 0)) {
    errors.push({ row: rowNumber, field: "base_salary", message: "Base salary must be a positive integer (minor units)." });
  }

  /* Employee lookup */
  const employee = email ? employeeMap.get(email) : undefined;

  if (email && email.includes("@") && !employee) {
    errors.push({ row: rowNumber, field: "employee_email", message: `Employee not found: ${email}` });
  }

  /* Optional allowances */
  const allowances: { label: string; amount: number }[] = [];
  const allowanceFields = [
    { header: "allowance_housing", label: "Housing" },
    { header: "allowance_transport", label: "Transport" },
    { header: "allowance_communication", label: "Communication" },
    { header: "allowance_meal", label: "Meal" }
  ];

  for (const { header, label } of allowanceFields) {
    const raw = getField(row, headers, header);

    if (!raw || raw === "0") {
      continue;
    }

    const amount = parseIntegerAmount(raw);

    if (amount === null || amount < 0) {
      errors.push({ row: rowNumber, field: header, message: `${label} allowance must be a non-negative integer.` });
    } else if (amount > 0) {
      allowances.push({ label, amount });
    }
  }

  /* Optional bonus */
  let bonus: { label: string; amount: number } | null = null;
  const bonusAmountRaw = getField(row, headers, "bonus_amount");
  const bonusLabel = getField(row, headers, "bonus_label") || "Bonus";

  if (bonusAmountRaw && bonusAmountRaw !== "0") {
    const bonusAmount = parseIntegerAmount(bonusAmountRaw);

    if (bonusAmount === null || bonusAmount <= 0) {
      errors.push({ row: rowNumber, field: "bonus_amount", message: "Bonus amount must be a positive integer." });
    } else {
      bonus = { label: bonusLabel, amount: bonusAmount };
    }
  }

  /* Optional deduction */
  let deduction: { label: string; amount: number } | null = null;
  const deductionAmountRaw = getField(row, headers, "deduction_amount");
  const deductionLabel = getField(row, headers, "deduction_label") || "Deduction";

  if (deductionAmountRaw && deductionAmountRaw !== "0") {
    const deductionAmount = parseIntegerAmount(deductionAmountRaw);

    if (deductionAmount === null || deductionAmount <= 0) {
      errors.push({ row: rowNumber, field: "deduction_amount", message: "Deduction amount must be a positive integer." });
    } else {
      deduction = { label: deductionLabel, amount: deductionAmount };
    }
  }

  const notes = getField(row, headers, "notes") || null;

  if (errors.length > 0) {
    return { parsed: null, errors };
  }

  return {
    parsed: {
      rowNumber,
      employeeEmail: email,
      employeeId: employee!.id,
      employeeName: employee!.fullName,
      baseSalary: baseSalary!,
      currency: currencyRaw,
      allowances,
      bonus,
      deduction,
      notes,
      hasConflict: false
    },
    errors
  };
}

/* ── Route handler ────────────────────── */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to import payroll data." },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Finance Admin and Super Admin can import payroll data." },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;
  const profile = session.profile;

  /* Check if this is a commit or preview request */
  const url = new URL(request.url);
  const isCommit = url.searchParams.get("commit") === "true";

  /* Parse multipart form data */
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request must be multipart form data with a CSV file." },
      meta: buildMeta()
    });
  }

  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "No CSV file provided." },
      meta: buildMeta()
    });
  }

  if (file.size > 2 * 1024 * 1024) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "CSV file is too large. Maximum size is 2 MB." },
      meta: buildMeta()
    });
  }

  /* Read CSV content */
  let csvContent: string;

  try {
    csvContent = await file.text();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Unable to read CSV file." },
      meta: buildMeta()
    });
  }

  const { headers, rows } = parseCsvContent(csvContent);

  if (headers.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "CSV file is empty." },
      meta: buildMeta()
    });
  }

  /* Validate required headers */
  const missingHeaders = EXPECTED_HEADERS.filter(
    (header) => !headers.includes(header)
  );

  if (missingHeaders.length > 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: `Missing required CSV headers: ${missingHeaders.join(", ")}`
      },
      meta: buildMeta()
    });
  }

  if (rows.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "CSV file contains no data rows." },
      meta: buildMeta()
    });
  }

  if (rows.length > 500) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "CSV file contains too many rows. Maximum is 500." },
      meta: buildMeta()
    });
  }

  /* Verify the payroll run exists and is editable */
  const supabase = await createSupabaseServerClient();

  const { data: rawRun, error: runError } = await supabase
    .from("payroll_runs")
    .select(
      PAYROLL_RUN_SELECT_COLUMNS
    )
    .eq("org_id", profile.org_id)
    .eq("id", runId)
    .is("deleted_at", null)
    .maybeSingle();

  if (runError || !rawRun) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Payroll run not found." },
      meta: buildMeta()
    });
  }

  const parsedRun = payrollRunRowSchema.safeParse(rawRun);

  if (!parsedRun.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_RUN_PARSE_FAILED", message: "Payroll run data is not in the expected format." },
      meta: buildMeta()
    });
  }

  if (parsedRun.data.status !== "draft" && parsedRun.data.status !== "calculated") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "CSV import is only allowed when the payroll run is in draft or calculated status."
      },
      meta: buildMeta()
    });
  }

  /* Fetch all active employees in the org to validate emails */
  const { data: employeeRows, error: employeesError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (employeesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "EMPLOYEES_FETCH_FAILED", message: "Unable to load employee data." },
      meta: buildMeta()
    });
  }

  const employeeMap = new Map<string, { id: string; fullName: string }>();

  for (const row of employeeRows ?? []) {
    if (row.email) {
      employeeMap.set(row.email.toLowerCase(), {
        id: row.id,
        fullName: row.full_name ?? row.email
      });
    }
  }

  /* Fetch existing payroll items for conflict detection */
  const { data: existingItems } = await supabase
    .from("payroll_items")
    .select("employee_id")
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id);

  const existingEmployeeIds = new Set(
    (existingItems ?? []).map((item) => item.employee_id)
  );

  /* Validate all rows */
  const allErrors: CsvImportError[] = [];
  const validRows: CsvImportPreviewRow[] = [];
  const emailCounts = new Map<string, number>();
  const duplicateEmails: string[] = [];

  /* First pass: count emails for duplicate detection */
  for (const row of rows) {
    const email = getField(row, headers, "employee_email").toLowerCase();

    if (email) {
      emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
    }
  }

  for (const [email, count] of emailCounts) {
    if (count > 1) {
      duplicateEmails.push(email);
    }
  }

  /* Second pass: validate each row */
  for (let i = 0; i < rows.length; i++) {
    const { parsed, errors } = validateRow(rows[i], headers, i + 2, employeeMap);

    allErrors.push(...errors);

    if (parsed) {
      const isDuplicate = duplicateEmails.includes(parsed.employeeEmail);

      if (isDuplicate) {
        allErrors.push({
          row: i + 2,
          field: "employee_email",
          message: `Duplicate email in CSV: ${parsed.employeeEmail}`
        });
      } else {
        parsed.hasConflict = existingEmployeeIds.has(parsed.employeeId);
        validRows.push(parsed);
      }
    }
  }

  const conflictEmails = validRows
    .filter((row) => row.hasConflict)
    .map((row) => row.employeeEmail);

  const summary: CsvImportSummary = {
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: allErrors.length,
    duplicateCount: duplicateEmails.length,
    conflictCount: conflictEmails.length
  };

  /* Preview mode: return validation results without committing */
  if (!isCommit) {
    return jsonResponse<CsvImportPreviewResponseData>(200, {
      data: {
        validRows,
        errors: allErrors,
        duplicates: duplicateEmails,
        conflicts: conflictEmails,
        summary,
        committed: false
      },
      error: null,
      meta: buildMeta()
    });
  }

  /* Commit mode: upsert payroll items */
  if (validRows.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "No valid rows to import." },
      meta: buildMeta()
    });
  }

  /* Block commit when conflicts exist unless explicit overwrite is requested */
  const allowOverwrite = url.searchParams.get("overwrite") === "true";
  const conflictsExist = validRows.some((row) => row.hasConflict);

  if (conflictsExist && !allowOverwrite) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "CONFLICTS_REQUIRE_OVERWRITE",
        message:
          "Import would overwrite existing payroll items. Re-submit with explicit overwrite confirmation to proceed."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const itemsToUpsert = validRows.map((row) => {
    const allowancesJson = row.allowances.map((a) => ({
      label: a.label,
      amount: a.amount,
      currency: row.currency,
      isTaxable: true
    }));

    const adjustmentsJson: Array<{
      id: string;
      type: string;
      label: string;
      amount: number;
      notes: string | null;
      createdAt: string;
      createdBy: string | null;
    }> = [];

    if (row.bonus) {
      adjustmentsJson.push({
        id: crypto.randomUUID(),
        type: "bonus",
        label: row.bonus.label,
        amount: row.bonus.amount,
        notes: "Imported from CSV",
        createdAt: new Date().toISOString(),
        createdBy: profile.id
      });
    }

    if (row.deduction) {
      adjustmentsJson.push({
        id: crypto.randomUUID(),
        type: "deduction",
        label: row.deduction.label,
        amount: row.deduction.amount * -1,
        notes: "Imported from CSV",
        createdAt: new Date().toISOString(),
        createdBy: profile.id
      });
    }

    const allowanceTotal = row.allowances.reduce((sum, a) => sum + a.amount, 0);
    const bonusTotal = row.bonus?.amount ?? 0;
    const deductionTotal = row.deduction?.amount ?? 0;
    const grossAmount = row.baseSalary + allowanceTotal + bonusTotal;
    const netAmount = grossAmount - deductionTotal;

    return {
      payroll_run_id: runId,
      employee_id: row.employeeId,
      org_id: profile.org_id,
      gross_amount: grossAmount,
      base_salary_amount: row.baseSalary,
      currency: row.currency,
      pay_currency: row.currency,
      allowances: allowancesJson,
      deductions: [],
      employer_contributions: [],
      adjustments: adjustmentsJson,
      net_amount: netAmount,
      withholding_applied: false,
      payment_status: "pending",
      notes: row.notes,
      flagged: true,
      flag_reason: "Imported from CSV. Run Calculate to apply withholding rules."
    };
  });

  const { error: upsertError } = await serviceClient
    .from("payroll_items")
    .upsert(itemsToUpsert, {
      onConflict: "payroll_run_id,employee_id"
    });

  if (upsertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "IMPORT_FAILED", message: "Unable to save imported payroll data." },
      meta: buildMeta()
    });
  }

  /* Update run: employee count + force status back to draft.
   * Imported items have withholding_applied: false, so the run MUST be
   * recalculated before it can be submitted for approval.  Resetting to
   * "draft" makes this structurally impossible to bypass. */
  const { count: itemCount } = await serviceClient
    .from("payroll_items")
    .select("id", { count: "exact", head: true })
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id);

  await serviceClient
    .from("payroll_runs")
    .update({
      status: "draft",
      employee_count: itemCount ?? validRows.length
    })
    .eq("id", runId)
    .eq("org_id", profile.org_id);

  await logAudit({
    action: "updated",
    tableName: "payroll_runs",
    recordId: runId,
    newValue: {
      csvImport: true,
      importedCount: validRows.length,
      conflictCount: conflictEmails.length,
      importedBy: profile.id
    }
  });

  return jsonResponse<CsvImportPreviewResponseData>(200, {
    data: {
      validRows,
      errors: allErrors,
      duplicates: duplicateEmails,
      conflicts: conflictEmails,
      summary,
      committed: true
    },
    error: null,
    meta: buildMeta()
  });
}
