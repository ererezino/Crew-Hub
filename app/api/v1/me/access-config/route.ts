import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  DASHBOARD_WIDGET_KEYS,
  defaultNavVisibilityForRoles,
  defaultWidgetVisibilityForRoles,
  getAllDashboardWidgetKeys,
  getDefaultVisibleRolesForNavItem,
  getDefaultVisibleRolesForWidget,
  getNavigationDefinitions,
  isNavItemVisibleForUser,
  isSuperAdmin,
  isWidgetVisibleForUser,
  sanitizeRoles
} from "../../../../../lib/access-control";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { MeAccessConfigResponseData } from "../../../../../types/access-control";

const navRowSchema = z.object({
  nav_item_key: z.string(),
  visible_to_roles: z.array(z.string()),
  granted_employee_ids: z.array(z.string().uuid()).nullable(),
  revoked_employee_ids: z.array(z.string().uuid()).nullable()
});

const widgetRowSchema = z.object({
  widget_key: z.enum(DASHBOARD_WIDGET_KEYS),
  visible_to_roles: z.array(z.string())
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view access configuration."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const userRoles = profile.roles;

  if (isSuperAdmin(userRoles)) {
    return jsonResponse<MeAccessConfigResponseData>(200, {
      data: {
        configExists: true,
        allowedNavItemKeys: getNavigationDefinitions().map((item) => item.key),
        allowedWidgetKeys: getAllDashboardWidgetKeys()
      },
      error: null,
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const [navResult, widgetResult] = await Promise.all([
    supabase
      .from("navigation_access_config")
      .select("nav_item_key, visible_to_roles, granted_employee_ids, revoked_employee_ids")
      .eq("org_id", profile.org_id),
    supabase
      .from("dashboard_widget_config")
      .select("widget_key, visible_to_roles")
      .eq("org_id", profile.org_id)
  ]);

  if (navResult.error || widgetResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ACCESS_CONFIG_FETCH_FAILED",
        message: navResult.error?.message ?? widgetResult.error?.message ?? "Unable to fetch access config."
      },
      meta: buildMeta()
    });
  }

  const parsedNavRows = z.array(navRowSchema).safeParse(navResult.data ?? []);
  const parsedWidgetRows = z.array(widgetRowSchema).safeParse(widgetResult.data ?? []);

  if (!parsedNavRows.success || !parsedWidgetRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ACCESS_CONFIG_PARSE_FAILED",
        message: "Access configuration data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const configExists = parsedNavRows.data.length > 0 || parsedWidgetRows.data.length > 0;

  if (!configExists) {
    return jsonResponse<MeAccessConfigResponseData>(200, {
      data: {
        configExists: false,
        allowedNavItemKeys: defaultNavVisibilityForRoles(userRoles),
        allowedWidgetKeys: defaultWidgetVisibilityForRoles(userRoles)
      },
      error: null,
      meta: buildMeta()
    });
  }

  const navRowByKey = new Map(parsedNavRows.data.map((row) => [row.nav_item_key, row] as const));
  const widgetRowByKey = new Map(parsedWidgetRows.data.map((row) => [row.widget_key, row] as const));

  const allowedNavItemKeys = getNavigationDefinitions()
    .map((definition) => {
      const row = navRowByKey.get(definition.key);
      const visibleToRoles = row
        ? sanitizeRoles(row.visible_to_roles)
        : getDefaultVisibleRolesForNavItem(definition.key);

      const isVisible = isNavItemVisibleForUser({
        userId: profile.id,
        userRoles,
        visibleToRoles,
        grantedEmployeeIds: row?.granted_employee_ids ?? [],
        revokedEmployeeIds: row?.revoked_employee_ids ?? []
      });

      return isVisible ? definition.key : null;
    })
    .filter((value): value is string => Boolean(value));

  const allowedWidgetKeys = DASHBOARD_WIDGET_KEYS.filter((widgetKey) => {
    const row = widgetRowByKey.get(widgetKey);
    const visibleToRoles = row
      ? sanitizeRoles(row.visible_to_roles)
      : getDefaultVisibleRolesForWidget(widgetKey);

    return isWidgetVisibleForUser({
      userRoles,
      visibleToRoles
    });
  });

  return jsonResponse<MeAccessConfigResponseData>(200, {
    data: {
      configExists: true,
      allowedNavItemKeys,
      allowedWidgetKeys
    },
    error: null,
    meta: buildMeta()
  });
}
