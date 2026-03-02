import type { ApiResponse } from "./auth";

export const NOTIFICATION_TYPES = [
  "leave_submitted",
  "leave_status",
  "payroll_approved",
  "expense_submitted",
  "expense_status",
  "onboarding_task",
  "payslip_ready",
  "payment_details_changed",
  "compliance_deadline",
  "announcement",
  "welcome",
  "signature_requested",
  "signature_signed",
  "signature_completed"
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationRecord = {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponseData = {
  notifications: NotificationRecord[];
  unreadCount: number;
};

export type MarkNotificationReadResponseData = {
  notificationId: string;
  readAt: string;
};

export type NotificationsResponse = ApiResponse<NotificationsResponseData>;
export type MarkNotificationReadResponse = ApiResponse<MarkNotificationReadResponseData>;
