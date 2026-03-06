import type { ApiResponse } from "./auth";

export const SETTINGS_TABS = [
  "profile",
  "organization",
  "time-policies",
  "notifications",
  "security",
  "audit"
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type NotificationPreferences = {
  emailAnnouncements: boolean;
  emailApprovals: boolean;
  inAppReminders: boolean;
};

export const AUDIT_LOG_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "approved",
  "rejected",
  "submitted",
  "cancelled",
  "login",
  "logout"
] as const;

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorName: string;
  action: AuditLogAction;
  tableName: string;
  recordId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
};

export type AuditLogActor = {
  id: string;
  fullName: string;
};

export type AuditLogsResponseData = {
  entries: AuditLogEntry[];
  actors: AuditLogActor[];
  actionOptions: AuditLogAction[];
  tableOptions: string[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditLogsResponse = ApiResponse<AuditLogsResponseData>;
