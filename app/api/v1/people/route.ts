import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { logAudit } from "../../../../lib/audit";
import { USER_ROLES, type UserRole } from "../../../../lib/navigation";
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
  password: z
    .string()
    .trim()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be 72 characters or fewer."),
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
  status: z.enum(PROFILE_STATUSES).default("active")
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
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canManagePeople(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

function canViewAllPeople(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewReports(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "MANAGER") || canViewAllPeople(userRoles);
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

function mapPersonRow(
  row: z.infer<typeof profileRowSchema>,
  managerNameById: ReadonlyMap<string, string>
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
    managerId: row.manager_id,
    managerName: row.manager_id ? managerNameById.get(row.manager_id) ?? null : null,
    employmentType: row.employment_type,
    payrollMode: row.payroll_mode,
    primaryCurrency: row.primary_currency,
    status: row.status,
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

  if (scope === "reports" && hasRole(profile.roles, "MANAGER")) {
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
  }

  let peopleQuery = supabase
    .from("profiles")
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, employment_type, payroll_mode, primary_currency, status, created_at, updated_at"
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

  return jsonResponse<PeopleListResponseData>(200, {
    data: {
      people: parsedPeople.data.map((row) => mapPersonRow(row, managerNameById))
    },
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
        message: "Only HR Admin and Super Admin users can add people."
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

  const parsedBody = createPersonSchema.safeParse(body);

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
  const roles = [...new Set(payload.roles)];

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

  if (payload.managerId === profile.id) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A person cannot report to themselves."
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

  const { data: authData, error: authError } = await serviceRoleClient.auth.admin.createUser({
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
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

  const payrollMode = normalizePayrollMode(payload.employmentType, payload.payrollMode);
  const primaryCurrency = payload.primaryCurrency.trim().toUpperCase();
  const status = payload.status as ProfileStatus;

  const { data: insertedProfile, error: insertProfileError } = await serviceRoleClient
    .from("profiles")
    .insert({
      id: createdUserId,
      org_id: profile.org_id,
      email: payload.email.trim().toLowerCase(),
      full_name: payload.fullName.trim(),
      roles,
      department: payload.department?.trim() || null,
      title: payload.title?.trim() || null,
      country_code: countryCode,
      timezone: payload.timezone?.trim() || null,
      phone: payload.phone?.trim() || null,
      start_date: payload.startDate?.trim() || null,
      manager_id: payload.managerId ?? null,
      employment_type: payload.employmentType as EmploymentType,
      payroll_mode: payrollMode,
      primary_currency: primaryCurrency,
      status
    })
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, employment_type, payroll_mode, primary_currency, status, created_at, updated_at"
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
      status: person.status
    }
  });

  return jsonResponse<PeopleCreateResponseData>(201, {
    data: {
      person
    },
    error: null,
    meta: buildMeta()
  });
}
