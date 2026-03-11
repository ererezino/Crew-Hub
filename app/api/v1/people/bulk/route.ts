import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../../lib/auth/auth-mutation-guard";
import { deriveSystemPassword } from "../../../../../lib/auth/system-password";
import { logAudit } from "../../../../../lib/audit";
import { parseDepartment } from "../../../../../lib/departments";
import { logger } from "../../../../../lib/logger";
import { USER_ROLES, type UserRole } from "../../../../../lib/navigation";
import { createNotification } from "../../../../../lib/notifications/service";
import { sendWelcomeEmail } from "../../../../../lib/notifications/email";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import { EMPLOYMENT_TYPES, type EmploymentType } from "../../../../../types/people";

const bulkEmployeeSchema = z.object({
  email: z.string().trim().email("Email must be valid."),
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  countryCode: z.string().trim().max(2, "Country code must be 2 letters.").optional(),
  department: z.string().trim().max(100, "Department is too long.").optional(),
  title: z.string().trim().max(200, "Title is too long.").optional(),
  startDate: z
    .string()
    .trim()
    .refine(
      (value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value),
      "Start date must be in YYYY-MM-DD format."
    )
    .optional(),
  managerEmail: z.string().trim().email("Manager email must be valid.").optional(),
  roles: z.array(z.enum(USER_ROLES)).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional()
});

const bulkRequestSchema = z.object({
  employees: z.array(bulkEmployeeSchema).min(1, "At least one employee is required.").max(200, "Maximum 200 employees per upload."),
  confirm: z.boolean().optional().default(false)
});

type BulkRowValidation = {
  index: number;
  email: string;
  fullName: string;
  valid: boolean;
  errors: string[];
  data: z.infer<typeof bulkEmployeeSchema>;
};

type BulkResult = {
  email: string;
  status: "created" | "error";
  error?: string;
};

type BulkResponseData = {
  preview?: BulkRowValidation[];
  results?: BulkResult[];
  created?: number;
  failed?: number;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function normalizeConfiguredAppUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function resolveAppUrl(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  const configuredAppUrl = normalizeConfiguredAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  return configuredAppUrl ?? requestOrigin;
}

function resolveAuthRedirectUrl(request: Request): string {
  return `${resolveAppUrl(request)}/api/auth/callback?next=/mfa-setup`;
}

function buildRecoverySetupLink({
  request,
  hashedToken,
  actionLink
}: {
  request: Request;
  hashedToken?: string | null;
  actionLink?: string | null;
}): string | null {
  if (typeof hashedToken === "string" && hashedToken.length > 0) {
    const callbackUrl = new URL("/api/auth/callback", resolveAppUrl(request));
    callbackUrl.searchParams.set("token_hash", hashedToken);
    callbackUrl.searchParams.set("type", "recovery");
    callbackUrl.searchParams.set("next", "/mfa-setup");
    return callbackUrl.toString();
  }

  return actionLink ?? null;
}

function isRedirectConfigurationError(message: string | undefined): boolean {
  if (!message) return false;
  return /(redirect|redirect_to|site url|url.*allow|allow.*url)/i.test(message);
}

function canManagePeople(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "SUPER_ADMIN");
}

function normalizeCountryCode(value: string | undefined): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function validateRow(
  employee: z.infer<typeof bulkEmployeeSchema>,
  index: number,
  existingEmails: ReadonlySet<string>
): BulkRowValidation {
  const errors: string[] = [];
  const normalizedEmail = employee.email.trim().toLowerCase();

  if (existingEmails.has(normalizedEmail)) {
    errors.push("Email already exists in the organization.");
  }

  if (employee.countryCode && employee.countryCode.trim().length > 0) {
    const cc = normalizeCountryCode(employee.countryCode);
    if (!cc) {
      errors.push("Country code must be a valid 2-letter code.");
    }
  }

  if (employee.department && employee.department.trim().length > 0) {
    const dept = parseDepartment(employee.department);
    if (!dept) {
      errors.push("Department is not recognized. Use a standard department name.");
    }
  }

  if (employee.startDate && employee.startDate.trim().length > 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(employee.startDate.trim())) {
      errors.push("Start date must be in YYYY-MM-DD format.");
    }
  }

  return {
    index,
    email: normalizedEmail,
    fullName: employee.fullName.trim(),
    valid: errors.length === 0,
    errors,
    data: employee
  };
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create people."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!canManagePeople(profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin users can bulk-create people."
      },
      meta: buildMeta()
    });
  }

  const authMutationBlockReason = getAuthMutationBlockReason();
  if (authMutationBlockReason) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "AUTH_MUTATION_BLOCKED",
        message: authMutationBlockReason
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = bulkRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid bulk upload payload."
      },
      meta: buildMeta()
    });
  }

  const { employees, confirm } = parsedBody.data;

  // Fetch existing emails in this org to check for duplicates
  const serviceRoleClient = createSupabaseServiceRoleClient();

  const { data: existingProfiles, error: existingError } = await serviceRoleClient
    .from("profiles")
    .select("email")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILES_FETCH_FAILED",
        message: "Unable to check existing profiles."
      },
      meta: buildMeta()
    });
  }

  const existingEmails = new Set(
    (existingProfiles ?? [])
      .map((row) => (typeof row.email === "string" ? row.email.toLowerCase() : ""))
      .filter((email) => email.length > 0)
  );

  // Also check for duplicate emails within the upload itself
  const uploadEmailCounts = new Map<string, number>();
  for (const employee of employees) {
    const normalizedEmail = employee.email.trim().toLowerCase();
    uploadEmailCounts.set(normalizedEmail, (uploadEmailCounts.get(normalizedEmail) ?? 0) + 1);
  }

  // Resolve manager emails to IDs
  const managerEmails = [
    ...new Set(
      employees
        .map((employee) => employee.managerEmail?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  ];

  let managerIdByEmail = new Map<string, string>();

  if (managerEmails.length > 0) {
    const { data: managerRows } = await serviceRoleClient
      .from("profiles")
      .select("id, email")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("email", managerEmails);

    managerIdByEmail = new Map(
      (managerRows ?? [])
        .filter(
          (row): row is { id: string; email: string } =>
            typeof row?.id === "string" && typeof row?.email === "string"
        )
        .map((row) => [row.email.toLowerCase(), row.id])
    );
  }

  // Validate each row
  const validatedRows: BulkRowValidation[] = employees.map((employee, index) => {
    const row = validateRow(employee, index, existingEmails);

    const normalizedEmail = employee.email.trim().toLowerCase();
    const emailCount = uploadEmailCounts.get(normalizedEmail) ?? 0;
    if (emailCount > 1) {
      row.errors.push("Duplicate email within this upload.");
      row.valid = false;
    }

    if (employee.managerEmail && employee.managerEmail.trim().length > 0) {
      const managerEmailNormalized = employee.managerEmail.trim().toLowerCase();
      if (!managerIdByEmail.has(managerEmailNormalized)) {
        row.errors.push(`Manager email "${employee.managerEmail}" not found in the organization.`);
        row.valid = false;
      }
    }

    return row;
  });

  const validRows = validatedRows.filter((row) => row.valid);
  const invalidRows = validatedRows.filter((row) => !row.valid);

  // Preview mode: return validation results without creating anything
  if (!confirm) {
    return jsonResponse<BulkResponseData>(200, {
      data: {
        preview: validatedRows,
        totalRows: validatedRows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length
      },
      error: null,
      meta: buildMeta()
    });
  }

  // Confirm mode: create valid employees
  if (validRows.length === 0) {
    return jsonResponse<BulkResponseData>(422, {
      data: {
        results: [],
        created: 0,
        failed: validatedRows.length
      },
      error: {
        code: "NO_VALID_ROWS",
        message: "No valid employees to import. Fix the errors and try again."
      },
      meta: buildMeta()
    });
  }

  const results: BulkResult[] = [];
  let createdCount = 0;
  let failedCount = 0;
  const authRedirectUrl = resolveAuthRedirectUrl(request);

  for (const row of validRows) {
    const employee = row.data;
    const normalizedEmail = employee.email.trim().toLowerCase();

    try {
      const tempPassword = crypto.randomUUID();
      const roles: string[] = [...new Set(["EMPLOYEE", ...(employee.roles ?? ["EMPLOYEE"])])];
      const countryCode = normalizeCountryCode(employee.countryCode);
      const normalizedDepartment =
        employee.department && employee.department.trim().length > 0
          ? parseDepartment(employee.department)
          : null;
      const employmentType: EmploymentType = employee.employmentType ?? "contractor";
      const startDate = employee.startDate?.trim() || null;
      const managerId = employee.managerEmail
        ? managerIdByEmail.get(employee.managerEmail.trim().toLowerCase()) ?? null
        : null;

      // Create auth user
      const { data: authData, error: authError } = await serviceRoleClient.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: employee.fullName.trim()
        }
      });

      if (authError || !authData.user) {
        const message =
          authError?.message.includes("already") || authError?.message.includes("registered")
            ? "A user with this email already exists."
            : "Unable to create authentication user.";

        results.push({ email: normalizedEmail, status: "error", error: message });
        failedCount += 1;
        continue;
      }

      const createdUserId = authData.user.id;
      let setupLink: string | undefined;

      // Set system-derived password for TOTP login flow
      const systemPassword = deriveSystemPassword(createdUserId);
      await serviceRoleClient.auth.admin
        .updateUserById(createdUserId, { password: systemPassword })
        .catch(() => undefined);

      // Generate recovery link so new hires land on authenticator setup.
      const {
        data: primaryLinkData,
        error: primaryLinkError
      } = await serviceRoleClient.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
        options: { redirectTo: authRedirectUrl }
      });

      let resolvedLinkData = primaryLinkData;
      let resolvedLinkError = primaryLinkError;

      if (
        (resolvedLinkError || !resolvedLinkData?.properties) &&
        isRedirectConfigurationError(resolvedLinkError?.message)
      ) {
        const fallback = await serviceRoleClient.auth.admin.generateLink({
          type: "recovery",
          email: normalizedEmail
        });
        resolvedLinkData = fallback.data;
        resolvedLinkError = fallback.error;
      }

      if (!resolvedLinkError && resolvedLinkData?.properties) {
        const generatedSetupLink = buildRecoverySetupLink({
          request,
          hashedToken: resolvedLinkData.properties.hashed_token,
          actionLink: resolvedLinkData.properties.action_link
        });
        setupLink = generatedSetupLink ?? undefined;
      } else {
        logger.warn("Unable to generate setup link during bulk upload.", {
          email: normalizedEmail,
          message: resolvedLinkError?.message ?? "unknown"
        });
      }

      // Create profile
      const { error: insertProfileError } = await serviceRoleClient
        .from("profiles")
        .insert({
          id: createdUserId,
          org_id: profile.org_id,
          email: normalizedEmail,
          full_name: employee.fullName.trim(),
          roles,
          department: normalizedDepartment,
          title: employee.title?.trim() || null,
          country_code: countryCode,
          start_date: startDate,
          manager_id: managerId,
          employment_type: employmentType,
          payroll_mode: employmentType === "contractor" ? "contractor_usd_no_withholding" : "employee_local_withholding",
          primary_currency: "USD",
          status: "onboarding"
        });

      if (insertProfileError) {
        // Rollback auth user
        await serviceRoleClient.auth.admin.deleteUser(createdUserId).catch(() => undefined);
        results.push({ email: normalizedEmail, status: "error", error: "Unable to create profile record." });
        failedCount += 1;
        continue;
      }

      // Send welcome notification
      await createNotification({
        orgId: profile.org_id,
        userId: createdUserId,
        type: "welcome",
        title: "Welcome to Crew Hub",
        body: "Welcome to the team! Please update your profile and set up your authenticator.",
        link: "/settings"
      });

      // Send welcome email (bulk upload treats all as new hires by default)
      try {
        await sendWelcomeEmail({
          recipientEmail: normalizedEmail,
          recipientName: employee.fullName.trim(),
          setupLink,
          isNewHire: true,
          department: normalizedDepartment || undefined
        });
      } catch (emailError) {
        logger.error("Failed to send welcome email during bulk upload.", {
          email: normalizedEmail,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        });
      }

      // Audit log
      await logAudit({
        action: "created",
        tableName: "profiles",
        recordId: createdUserId,
        newValue: {
          email: normalizedEmail,
          fullName: employee.fullName.trim(),
          roles,
          department: normalizedDepartment,
          countryCode,
          employmentType,
          source: "bulk_upload"
        }
      });

      results.push({ email: normalizedEmail, status: "created" });
      createdCount += 1;
    } catch (error) {
      results.push({
        email: normalizedEmail,
        status: "error",
        error: error instanceof Error ? error.message : "Unexpected error creating employee."
      });
      failedCount += 1;
    }
  }

  // Count skipped invalid rows as failed
  failedCount += invalidRows.length;

  return jsonResponse<BulkResponseData>(201, {
    data: {
      results,
      created: createdCount,
      failed: failedCount
    },
    error: null,
    meta: buildMeta()
  });
}
