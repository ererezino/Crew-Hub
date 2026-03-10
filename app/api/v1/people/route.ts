import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../lib/auth/auth-mutation-guard";
import {
  applyUserNavigationAccess,
  resolveEffectiveUserNavSelection
} from "../../../../lib/auth/navigation-access";
import { logAudit } from "../../../../lib/audit";
import {
  getDepartmentsValidationMessage,
  parseDepartment
} from "../../../../lib/departments";
import { logger } from "../../../../lib/logger";
import { USER_ROLES, type UserRole } from "../../../../lib/navigation";
import { deriveSystemPassword } from "../../../../lib/auth/system-password";
import { sendWelcomeEmail } from "../../../../lib/notifications/email";
import { createNotification } from "../../../../lib/notifications/service";
import { createOnboardingInstance } from "../../../../lib/onboarding/create-instance";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse, AppRole } from "../../../../types/auth";
import {
  EMPLOYMENT_TYPES,
  PAYROLL_MODES,
  PROFILE_STATUSES,
  type EmploymentType,
  type PayrollMode,
  type PeopleCreateResponseData,
  type PeopleListResponseData,
  type PersonRecord,
  type ProfileStatus
} from "../../../../types/people";

const listQuerySchema = z.object({
  scope: z.enum(["all", "reports", "me"]).default("all"),
  limit: z.coerce.number().int().min(1).max(250).default(250)
});

const createPersonSchema = z.object({
  email: z.string().trim().email("Email must be valid."),
  fullName: z.string().trim().min(1, "Name is required").max(200, "Name is too long."),
  roles: z.array(z.enum(USER_ROLES)).min(1, "Select at least one role."),
  department: z.string().trim().max(100, "Department is too long.").optional(),
  title: z.string().trim().max(200, "Title is too long.").optional(),
  countryCode: z
    .string()
    .trim()
    .max(2, "Country code must be 2 letters.")
    .optional(),
  timezone: z.string().trim().max(50, "Timezone is too long.").optional(),
  phone: z.string().trim().max(30, "Phone number is too long.").optional(),
  startDate: z
    .string()
    .trim()
    .refine(
      (value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value),
      "Start date must be in YYYY-MM-DD format."
    )
    .optional(),
  managerId: z.string().uuid("Manager must be a valid user id.").optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("contractor"),
  payrollMode: z.enum(PAYROLL_MODES).optional(),
  primaryCurrency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter code.")
    .default("USD"),
  status: z.enum(PROFILE_STATUSES).optional(),
  isNewEmployee: z.boolean().optional().default(true),
  accessOverrides: z
    .object({
      granted: z.array(z.string().trim().min(1).max(100)).default([]),
      revoked: z.array(z.string().trim().min(1).max(100)).default([])
    })
    .optional()
    .default({
      granted: [],
      revoked: []
    })
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  roles: z.array(z.string()),
  department: z.string().nullable(),
  title: z.string().nullable(),
  country_code: z.string().nullable(),
  timezone: z.string().nullable(),
  phone: z.string().nullable(),
  start_date: z.string().nullable(),
  manager_id: z.string().uuid().nullable(),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  payroll_mode: z.enum(PAYROLL_MODES),
  primary_currency: z.string(),
  status: z.enum(PROFILE_STATUSES),
  notice_period_end_date: z.string().nullable().default(null),
  bio: z.string().nullable().default(null),
  favorite_music: z.string().nullable().default(null),
  favorite_books: z.string().nullable().default(null),
  favorite_sports: z.string().nullable().default(null),
  date_of_birth: z.string().nullable().default(null),
  avatar_url: z.string().nullable().default(null),
  emergency_contact_name: z.string().nullable().default(null),
  emergency_contact_phone: z.string().nullable().default(null),
  emergency_contact_relationship: z.string().nullable().default(null),
  pronouns: z.string().nullable().default(null),
  privacy_settings: z.unknown().default({}),
  account_setup_at: z.string().nullable().default(null),
  last_seen_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function resolveAuthRedirectUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    requestUrl.origin;
  const normalizedAppUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${normalizedAppUrl}/mfa-setup`;
}

function canManagePeople(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "SUPER_ADMIN");
}

function canViewAllPeople(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewReports(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "MANAGER") || hasRole(userRoles, "TEAM_LEAD") || canViewAllPeople(userRoles);
}

function normalizeRoles(values: readonly string[]): AppRole[] {
  return values.filter((value): value is AppRole =>
    USER_ROLES.includes(value as AppRole)
  );
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

function normalizePayrollMode(
  employmentType: EmploymentType,
  requestedPayrollMode: PayrollMode | undefined
): PayrollMode {
  if (employmentType === "contractor") {
    return "contractor_usd_no_withholding";
  }

  return requestedPayrollMode ?? "employee_local_withholding";
}

function deriveInviteStatus(
  accountSetupAt: string | null,
  lastSeenAt: string | null
): "not_invited" | "invited" | "active" {
  if (accountSetupAt || lastSeenAt) return "active";
  return "invited";
}

function mapPersonRow(
  row: z.infer<typeof profileRowSchema>,
  managerNameById: ReadonlyMap<string, string>,
  crewTagById?: ReadonlyMap<string, string>
): PersonRecord {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roles: normalizeRoles(row.roles),
    department: row.department,
    title: row.title,
    countryCode: row.country_code,
    timezone: row.timezone,
    phone: row.phone,
    startDate: row.start_date,
    dateOfBirth: row.date_of_birth,
    managerId: row.manager_id,
    managerName: row.manager_id ? managerNameById.get(row.manager_id) ?? null : null,
    employmentType: row.employment_type,
    payrollMode: row.payroll_mode,
    primaryCurrency: row.primary_currency,
    status: row.status,
    noticePeriodEndDate: row.notice_period_end_date ?? null,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    favoriteMusic: row.favorite_music ?? null,
    favoriteBooks: row.favorite_books ?? null,
    favoriteSports: row.favorite_sports ?? null,
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactPhone: row.emergency_contact_phone ?? null,
    emergencyContactRelationship: row.emergency_contact_relationship ?? null,
    pronouns: row.pronouns ?? null,
    privacySettings: (row.privacy_settings && typeof row.privacy_settings === "object" ? row.privacy_settings : {}) as import("../../../../types/people").PrivacySettings,
    crewTag: crewTagById?.get(row.id) ?? null,
    inviteStatus: deriveInviteStatus(row.account_setup_at, row.last_seen_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view people."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid people query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const profile = session.profile;
  const supabase = await createSupabaseServerClient();

  let scope = query.scope;

  if (scope === "all" && !canViewAllPeople(profile.roles)) {
    scope = canViewReports(profile.roles) ? "reports" : "me";
  }

  if (scope === "reports" && !canViewReports(profile.roles)) {
    scope = "me";
  }

  let reportsUserIds: string[] = [];

  if (scope === "reports") {
    if (hasRole(profile.roles, "MANAGER")) {
      const { data: reportRows, error: reportError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .eq("manager_id", profile.id);

      if (reportError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REPORTS_FETCH_FAILED",
            message: "Unable to load manager reports."
          },
          meta: buildMeta()
        });
      }

      reportsUserIds = [
        profile.id,
        ...(reportRows ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")
      ];
    } else if (hasRole(profile.roles, "TEAM_LEAD") && profile.department) {
      const { data: deptRows, error: deptError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .ilike("department", profile.department);

      if (deptError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REPORTS_FETCH_FAILED",
            message: "Unable to load department members."
          },
          meta: buildMeta()
        });
      }

      reportsUserIds = [
        profile.id,
        ...(deptRows ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")
      ];
    }
  }

  let peopleQuery = supabase
    .from("profiles")
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, privacy_settings, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .limit(query.limit);

  if (scope === "me") {
    peopleQuery = peopleQuery.eq("id", profile.id);
  }

  if (scope === "reports") {
    peopleQuery = peopleQuery.in("id", reportsUserIds.length > 0 ? reportsUserIds : [profile.id]);
  }

  const { data: rawPeople, error: peopleError } = await peopleQuery;

  if (peopleError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PEOPLE_FETCH_FAILED",
        message: "Unable to load people records."
      },
      meta: buildMeta()
    });
  }

  const parsedPeople = z.array(profileRowSchema).safeParse(rawPeople ?? []);

  if (!parsedPeople.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PEOPLE_PARSE_FAILED",
        message: "People data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const managerIds = [
    ...new Set(
      parsedPeople.data
        .map((row) => row.manager_id)
        .filter((value): value is string => Boolean(value))
    )
  ];

  let managerNameById = new Map<string, string>();

  if (managerIds.length > 0) {
    const { data: managerRows, error: managersError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", managerIds);

    if (managersError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "MANAGERS_FETCH_FAILED",
          message: "Unable to load manager details."
        },
        meta: buildMeta()
      });
    }

    managerNameById = new Map(
      (managerRows ?? [])
        .filter(
          (row): row is { id: string; full_name: string } =>
            typeof row?.id === "string" && typeof row?.full_name === "string"
        )
        .map((row) => [row.id, row.full_name])
    );
  }

  /* Fetch crew tags from payment details for all loaded profiles */
  const profileIds = parsedPeople.data.map((row) => row.id);
  let crewTagById = new Map<string, string>();

  if (profileIds.length > 0 && canViewAllPeople(profile.roles)) {
    const { data: paymentRows } = await supabase
      .from("employee_payment_details")
      .select("employee_id, crew_tag")
      .eq("org_id", profile.org_id)
      .in("employee_id", profileIds)
      .not("crew_tag", "is", null);

    if (paymentRows) {
      crewTagById = new Map(
        paymentRows
          .filter(
            (row): row is { employee_id: string; crew_tag: string } =>
              typeof row?.employee_id === "string" && typeof row?.crew_tag === "string"
          )
          .map((row) => [row.employee_id, row.crew_tag])
      );
    }
  }

  const people = parsedPeople.data.map((row) => mapPersonRow(row, managerNameById, crewTagById));

  return jsonResponse<PeopleListResponseData>(200, {
    data: { people },
    error: null,
    meta: buildMeta()
  });
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
        message: "Only Super Admin users can add people."
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

  const normalizedBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? ({
          ...(body as Record<string, unknown>),
          isNewEmployee:
            (body as Record<string, unknown>).isNewEmployee ??
            (body as Record<string, unknown>).is_new_employee,
          accessOverrides:
            (body as Record<string, unknown>).accessOverrides ??
            (body as Record<string, unknown>).access_overrides
        } satisfies Record<string, unknown>)
      : body;

  if (
    normalizedBody &&
    typeof normalizedBody === "object" &&
    !Array.isArray(normalizedBody) &&
    "password" in normalizedBody
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Password field is not supported. Use secure setup links."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = createPersonSchema.safeParse(normalizedBody);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid person payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const roles = [...new Set(["EMPLOYEE", ...payload.roles])];

  if (roles.includes("SUPER_ADMIN") && !hasRole(profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only a Super Admin can assign the Super Admin role."
      },
      meta: buildMeta()
    });
  }

  const normalizedDepartment =
    payload.department && payload.department.trim().length > 0
      ? parseDepartment(payload.department)
      : null;

  if (payload.department && payload.department.trim().length > 0 && !normalizedDepartment) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: getDepartmentsValidationMessage()
      },
      meta: buildMeta()
    });
  }

  const countryCode = normalizeCountryCode(payload.countryCode);

  if (payload.countryCode && payload.countryCode.trim().length > 0 && !countryCode) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Country code must be a valid 2-letter code."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  if (payload.managerId) {
    const { data: managerRow, error: managerError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", payload.managerId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (managerError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "MANAGER_FETCH_FAILED",
          message: "Unable to validate manager assignment."
        },
        meta: buildMeta()
      });
    }

    if (!managerRow?.id) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Selected manager was not found in this organization."
        },
        meta: buildMeta()
      });
    }
  }

  const serviceRoleClient = createSupabaseServiceRoleClient();
  const normalizedEmail = payload.email.trim().toLowerCase();
  const authRedirectUrl = resolveAuthRedirectUrl(request);

  const isNewEmployee = payload.isNewEmployee;
  const profileStatus: ProfileStatus = isNewEmployee ? "onboarding" : "active";
  const startDate = payload.startDate?.trim() || null;
  const payrollMode = normalizePayrollMode(payload.employmentType, payload.payrollMode);
  const primaryCurrency = payload.primaryCurrency.trim().toUpperCase();
  const effectiveSelection = resolveEffectiveUserNavSelection({
    roles: roles as UserRole[],
    overrides: payload.accessOverrides
  });

  let onboardingTemplate: {
    id: string;
    name: string;
    type: "onboarding" | "offboarding";
    tasks: unknown;
  } | null = null;

  if (isNewEmployee) {
    // Step 1: Try org-specific template matching department
    if (normalizedDepartment) {
      const { data: orgTemplateRow, error: orgTemplateError } = await serviceRoleClient
        .from("onboarding_templates")
        .select("id, name, type, tasks")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .eq("type", "onboarding")
        .eq("department", normalizedDepartment)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orgTemplateError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "ONBOARDING_TEMPLATE_FETCH_FAILED",
            message: "Unable to fetch onboarding template for this department."
          },
          meta: buildMeta()
        });
      }

      if (
        orgTemplateRow &&
        typeof orgTemplateRow.id === "string" &&
        typeof orgTemplateRow.name === "string" &&
        (orgTemplateRow.type === "onboarding" || orgTemplateRow.type === "offboarding")
      ) {
        onboardingTemplate = {
          id: orgTemplateRow.id,
          name: orgTemplateRow.name,
          type: orgTemplateRow.type,
          tasks: orgTemplateRow.tasks
        };
      }
    }

    // Step 2: Fallback — system default template matching employee country
    if (!onboardingTemplate && countryCode) {
      const { data: countryDefaultRow } = await serviceRoleClient
        .from("onboarding_templates")
        .select("id, name, type, tasks")
        .is("org_id", null)
        .eq("is_system_default", true)
        .is("deleted_at", null)
        .eq("type", "onboarding")
        .eq("country_code", countryCode)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        countryDefaultRow &&
        typeof countryDefaultRow.id === "string" &&
        typeof countryDefaultRow.name === "string" &&
        (countryDefaultRow.type === "onboarding" || countryDefaultRow.type === "offboarding")
      ) {
        onboardingTemplate = {
          id: countryDefaultRow.id,
          name: countryDefaultRow.name,
          type: countryDefaultRow.type,
          tasks: countryDefaultRow.tasks
        };
      }
    }

    // Step 3: Final fallback — universal system default template
    if (!onboardingTemplate) {
      const { data: universalDefaultRow } = await serviceRoleClient
        .from("onboarding_templates")
        .select("id, name, type, tasks")
        .is("org_id", null)
        .eq("is_system_default", true)
        .is("deleted_at", null)
        .eq("type", "onboarding")
        .is("country_code", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        universalDefaultRow &&
        typeof universalDefaultRow.id === "string" &&
        typeof universalDefaultRow.name === "string" &&
        (universalDefaultRow.type === "onboarding" || universalDefaultRow.type === "offboarding")
      ) {
        onboardingTemplate = {
          id: universalDefaultRow.id,
          name: universalDefaultRow.name,
          type: universalDefaultRow.type,
          tasks: universalDefaultRow.tasks
        };
      }
    }
  }

  /* Create the auth user with a temporary random password.
     After creation, we immediately replace it with the system-derived
     password so the email + TOTP login flow works. */
  const tempPassword = crypto.randomUUID();

  const { data: authData, error: authError } = await serviceRoleClient.auth.admin.createUser({
    email: normalizedEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: payload.fullName.trim()
    }
  });

  if (authError || !authData.user) {
    const message =
      authError?.message.includes("already") || authError?.message.includes("registered")
        ? "A user with this email already exists."
        : "Unable to create authentication user.";

    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "AUTH_USER_CREATE_FAILED",
        message
      },
      meta: buildMeta()
    });
  }

  const createdUserId = authData.user.id;

  /* Replace temporary password with the deterministic system-derived password */
  const systemPassword = deriveSystemPassword(createdUserId);
  await serviceRoleClient.auth.admin
    .updateUserById(createdUserId, { password: systemPassword })
    .catch(() => undefined);

  const { data: insertedProfile, error: insertProfileError } = await serviceRoleClient
    .from("profiles")
    .insert({
      id: createdUserId,
      org_id: profile.org_id,
      email: normalizedEmail,
      full_name: payload.fullName.trim(),
      roles,
      department: normalizedDepartment,
      title: payload.title?.trim() || null,
      country_code: countryCode,
      timezone: payload.timezone?.trim() || null,
      phone: payload.phone?.trim() || null,
      start_date: startDate,
      manager_id: payload.managerId ?? null,
      employment_type: payload.employmentType as EmploymentType,
      payroll_mode: payrollMode,
      primary_currency: primaryCurrency,
      status: profileStatus
    })
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, privacy_settings, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .single();

  if (insertProfileError || !insertedProfile) {
    await serviceRoleClient.auth.admin.deleteUser(createdUserId).catch(() => undefined);

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_CREATE_FAILED",
        message: "Unable to create profile record."
      },
      meta: buildMeta()
    });
  }

  const parsedInsertedProfile = profileRowSchema.safeParse(insertedProfile);

  if (!parsedInsertedProfile.success) {
    await serviceRoleClient.auth.admin.deleteUser(createdUserId).catch(() => undefined);

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Created profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Generate a password-setup link so the user can set their own password
  let setupLink: string | undefined;
  try {
    const { data: linkData } = await serviceRoleClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo: authRedirectUrl }
    });

    if (linkData?.properties?.action_link) {
      setupLink = linkData.properties.action_link;
    }
  } catch (linkError) {
    logger.error("Failed to generate setup link.", {
      userId: createdUserId,
      message: linkError instanceof Error ? linkError.message : String(linkError)
    });
  }

  // Send welcome email with setup link (fire-and-forget)
  sendWelcomeEmail({
    recipientEmail: normalizedEmail,
    recipientName: payload.fullName.trim(),
    setupLink
  }).catch((error) => {
    logger.error("Failed to send welcome email.", {
      userId: createdUserId,
      message: error instanceof Error ? error.message : String(error)
    });
  });

  let managerNameById = new Map<string, string>();

  if (parsedInsertedProfile.data.manager_id) {
    const { data: managerRows } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name")
      .eq("id", parsedInsertedProfile.data.manager_id)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null);

    managerNameById = new Map(
      (managerRows ?? [])
        .filter(
          (row): row is { id: string; full_name: string } =>
            typeof row?.id === "string" && typeof row?.full_name === "string"
        )
        .map((row) => [row.id, row.full_name])
    );
  }

  const person = mapPersonRow(parsedInsertedProfile.data, managerNameById);
  let onboardingInstanceId: string | null = null;
  let accessConfigChangedKeys: string[] = [];

  try {
    const accessUpdate = await applyUserNavigationAccess({
      supabase: serviceRoleClient,
      orgId: profile.org_id,
      employeeId: createdUserId,
      actorUserId: profile.id,
      roles: roles as UserRole[],
      overrides: payload.accessOverrides
    });

    accessConfigChangedKeys = accessUpdate.changedNavItemKeys;
  } catch (error) {
    logger.error("Unable to apply navigation access during user invite.", {
      employeeId: createdUserId,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  if (isNewEmployee && onboardingTemplate) {
    try {
      const onboardingCreateResult = await createOnboardingInstance({
        supabase: serviceRoleClient,
        orgId: profile.org_id,
        employee: {
          id: createdUserId,
          fullName: payload.fullName.trim()
        },
        template: onboardingTemplate,
        type: "onboarding",
        startedAt: startDate ?? undefined
      });

      onboardingInstanceId = onboardingCreateResult.instance.id;

      await createNotification({
        orgId: profile.org_id,
        userId: createdUserId,
        type: "onboarding_task",
        title: "Onboarding started",
        body: "A new onboarding plan has been assigned to you.",
        link: `/onboarding/${onboardingCreateResult.instance.id}`
      });

      await logAudit({
        action: "created",
        tableName: "onboarding_instances",
        recordId: onboardingCreateResult.instance.id,
        newValue: {
          employeeId: onboardingCreateResult.instance.employeeId,
          templateId: onboardingCreateResult.instance.templateId,
          type: onboardingCreateResult.instance.type,
          totalTasks: onboardingCreateResult.instance.totalTasks
        }
      });
    } catch (error) {
      logger.error("Unable to auto-create onboarding instance during user invite.", {
        employeeId: createdUserId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await createNotification({
    orgId: profile.org_id,
    userId: createdUserId,
    type: "welcome",
    title: "Welcome to Crew Hub",
    body: "Welcome to the team! Check your email to finish setting up your account.",
    link: "/settings"
  });

  await logAudit({
    action: "created",
    tableName: "profiles",
    recordId: person.id,
    newValue: {
      email: person.email,
      fullName: person.fullName,
      roles: person.roles,
      department: person.department,
      countryCode: person.countryCode,
      employmentType: person.employmentType,
      payrollMode: person.payrollMode,
      status: person.status,
      isNewEmployee,
      onboardingTemplateId: onboardingTemplate?.id ?? null,
      onboardingInstanceId
    }
  });

  if (accessConfigChangedKeys.length > 0) {
    await logAudit({
      action: "updated",
      tableName: "navigation_access_config",
      recordId: createdUserId,
      newValue: {
        employeeId: createdUserId,
        defaultGrantedNavItemKeys: effectiveSelection.granted,
        revokedNavItemKeys: effectiveSelection.revoked,
        changedNavItemKeys: accessConfigChangedKeys
      }
    });
  }

  return jsonResponse<PeopleCreateResponseData>(201, {
    data: {
      person
    },
    error: null,
    meta: buildMeta()
  });
}
