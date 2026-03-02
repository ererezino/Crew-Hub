import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  DASHBOARD_WIDGET_DEFINITIONS,
  DASHBOARD_WIDGET_KEYS,
  defaultNavigationConfigPayload,
  defaultWidgetConfigPayload,
  getDefaultVisibleRolesForNavItem,
  getDefaultVisibleRolesForWidget,
  getNavigationDefinitions,
  normalizeNavigationPayload,
  normalizeWidgetPayload,
  sanitizeRoles
} from "../../../../../lib/access-control";
import { logAudit } from "../../../../../lib/audit";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { USER_ROLES } from "../../../../../lib/navigation";
import type { ApiResponse } from "../../../../../types/auth";
import type {
  AdminAccessConfigResponseData,
  DashboardWidgetConfigRecord,
  NavigationAccessConfigRecord
} from "../../../../../types/access-control";

const roleSchema = z.enum(USER_ROLES);
const widgetKeySchema = z.enum(DASHBOARD_WIDGET_KEYS);

const navRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  nav_item_key: z.string(),
  visible_to_roles: z.array(z.string()),
  granted_employee_ids: z.array(z.string().uuid()).nullable(),
  revoked_employee_ids: z.array(z.string().uuid()).nullable(),
  updated_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const widgetRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  widget_key: widgetKeySchema,
  visible_to_roles: z.array(z.string()),
  updated_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const employeeRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().email(),
  department: z.string().nullable(),
  roles: z.array(z.string())
});

const updatePayloadSchema = z.object({
  navigation: z
    .array(
      z.object({
        navItemKey: z.string().trim().min(1).max(100),
        visibleToRoles: z.array(roleSchema).min(1),
        grantedEmployeeIds: z.array(z.string().uuid()).default([]),
        revokedEmployeeIds: z.array(z.string().uuid()).default([])
      })
    )
    .min(1),
  widgets: z
    .array(
      z.object({
        widgetKey: widgetKeySchema,
        visibleToRoles: z.array(roleSchema).min(1)
      })
    )
    .min(1)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapNavRow(row: z.infer<typeof navRowSchema>): NavigationAccessConfigRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    navItemKey: row.nav_item_key,
    visibleToRoles: sanitizeRoles(row.visible_to_roles),
    grantedEmployeeIds: row.granted_employee_ids ?? [],
    revokedEmployeeIds: row.revoked_employee_ids ?? [],
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWidgetRow(row: z.infer<typeof widgetRowSchema>): DashboardWidgetConfigRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    widgetKey: row.widget_key,
    visibleToRoles: sanitizeRoles(row.visible_to_roles),
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireSuperAdminSession() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return {
      session: null,
      response: jsonResponse<null>(401, {
        data: null,
        error: {
          code: "UNAUTHORIZED",
          message: "You must be logged in to manage access control."
        },
        meta: buildMeta()
      })
    };
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return {
      session,
      response: jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Only Super Admin can manage access control."
        },
        meta: buildMeta()
      })
    };
  }

  return {
    session,
    response: null
  };
}

async function seedDefaultsIfNeeded({
  supabase,
  orgId,
  userId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  userId: string;
}) {
  const [{ data: navRows, error: navError }, { data: widgetRows, error: widgetError }] =
    await Promise.all([
      supabase
        .from("navigation_access_config")
        .select("id")
        .eq("org_id", orgId)
        .limit(1),
      supabase
        .from("dashboard_widget_config")
        .select("id")
        .eq("org_id", orgId)
        .limit(1)
    ]);

  if (navError || widgetError) {
    throw new Error(navError?.message ?? widgetError?.message ?? "Unable to inspect access config state.");
  }

  if ((navRows ?? []).length === 0) {
    const defaults = defaultNavigationConfigPayload();
    const { error } = await supabase.from("navigation_access_config").insert(
      defaults.map((row) => ({
        org_id: orgId,
        nav_item_key: row.navItemKey,
        visible_to_roles: row.visibleToRoles,
        granted_employee_ids: row.grantedEmployeeIds,
        revoked_employee_ids: row.revokedEmployeeIds,
        updated_by: userId
      }))
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  if ((widgetRows ?? []).length === 0) {
    const defaults = defaultWidgetConfigPayload();
    const { error } = await supabase.from("dashboard_widget_config").insert(
      defaults.map((row) => ({
        org_id: orgId,
        widget_key: row.widgetKey,
        visible_to_roles: row.visibleToRoles,
        updated_by: userId
      }))
    );

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function fetchAdminAccessConfig({
  supabase,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}) {
  const [navResult, widgetResult, employeeResult] = await Promise.all([
    supabase
      .from("navigation_access_config")
      .select(
        "id, org_id, nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids, updated_by, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .order("nav_item_key", { ascending: true }),
    supabase
      .from("dashboard_widget_config")
      .select("id, org_id, widget_key, visible_to_roles, updated_by, created_at, updated_at")
      .eq("org_id", orgId)
      .order("widget_key", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email, department, roles")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
  ]);

  if (navResult.error || widgetResult.error || employeeResult.error) {
    throw new Error(
      navResult.error?.message ??
        widgetResult.error?.message ??
        employeeResult.error?.message ??
        "Unable to load access control configuration."
    );
  }

  const parsedNav = z.array(navRowSchema).safeParse(navResult.data ?? []);
  const parsedWidgets = z.array(widgetRowSchema).safeParse(widgetResult.data ?? []);
  const parsedEmployees = z.array(employeeRowSchema).safeParse(employeeResult.data ?? []);

  if (!parsedNav.success || !parsedWidgets.success || !parsedEmployees.success) {
    throw new Error("Access control configuration data is not in the expected shape.");
  }

  const navDefinitions = getNavigationDefinitions();
  const widgetDefinitions = [...DASHBOARD_WIDGET_DEFINITIONS];

  const mappedNavigation = parsedNav.data.map(mapNavRow);
  const mappedWidgets = parsedWidgets.data.map(mapWidgetRow);
  const navigationByKey = new Map(
    mappedNavigation.map((row) => [row.navItemKey, row] as const)
  );
  const widgetByKey = new Map(
    mappedWidgets.map((row) => [row.widgetKey, row] as const)
  );

  return {
    navigation: navDefinitions.map((definition) => {
      return (
        navigationByKey.get(definition.key) ?? {
          id: `missing-${definition.key}`,
          orgId,
          navItemKey: definition.key,
          visibleToRoles: getDefaultVisibleRolesForNavItem(definition.key),
          grantedEmployeeIds: [],
          revokedEmployeeIds: [],
          updatedBy: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }
      );
    }),
    widgets: widgetDefinitions.map((definition) => {
      return (
        widgetByKey.get(definition.key) ?? {
          id: `missing-${definition.key}`,
          orgId,
          widgetKey: definition.key,
          visibleToRoles: getDefaultVisibleRolesForWidget(definition.key),
          updatedBy: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }
      );
    }),
    employees: parsedEmployees.data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      department: row.department,
      roles: sanitizeRoles(row.roles)
    })),
    navDefinitions,
    widgetDefinitions
  } satisfies AdminAccessConfigResponseData;
}

export async function GET() {
  const { session, response } = await requireSuperAdminSession();

  if (response) {
    return response;
  }

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage access control."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    await seedDefaultsIfNeeded({
      supabase,
      orgId: profile.org_id,
      userId: profile.id
    });

    const data = await fetchAdminAccessConfig({
      supabase,
      orgId: profile.org_id
    });

    return jsonResponse<AdminAccessConfigResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ACCESS_CONFIG_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load access configuration."
      },
      meta: buildMeta()
    });
  }
}

export async function PUT(request: Request) {
  const { session, response } = await requireSuperAdminSession();

  if (response) {
    return response;
  }

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage access control."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

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

  const parsedPayload = updatePayloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid access config payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  try {
    const normalizedNav = normalizeNavigationPayload(parsedPayload.data.navigation);
    const normalizedWidgets = normalizeWidgetPayload(parsedPayload.data.widgets);

    const [{ data: oldNavRows }, { data: oldWidgetRows }] = await Promise.all([
      supabase
        .from("navigation_access_config")
        .select(
          "id, org_id, nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids, updated_by, created_at, updated_at"
        )
        .eq("org_id", profile.org_id),
      supabase
        .from("dashboard_widget_config")
        .select("id, org_id, widget_key, visible_to_roles, updated_by, created_at, updated_at")
        .eq("org_id", profile.org_id)
    ]);

    const [{ error: navUpsertError }, { error: widgetUpsertError }] = await Promise.all([
      supabase.from("navigation_access_config").upsert(
        normalizedNav.map((row) => ({
          org_id: profile.org_id,
          nav_item_key: row.navItemKey,
          visible_to_roles: row.visibleToRoles,
          granted_employee_ids: row.grantedEmployeeIds,
          revoked_employee_ids: row.revokedEmployeeIds,
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })),
        { onConflict: "org_id,nav_item_key" }
      ),
      supabase.from("dashboard_widget_config").upsert(
        normalizedWidgets.map((row) => ({
          org_id: profile.org_id,
          widget_key: row.widgetKey,
          visible_to_roles: row.visibleToRoles,
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })),
        { onConflict: "org_id,widget_key" }
      )
    ]);

    if (navUpsertError || widgetUpsertError) {
      throw new Error(navUpsertError?.message ?? widgetUpsertError?.message ?? "Unable to persist access config.");
    }

    const data = await fetchAdminAccessConfig({
      supabase,
      orgId: profile.org_id
    });

    const oldNavCount = Array.isArray(oldNavRows) ? oldNavRows.length : 0;
    const oldWidgetCount = Array.isArray(oldWidgetRows) ? oldWidgetRows.length : 0;

    void logAudit({
      action: "updated",
      tableName: "navigation_access_config",
      recordId: profile.org_id,
      oldValue: { row_count: oldNavCount },
      newValue: { row_count: data.navigation.length }
    });

    void logAudit({
      action: "updated",
      tableName: "dashboard_widget_config",
      recordId: profile.org_id,
      oldValue: { row_count: oldWidgetCount },
      newValue: { row_count: data.widgets.length }
    });

    return jsonResponse<AdminAccessConfigResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ACCESS_CONFIG_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to update access configuration."
      },
      meta: buildMeta()
    });
  }
}
