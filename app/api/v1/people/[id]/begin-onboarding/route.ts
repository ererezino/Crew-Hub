import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { getAuthMutationBlockReason } from "../../../../../../lib/auth/auth-mutation-guard";
import {
  applyUserNavigationAccess
} from "../../../../../../lib/auth/navigation-access";
import { logAudit } from "../../../../../../lib/audit";
import { logger } from "../../../../../../lib/logger";
import type { UserRole } from "../../../../../../lib/navigation";
import {
  buildMeta,
  jsonResponse,
  normalizeRoles,
  profileRowSchema,
  mapProfileRow
} from "../../../../../../lib/people/shared";
import { deriveSystemPassword } from "../../../../../../lib/auth/system-password";
import { createNotification } from "../../../../../../lib/notifications/service";
import { createOnboardingInstance } from "../../../../../../lib/onboarding/create-instance";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { PeopleUpdateResponseData } from "../../../../../../types/people";

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

// ── POST /api/v1/people/[id]/begin-onboarding ───────────────────────────
//
// Transitions a pre_start person to onboarding:
// 1. Creates an auth user with the person's email
// 2. Updates profile status to "onboarding"
// 3. Creates an onboarding instance from the best-match template
// 4. Sends welcome notification

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can begin onboarding."
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

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid person id."
      },
      meta: buildMeta()
    });
  }

  const personId = parsedParams.data.id;
  const orgId = session.profile.org_id;
  const svc = createSupabaseServiceRoleClient();

  // Fetch current profile
  const { data: existingProfile, error: fetchError } = await svc
    .from("profiles")
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, avatar_url, directory_visible, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .eq("id", personId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !existingProfile) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Person not found in this organisation."
      },
      meta: buildMeta()
    });
  }

  const parsed = profileRowSchema.safeParse(existingProfile);
  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsed.data.status !== "pre_start") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_STATUS_TRANSITION",
        message: `Only pre-start people can begin onboarding. This person's status is "${parsed.data.status}".`
      },
      meta: buildMeta()
    });
  }

  // ── 1. Activate auth user ────────────────────────────────────────────
  //
  // Pre-start people already have a placeholder auth user (unconfirmed
  // email, random password). Confirm the email and set the system password
  // so the account becomes usable.

  const authUserId = personId; // profile.id === auth user id

  const systemPassword = deriveSystemPassword(authUserId);
  const { error: authUpdateError } = await svc.auth.admin.updateUserById(authUserId, {
    email_confirm: true,
    password: systemPassword,
    user_metadata: { full_name: parsed.data.full_name, pre_start: undefined }
  });

  if (authUpdateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "AUTH_USER_UPDATE_FAILED",
        message: "Unable to activate authentication user."
      },
      meta: buildMeta()
    });
  }

  // ── 2. Update profile status to onboarding ─────────────────────────

  const { data: newProfile, error: updateError } = await svc
    .from("profiles")
    .update({ status: "onboarding" })
    .eq("id", personId)
    .eq("org_id", orgId)
    .select(
      "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, avatar_url, directory_visible, account_setup_at, last_seen_at, created_at, updated_at"
    )
    .single();

  if (updateError || !newProfile) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to transition profile to onboarding."
      },
      meta: buildMeta()
    });
  }

  const parsedNewProfile = profileRowSchema.safeParse(newProfile);
  if (!parsedNewProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Onboarding profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // ── 3. Create onboarding instance ────────────────────────────────────

  let onboardingInstanceId: string | null = null;
  const normalizedDepartment = parsed.data.department;
  const countryCode = parsed.data.country_code;

  // Template resolution (same cascading logic as create person)
  let onboardingTemplate: {
    id: string;
    name: string;
    type: "onboarding" | "offboarding";
    tasks: unknown;
  } | null = null;

  // Step 1: Org-specific template matching department
  if (normalizedDepartment) {
    const { data: orgTemplateRow } = await svc
      .from("onboarding_templates")
      .select("id, name, type, tasks")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .eq("type", "onboarding")
      .eq("department", normalizedDepartment)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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

  // Step 2: System default by country
  if (!onboardingTemplate && countryCode) {
    const { data: countryDefaultRow } = await svc
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

  // Step 3: Universal system default
  if (!onboardingTemplate) {
    const { data: universalDefaultRow } = await svc
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

  if (onboardingTemplate) {
    try {
      const result = await createOnboardingInstance({
        supabase: svc,
        orgId,
        employee: { id: authUserId, fullName: parsed.data.full_name },
        template: onboardingTemplate,
        type: "onboarding",
        startedAt: parsed.data.start_date ?? undefined,
        creatingAdminId: session.profile.id
      });

      onboardingInstanceId = result.instance.id;

      await createNotification({
        orgId,
        userId: authUserId,
        type: "onboarding_task",
        title: "Onboarding started",
        body: "A new onboarding plan has been assigned to you.",
        link: `/onboarding/${result.instance.id}`
      });
    } catch (error) {
      logger.error("Unable to auto-create onboarding instance during begin-onboarding.", {
        personId: authUserId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // ── 4. Apply navigation access ───────────────────────────────────────

  const roles = normalizeRoles(parsed.data.roles);

  try {
    await applyUserNavigationAccess({
      supabase: svc,
      orgId,
      employeeId: authUserId,
      actorUserId: session.profile.id,
      roles: roles as UserRole[],
      overrides: undefined
    });
  } catch (error) {
    logger.error("Unable to apply navigation access during begin-onboarding.", {
      personId: authUserId,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  // ── 5. Send welcome notification ─────────────────────────────────────

  await createNotification({
    orgId,
    userId: authUserId,
    type: "welcome",
    title: "Welcome to Crew Hub",
    body: "Welcome to the team! Check your email to finish setting up your account.",
    link: "/settings"
  });

  // ── 6. Audit ─────────────────────────────────────────────────────────

  await logAudit({
    action: "updated",
    tableName: "profiles",
    recordId: authUserId,
    oldValue: {
      id: personId,
      status: "pre_start"
    },
    newValue: {
      id: personId,
      status: "onboarding",
      fullName: parsed.data.full_name,
      onboardingTemplateId: onboardingTemplate?.id ?? null,
      onboardingInstanceId,
      action: "begin_onboarding"
    }
  });

  // ── 7. Return updated person ─────────────────────────────────────────

  const lookupIds = [parsedNewProfile.data.manager_id, parsedNewProfile.data.team_lead_id ?? null]
    .filter((id): id is string => Boolean(id));

  let nameById = new Map<string, string>();
  if (lookupIds.length > 0) {
    const { data: nameRows } = await svc
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
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

  const person = mapProfileRow(parsedNewProfile.data, nameById, null);

  return jsonResponse<PeopleUpdateResponseData>(200, {
    data: { person },
    error: null,
    meta: buildMeta()
  });
}
