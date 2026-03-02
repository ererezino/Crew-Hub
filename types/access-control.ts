import type { ApiResponse } from "./auth";
import type { DashboardWidgetKey } from "../lib/access-control";
import type { UserRole } from "../lib/navigation";

export type NavigationAccessConfigRecord = {
  id: string;
  orgId: string;
  navItemKey: string;
  visibleToRoles: UserRole[];
  grantedEmployeeIds: string[];
  revokedEmployeeIds: string[];
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardWidgetConfigRecord = {
  id: string;
  orgId: string;
  widgetKey: DashboardWidgetKey;
  visibleToRoles: UserRole[];
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccessControlProfileOption = {
  id: string;
  fullName: string;
  email: string;
  department: string | null;
  roles: UserRole[];
};

export type AccessControlNavDefinition = {
  key: string;
  label: string;
  description: string;
  groupLabel: string;
};

export type AccessControlWidgetDefinition = {
  key: DashboardWidgetKey;
  label: string;
  description: string;
};

export type AdminAccessConfigResponseData = {
  navigation: NavigationAccessConfigRecord[];
  widgets: DashboardWidgetConfigRecord[];
  employees: AccessControlProfileOption[];
  navDefinitions: AccessControlNavDefinition[];
  widgetDefinitions: AccessControlWidgetDefinition[];
};

export type AdminAccessConfigResponse = ApiResponse<AdminAccessConfigResponseData>;

export type AccessConfigUpdatePayload = {
  navigation: Array<{
    navItemKey: string;
    visibleToRoles: UserRole[];
    grantedEmployeeIds: string[];
    revokedEmployeeIds: string[];
  }>;
  widgets: Array<{
    widgetKey: DashboardWidgetKey;
    visibleToRoles: UserRole[];
  }>;
};

export type MeAccessConfigResponseData = {
  configExists: boolean;
  allowedNavItemKeys: string[];
  allowedWidgetKeys: DashboardWidgetKey[];
};

export type MeAccessConfigResponse = ApiResponse<MeAccessConfigResponseData>;
