import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  applyUserNavigationAccess,
  resolveEffectiveUserNavSelection
} from "../../../../../lib/auth/navigation-access";
import { logAudit } from "../../../../../lib/audit";
import {
  getDepartmentsValidationMessage,
  parseDepartment
} from "../../../../../lib/departments";
import { USER_ROLES } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse, AppRole } from "../../../../../types/auth";
import {
  PROFILE_STATUSES,
  type PeopleUpdateResponseData,
  type PersonRecord,
  type ProfileStatus
} from "../../../../../types/people";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

const updatePersonSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long.").optional(),
  roles: z.array(z.enum(USER_ROLES)).min(1, "Select at least one role.").optional(),
  department: z.string().trim().max(100, "Department is too long.").nullable().optional(),
  title: z.string().trim().max(200, "Title is too long.").nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD.").nullable().optional(),
  managerId: z.string().uuid("Manager must be a valid user id.").nullable().optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer.").nullable().optional(),
  favoriteMusic: z.string().trim().max(200, "Favorite music must be 200 characters or fewer.").nullable().optional(),
  favoriteBooks: z.string().trim().max(200, "Favorite books must be 200 characters or fewer.").nullable().optional(),
  favoriteSports: z.string().trim().max(200, "Favorite sports must be 200 characters or fewer.").nullable().optional(),
  crewTag: z.string().trim().max(50, "Crew Tag must be 50 characters or fewer.").nullable().optional(),
  privacySettings: z.object({
    showEmail: z.boolean().optional(),
    showPhone: z.boolean().optional(),
    showDepartment: z.boolean().optional(),
    showBio: z.boolean().optional(),
    showInterests: z.boolean().optional()
  }).optional(),
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
  date_of_birth: z.string().nullable().default(null),
  manager_id: z.string().uuid().nullable(),
  employment_type: z.enum(["full_time", "part_time", "contractor"]),
  payroll_mode: z.enum([
    "contractor_usd_no_withholding",
    "employee_local_withholding",
    "employee_usd_withholding"
  ]),
  primary_currency: z.string(),
  status: z.enum(PROFILE_STATUSES),
  notice_period_end_date: z.string().nullable().default(null),
  bio: z.string().nullable().default(null),
  favorite_music: z.string().nullable().default(null),
  favorite_books: z.string().nullable().default(null),
  favorite_sports: z.string().nullable().default(null),
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

function normalizeRoles(values: readonly string[]): AppRole[] {
  return values.filter((value): value is AppRole =>
    USER_ROLES.includes(value as AppRole)
  );
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
  crewTag?: string | null
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
    privacySettings: (row.privacy_settings && typeof row.privacy_settings === "object" ? row.privacy_settings : {}) as import("../../../../../types/people").PrivacySettings,
    crewTag: crewTag ?? null,
    inviteStatus: deriveInviteStatus(row.account_setup_at, row.last_seen_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update people records."
      },
      meta: buildMeta()
    });
  }

  const canUpdatePeople =
    hasRole(session.profile.roles, "SUPER_ADMIN") ||
    hasRole(session.profile.roles, "HR_ADMIN");

  if (!canUpdatePeople) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin and HR Admin can update user records."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid user id."
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

  const rawBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  if (rawBody && typeof rawBody.email === "string" && rawBody.email.trim().length > 0) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Email cannot be changed from this endpoint."
      },
      meta: buildMeta()
    });
  }

  const normalizedBody =
    rawBody === null
      ? body
      : ({
          ...rawBody,
          accessOverrides: rawBody.accessOverrides ?? rawBody.access_overrides
        } satisfies Record<string, unknown>);
  const hasAccessOverridesField =
    rawBody !== null &&
    (Object.prototype.hasOwnProperty.call(rawBody, "accessOverrides") ||
      Object.prototype.hasOwnProperty.call(rawBody, "access_overrides"));

  const parsedBody = updatePersonSchema.safeParse(normalizedBody);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const shouldUpdateAccess = hasAccessOverridesField || payload.roles !== undefined;
  const serviceRoleClient = createSupabaseServiceRoleClient();
  const personId = parsedParams.data.id;

  const { data: existingProfile, error: existingProfileError } = await serviceRoleClient
    .from("profiles")
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, privacy_settings, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .eq("id", personId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingProfileError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to load existing profile."
      },
      meta: buildMeta()
    });
  }

  const parsedExistingProfile = profileRowSchema.safeParse(existingProfile);

  if (!parsedExistingProfile.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "User was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const existingRoles = [...new Set(normalizeRoles(parsedExistingProfile.data.roles))];
  const nextRoles: AppRole[] = payload.roles
    ? [...new Set(["EMPLOYEE", ...payload.roles] as AppRole[])]
    : existingRoles;

  const targetDepartment =
    payload.department === undefined
      ? parsedExistingProfile.data.department
      : payload.department === null || payload.department.trim().length === 0
        ? null
        : parseDepartment(payload.department);

  if (
    payload.department !== undefined &&
    payload.department !== null &&
    payload.department.trim().length > 0 &&
    !targetDepartment
  ) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: getDepartmentsValidationMessage()
      },
      meta: buildMeta()
    });
  }

  if (payload.managerId === personId) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A person cannot report to themselves."
      },
      meta: buildMeta()
    });
  }

  if (
    existingRoles.includes("SUPER_ADMIN") &&
    !nextRoles.includes("SUPER_ADMIN")
  ) {
    const { count: superAdminCount, error: superAdminCountError } = await serviceRoleClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .contains("roles", ["SUPER_ADMIN"]);

    if (superAdminCountError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SUPER_ADMIN_COUNT_FAILED",
          message: "Unable to validate Super Admin assignments."
        },
        meta: buildMeta()
      });
    }

    if ((superAdminCount ?? 0) <= 1) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Cannot remove SUPER_ADMIN from the last Super Admin account."
        },
        meta: buildMeta()
      });
    }
  }

  if (payload.managerId) {
    const { data: managerRow, error: managerError } = await serviceRoleClient
      .from("profiles")
      .select("id")
      .eq("id", payload.managerId)
      .eq("org_id", session.profile.org_id)
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

  const updateValues: {
    full_name?: string;
    roles?: string[];
    department?: string | null;
    title?: string | null;
    date_of_birth?: string | null;
    manager_id?: string | null;
    status?: ProfileStatus;
    bio?: string | null;
    favorite_music?: string | null;
    favorite_books?: string | null;
    favorite_sports?: string | null;
    privacy_settings?: Record<string, boolean>;
  } = {};

  if (payload.fullName !== undefined) {
    updateValues.full_name = payload.fullName.trim();
  }

  if (payload.roles !== undefined) {
    updateValues.roles = nextRoles;
  }

  if (payload.department !== undefined) {
    updateValues.department = targetDepartment;
  }

  if (payload.title !== undefined) {
    updateValues.title = payload.title?.trim() || null;
  }

  if (payload.dateOfBirth !== undefined) {
    updateValues.date_of_birth = payload.dateOfBirth ?? null;
  }

  if (payload.managerId !== undefined) {
    updateValues.manager_id = payload.managerId ?? null;
  }

  if (payload.status !== undefined) {
    updateValues.status = payload.status;
  }

  if (payload.bio !== undefined) {
    updateValues.bio = payload.bio?.trim() || null;
  }

  if (payload.favoriteMusic !== undefined) {
    updateValues.favorite_music = payload.favoriteMusic?.trim() || null;
  }

  if (payload.favoriteBooks !== undefined) {
    updateValues.favorite_books = payload.favoriteBooks?.trim() || null;
  }

  if (payload.favoriteSports !== undefined) {
    updateValues.favorite_sports = payload.favoriteSports?.trim() || null;
  }

  if (payload.privacySettings !== undefined) {
    updateValues.privacy_settings = payload.privacySettings as Record<string, boolean>;
  }

  let updatedProfileRow: unknown = parsedExistingProfile.data;

  if (Object.keys(updateValues).length > 0) {
    const { data: updatedRow, error: updateError } = await serviceRoleClient
      .from("profiles")
      .update(updateValues)
      .eq("id", personId)
      .eq("org_id", session.profile.org_id)
      .select(
        "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, privacy_settings, account_setup_at, last_seen_at, created_at, updated_at"
      )
      .single();

    if (updateError || !updatedRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_UPDATE_FAILED",
          message: "Unable to update profile."
        },
        meta: buildMeta()
      });
    }

    updatedProfileRow = updatedRow;
  }

  /* Handle crew_tag upsert into employee_payment_details */
  if (payload.crewTag !== undefined) {
    const trimmedCrewTag = payload.crewTag?.trim() || null;

    try {
      if (trimmedCrewTag) {
        await serviceRoleClient
          .from("employee_payment_details")
          .upsert(
            {
              org_id: session.profile.org_id,
              employee_id: personId,
              crew_tag: trimmedCrewTag,
              payment_method: "crew_tag"
            },
            { onConflict: "org_id,employee_id" }
          );
      } else {
        await serviceRoleClient
          .from("employee_payment_details")
          .update({ crew_tag: null })
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", personId);
      }
    } catch {
      /* best-effort — crew tag update failure should not block profile save */
    }
  }

  const parsedUpdatedRow = profileRowSchema.safeParse(updatedProfileRow);

  if (!parsedUpdatedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Updated profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Auto-create leave balances for all applicable types when status changes to "active"
  if (
    payload.status === "active" &&
    parsedExistingProfile.data.status !== "active"
  ) {
    try {
      const currentYear = new Date().getUTCFullYear();
      const employeeCountryCode = parsedUpdatedRow.data.country_code;

      // Fetch all leave policies for the employee's country
      const { data: policies } = await serviceRoleClient
        .from("leave_policies")
        .select("leave_type, default_days_per_year, is_unlimited")
        .eq("org_id", session.profile.org_id)
        .eq("country_code", employeeCountryCode ?? "")
        .is("deleted_at", null);

      // Determine which leave types need balances (skip unlimited and probation-only)
      const balanceTypes = (policies ?? []).filter(
        (p) => !p.is_unlimited && p.leave_type !== "unpaid_personal_day"
      );

      for (const policy of balanceTypes) {
        const { data: existingBalance } = await serviceRoleClient
          .from("leave_balances")
          .select("id")
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", personId)
          .eq("year", currentYear)
          .eq("leave_type", policy.leave_type)
          .is("deleted_at", null)
          .maybeSingle();

        if (!existingBalance) {
          let totalDays = policy.leave_type === "annual_leave" ? 20 : 5;

          if (policy.default_days_per_year) {
            const policyDays =
              typeof policy.default_days_per_year === "string"
                ? Number.parseFloat(policy.default_days_per_year)
                : (policy.default_days_per_year as number);

            if (Number.isFinite(policyDays) && policyDays > 0) {
              totalDays = policyDays;
            }
          }

          const { error: balanceError } = await serviceRoleClient
            .from("leave_balances")
            .insert({
              org_id: session.profile.org_id,
              employee_id: personId,
              leave_type: policy.leave_type,
              year: currentYear,
              total_days: totalDays,
              used_days: 0,
              pending_days: 0,
              carried_days: 0
            });

          if (balanceError) {
            console.error("Unable to auto-create leave balance on activation.", {
              personId,
              leaveType: policy.leave_type,
              year: currentYear,
              message: balanceError.message
            });
          }
        }
      }
    } catch (error) {
      console.error("Leave balance auto-creation failed (non-blocking).", {
        personId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const managerId = parsedUpdatedRow.data.manager_id;
  let managerNameById = new Map<string, string>();

  if (managerId) {
    const { data: managerRows } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .eq("id", managerId);

    managerNameById = new Map(
      (managerRows ?? [])
        .filter(
          (row): row is { id: string; full_name: string } =>
            typeof row?.id === "string" && typeof row?.full_name === "string"
        )
        .map((row) => [row.id, row.full_name])
    );
  }

  /* Fetch crew tag for this person */
  const { data: crewTagRow } = await serviceRoleClient
    .from("employee_payment_details")
    .select("crew_tag")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", personId)
    .not("crew_tag", "is", null)
    .maybeSingle();

  const person = mapPersonRow(
    parsedUpdatedRow.data,
    managerNameById,
    typeof crewTagRow?.crew_tag === "string" ? crewTagRow.crew_tag : null
  );

  let accessConfigChangedKeys: string[] = [];
  let accessSelection = resolveEffectiveUserNavSelection({
    roles: nextRoles,
    overrides: shouldUpdateAccess ? payload.accessOverrides : undefined
  });

  if (shouldUpdateAccess) {
    try {
      const accessUpdate = await applyUserNavigationAccess({
        supabase: serviceRoleClient,
        orgId: session.profile.org_id,
        employeeId: personId,
        actorUserId: session.profile.id,
        roles: nextRoles,
        overrides: payload.accessOverrides
      });

      accessConfigChangedKeys = accessUpdate.changedNavItemKeys;
      accessSelection = {
        granted: accessUpdate.grantedNavItemKeys,
        revoked: accessUpdate.revokedNavItemKeys
      };
    } catch (error) {
      console.error("Unable to apply navigation access during user update.", {
        personId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: person.id,
    oldValue: {
      roles: existingRoles,
      department: parsedExistingProfile.data.department,
      title: parsedExistingProfile.data.title,
      managerId: parsedExistingProfile.data.manager_id,
      status: parsedExistingProfile.data.status
    },
    newValue: {
      roles: person.roles,
      department: person.department,
      title: person.title,
      managerId: person.managerId,
      status: person.status
    }
  });

  if (accessConfigChangedKeys.length > 0) {
    await logAudit({
      action: "updated",
      tableName: "navigation_access_config",
      recordId: person.id,
      newValue: {
        employeeId: person.id,
        grantedNavItemKeys: accessSelection.granted,
        revokedNavItemKeys: accessSelection.revoked,
        changedNavItemKeys: accessConfigChangedKeys
      }
    });
  }

  return jsonResponse<PeopleUpdateResponseData>(200, {
    data: {
      person
    },
    error: null,
    meta: buildMeta()
  });
}

const selfUpdateSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required.").max(200, "Name is too long.").optional(),
  phone: z.string().trim().max(30, "Phone is too long.").nullable().optional(),
  timezone: z.string().trim().max(50, "Timezone is too long.").nullable().optional(),
  pronouns: z.string().trim().max(50, "Pronouns must be 50 characters or fewer.").nullable().optional(),
  emergencyContactName: z.string().trim().max(200, "Emergency contact name is too long.").nullable().optional(),
  emergencyContactPhone: z.string().trim().max(30, "Emergency contact phone is too long.").nullable().optional(),
  emergencyContactRelationship: z.string().trim().max(100, "Emergency contact relationship is too long.").nullable().optional(),
  avatarUrl: z.string().url("Avatar URL must be a valid URL.").nullable().optional(),
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer.").nullable().optional(),
  favoriteMusic: z.string().trim().max(200, "Favorite music must be 200 characters or fewer.").nullable().optional(),
  favoriteBooks: z.string().trim().max(200, "Favorite books must be 200 characters or fewer.").nullable().optional(),
  favoriteSports: z.string().trim().max(200, "Favorite sports must be 200 characters or fewer.").nullable().optional(),
  privacySettings: z.object({
    showEmail: z.boolean().optional(),
    showPhone: z.boolean().optional(),
    showDepartment: z.boolean().optional(),
    showBio: z.boolean().optional(),
    showInterests: z.boolean().optional()
  }).optional()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update your profile."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid user id."
      },
      meta: buildMeta()
    });
  }

  const personId = parsedParams.data.id;
  const isSelf = personId === session.profile.id;
  const isAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!isSelf && !isAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You can only update your own profile."
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

  const parsedBody = selfUpdateSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const serviceRoleClient = createSupabaseServiceRoleClient();

  const updateValues: Record<string, unknown> = {};

  if (payload.fullName !== undefined) {
    updateValues.full_name = payload.fullName.trim();
  }

  if (payload.phone !== undefined) {
    updateValues.phone = payload.phone?.trim() || null;
  }

  if (payload.timezone !== undefined) {
    updateValues.timezone = payload.timezone?.trim() || null;
  }

  if (payload.pronouns !== undefined) {
    updateValues.pronouns = payload.pronouns?.trim() || null;
  }

  if (payload.emergencyContactName !== undefined) {
    updateValues.emergency_contact_name = payload.emergencyContactName?.trim() || null;
  }

  if (payload.emergencyContactPhone !== undefined) {
    updateValues.emergency_contact_phone = payload.emergencyContactPhone?.trim() || null;
  }

  if (payload.emergencyContactRelationship !== undefined) {
    updateValues.emergency_contact_relationship = payload.emergencyContactRelationship?.trim() || null;
  }

  if (payload.avatarUrl !== undefined) {
    updateValues.avatar_url = payload.avatarUrl;
  }

  if (payload.bio !== undefined) {
    updateValues.bio = payload.bio?.trim() || null;
  }

  if (payload.favoriteMusic !== undefined) {
    updateValues.favorite_music = payload.favoriteMusic?.trim() || null;
  }

  if (payload.favoriteBooks !== undefined) {
    updateValues.favorite_books = payload.favoriteBooks?.trim() || null;
  }

  if (payload.favoriteSports !== undefined) {
    updateValues.favorite_sports = payload.favoriteSports?.trim() || null;
  }

  if (payload.privacySettings !== undefined) {
    updateValues.privacy_settings = payload.privacySettings;
  }

  if (Object.keys(updateValues).length === 0) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "No fields to update."
      },
      meta: buildMeta()
    });
  }

  const { data: updatedRow, error: updateError } = await serviceRoleClient
    .from("profiles")
    .update(updateValues)
    .eq("id", personId)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, privacy_settings, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to update profile."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedRow = profileRowSchema.safeParse(updatedRow);

  if (!parsedUpdatedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Updated profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const managerId = parsedUpdatedRow.data.manager_id;
  let managerNameById = new Map<string, string>();

  if (managerId) {
    const { data: managerRows } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .eq("id", managerId);

    managerNameById = new Map(
      (managerRows ?? [])
        .filter(
          (row): row is { id: string; full_name: string } =>
            typeof row?.id === "string" && typeof row?.full_name === "string"
        )
        .map((row) => [row.id, row.full_name])
    );
  }

  /* Fetch crew tag for this person */
  const { data: selfCrewTagRow } = await serviceRoleClient
    .from("employee_payment_details")
    .select("crew_tag")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", personId)
    .not("crew_tag", "is", null)
    .maybeSingle();

  const person = mapPersonRow(
    parsedUpdatedRow.data,
    managerNameById,
    typeof selfCrewTagRow?.crew_tag === "string" ? selfCrewTagRow.crew_tag : null
  );

  return jsonResponse<PeopleUpdateResponseData>(200, {
    data: {
      person
    },
    error: null,
    meta: buildMeta()
  });
}
