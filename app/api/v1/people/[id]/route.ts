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
  managerId: z.string().uuid("Manager must be a valid user id.").nullable().optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
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
  employment_type: z.enum(["full_time", "part_time", "contractor"]),
  payroll_mode: z.enum([
    "contractor_usd_no_withholding",
    "employee_local_withholding",
    "employee_usd_withholding"
  ]),
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

function normalizeRoles(values: readonly string[]): AppRole[] {
  return values.filter((value): value is AppRole =>
    USER_ROLES.includes(value as AppRole)
  );
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

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can update user records."
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
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, employment_type, payroll_mode, primary_currency, status, created_at, updated_at"
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
    manager_id?: string | null;
    status?: ProfileStatus;
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

  if (payload.managerId !== undefined) {
    updateValues.manager_id = payload.managerId ?? null;
  }

  if (payload.status !== undefined) {
    updateValues.status = payload.status;
  }

  let updatedProfileRow: unknown = parsedExistingProfile.data;

  if (Object.keys(updateValues).length > 0) {
    const { data: updatedRow, error: updateError } = await serviceRoleClient
      .from("profiles")
      .update(updateValues)
      .eq("id", personId)
      .eq("org_id", session.profile.org_id)
      .select(
        "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, employment_type, payroll_mode, primary_currency, status, created_at, updated_at"
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

  const person = mapPersonRow(parsedUpdatedRow.data, managerNameById);

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
