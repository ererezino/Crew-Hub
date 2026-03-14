import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  applyUserNavigationAccess,
  resolveEffectiveUserNavSelection
} from "../../../../../lib/auth/navigation-access";
import { logAudit } from "../../../../../lib/audit";
import { logger } from "../../../../../lib/logger";
import {
  getDepartmentsValidationMessage,
  parseDepartment
} from "../../../../../lib/departments";
import { USER_ROLES } from "../../../../../lib/navigation";
import { createLeaveBalancesForActivation } from "../../../../../lib/onboarding/auto-transition";
import {
  buildMeta,
  jsonResponse,
  normalizeRoles,
  profileRowSchema,
  mapProfileRow,
  isValidStatusTransition,
  getStatusTransitionError
} from "../../../../../lib/people/shared";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { AppRole } from "../../../../../types/auth";
import {
  PROFILE_STATUSES,
  type PeopleUpdateResponseData,
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
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD.").nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD.").nullable().optional(),
  managerId: z.string().uuid("Manager must be a valid user id.").nullable().optional(),
  teamLeadId: z.string().uuid("Team lead must be a valid user id.").nullable().optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer.").nullable().optional(),
  favoriteMusic: z.string().trim().max(200, "Favorite music must be 200 characters or fewer.").nullable().optional(),
  favoriteBooks: z.string().trim().max(200, "Favorite books must be 200 characters or fewer.").nullable().optional(),
  favoriteSports: z.string().trim().max(200, "Favorite sports must be 200 characters or fewer.").nullable().optional(),
  crewTag: z.string().trim().max(50, "Crew Tag must be 50 characters or fewer.").nullable().optional(),
  directoryVisible: z.boolean().optional(),
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
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, directory_visible, privacy_settings, crew_hub_joined_at, first_invited_at, account_setup_at, last_seen_at, created_at, updated_at"
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
  const actorIsSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");

  const highRiskRoles = new Set<AppRole>(["SUPER_ADMIN", "HR_ADMIN", "FINANCE_ADMIN"]);
  const existingHighRiskRoleKey = existingRoles
    .filter((role): role is AppRole => highRiskRoles.has(role))
    .sort()
    .join("|");
  const nextHighRiskRoleKey = nextRoles
    .filter((role): role is AppRole => highRiskRoles.has(role))
    .sort()
    .join("|");

  if (
    payload.roles !== undefined &&
    !actorIsSuperAdmin &&
    existingHighRiskRoleKey !== nextHighRiskRoleKey
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only a Super Admin can modify admin-role assignments."
      },
      meta: buildMeta()
    });
  }

  // Prevent non-SUPER_ADMIN from assigning SUPER_ADMIN role
  if (
    nextRoles.includes("SUPER_ADMIN") &&
    !existingRoles.includes("SUPER_ADMIN") &&
    !actorIsSuperAdmin
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only a Super Admin can assign the Super Admin role."
      },
      meta: buildMeta()
    });
  }

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

  if (payload.teamLeadId === personId) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A person cannot be their own team lead."
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

  if (payload.teamLeadId) {
    const { data: teamLeadRow, error: teamLeadError } = await serviceRoleClient
      .from("profiles")
      .select("id")
      .eq("id", payload.teamLeadId)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (teamLeadError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "TEAM_LEAD_FETCH_FAILED",
          message: "Unable to validate team lead assignment."
        },
        meta: buildMeta()
      });
    }

    if (!teamLeadRow?.id) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Selected team lead was not found in this organization."
        },
        meta: buildMeta()
      });
    }
  }

  // Circular manager chain detection
  if (payload.managerId) {
    const chainIds: string[] = [payload.managerId];
    for (let i = 0; i < chainIds.length && i < 20; i++) {
      const currentId = chainIds[i];
      if (currentId === personId) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "This manager assignment would create a circular reporting chain."
          },
          meta: buildMeta()
        });
      }

      const { data: chainRow } = await serviceRoleClient
        .from("profiles")
        .select("manager_id")
        .eq("id", currentId)
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .maybeSingle();

      const nextId = (chainRow as { manager_id: string | null } | null)?.manager_id;
      if (nextId && !chainIds.includes(nextId)) {
        chainIds.push(nextId);
      }
    }
  }

  // Circular operational lead chain detection
  if (payload.teamLeadId) {
    const chainIds: string[] = [payload.teamLeadId];
    for (let i = 0; i < chainIds.length && i < 20; i++) {
      const currentId = chainIds[i];
      if (currentId === personId) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "This operational lead assignment would create a circular chain."
          },
          meta: buildMeta()
        });
      }

      const { data: chainRow } = await serviceRoleClient
        .from("profiles")
        .select("team_lead_id, manager_id")
        .eq("id", currentId)
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .maybeSingle();

      // Walk operational lead chain: team_lead_id if set, else manager_id (fallback)
      const row = chainRow as { team_lead_id: string | null; manager_id: string | null } | null;
      const nextId = row?.team_lead_id ?? row?.manager_id;
      if (nextId && !chainIds.includes(nextId)) {
        chainIds.push(nextId);
      }
    }
  }

  const updateValues: {
    full_name?: string;
    roles?: string[];
    department?: string | null;
    title?: string | null;
    start_date?: string | null;
    date_of_birth?: string | null;
    manager_id?: string | null;
    team_lead_id?: string | null;
    status?: ProfileStatus;
    bio?: string | null;
    favorite_music?: string | null;
    favorite_books?: string | null;
    favorite_sports?: string | null;
    privacy_settings?: Record<string, boolean>;
    directory_visible?: boolean;
  } = {};

  if (payload.directoryVisible !== undefined) {
    updateValues.directory_visible = payload.directoryVisible;
  }

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

  if (payload.startDate !== undefined) {
    updateValues.start_date = payload.startDate ?? null;
  }

  if (payload.dateOfBirth !== undefined) {
    updateValues.date_of_birth = payload.dateOfBirth ?? null;
  }

  if (payload.managerId !== undefined) {
    updateValues.manager_id = payload.managerId ?? null;
  }

  if (payload.teamLeadId !== undefined) {
    updateValues.team_lead_id = payload.teamLeadId ?? null;
  }

  if (payload.status !== undefined) {
    const currentStatus = parsedExistingProfile.data.status;
    if (!isValidStatusTransition(currentStatus, payload.status)) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "INVALID_STATUS_TRANSITION",
          message: getStatusTransitionError(currentStatus, payload.status)
        },
        meta: buildMeta()
      });
    }
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
        "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, directory_visible, privacy_settings, crew_hub_joined_at, first_invited_at, account_setup_at, last_seen_at, created_at, updated_at"
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

    /* Revoke all sessions when an account is disabled */
    if (
      payload.status === "inactive" &&
      parsedExistingProfile.data.status !== "inactive"
    ) {
      await serviceRoleClient.auth.admin
        .signOut(personId, "global")
        .catch(() => undefined);
    }
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

  // Auto-create leave balances when status changes to "active"
  if (
    payload.status === "active" &&
    parsedExistingProfile.data.status !== "active"
  ) {
    await createLeaveBalancesForActivation({
      supabase: serviceRoleClient,
      orgId: session.profile.org_id,
      employeeId: personId,
      countryCode: parsedUpdatedRow.data.country_code
    });
  }

  /* Auto-complete/cancel onboarding instances when transitioning away from "onboarding".
     - onboarding → active: mark instances as "completed"
     - onboarding → offboarding/inactive: mark instances as "cancelled" */
  if (
    parsedExistingProfile.data.status === "onboarding" &&
    payload.status &&
    payload.status !== "onboarding"
  ) {
    try {
      const newInstanceStatus = payload.status === "active" ? "completed" : "cancelled";
      await serviceRoleClient
        .from("onboarding_instances")
        .update({
          status: newInstanceStatus,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("employee_id", personId)
        .eq("status", "active")
        .eq("type", "onboarding");

      logger.info(`Onboarding instances ${newInstanceStatus} for employee on status transition.`, {
        personId,
        fromStatus: parsedExistingProfile.data.status,
        toStatus: payload.status
      });
    } catch (error) {
      logger.error("Failed to update onboarding instances on status transition (non-blocking).", {
        personId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const lookupIds = [
    parsedUpdatedRow.data.manager_id,
    parsedUpdatedRow.data.team_lead_id ?? null
  ].filter((id): id is string => Boolean(id));

  let nameById = new Map<string, string>();

  if (lookupIds.length > 0) {
    const { data: nameRows } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", lookupIds);

    nameById = new Map(
      (nameRows ?? [])
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

  const person = mapProfileRow(
    parsedUpdatedRow.data,
    nameById,
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
      logger.error("Unable to apply navigation access during user update.", {
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
      startDate: parsedExistingProfile.data.start_date,
      managerId: parsedExistingProfile.data.manager_id,
      teamLeadId: parsedExistingProfile.data.team_lead_id,
      status: parsedExistingProfile.data.status
    },
    newValue: {
      roles: person.roles,
      department: person.department,
      title: person.title,
      startDate: person.startDate,
      managerId: person.managerId,
      teamLeadId: person.teamLeadId,
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
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, date_of_birth, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, bio, favorite_music, favorite_books, favorite_sports, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pronouns, directory_visible, privacy_settings, crew_hub_joined_at, first_invited_at, account_setup_at, last_seen_at, created_at, updated_at"
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

  const selfLookupIds = [
    parsedUpdatedRow.data.manager_id,
    parsedUpdatedRow.data.team_lead_id ?? null
  ].filter((id): id is string => Boolean(id));

  let selfNameById = new Map<string, string>();

  if (selfLookupIds.length > 0) {
    const { data: nameRows } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", selfLookupIds);

    selfNameById = new Map(
      (nameRows ?? [])
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

  const person = mapProfileRow(
    parsedUpdatedRow.data,
    selfNameById,
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
