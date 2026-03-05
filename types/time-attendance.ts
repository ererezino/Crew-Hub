import type { ApiResponse } from "./auth";

export const TIME_ENTRY_METHODS = ["web", "mobile", "kiosk", "manual"] as const;

export type TimeEntryMethod = (typeof TIME_ENTRY_METHODS)[number];

export const TIMESHEET_STATUSES = [
  "pending",
  "submitted",
  "approved",
  "rejected",
  "locked"
] as const;

export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const TIME_ROUNDING_RULES = [
  "none",
  "nearest_5",
  "nearest_15",
  "nearest_30"
] as const;

export type TimeRoundingRule = (typeof TIME_ROUNDING_RULES)[number];

export type TimeAttendanceProfile = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  timezone: string | null;
};

export type TimePolicyRecord = {
  id: string;
  orgId: string;
  name: string;
  appliesToDepartments: string[] | null;
  appliesToTypes: string[] | null;
  countryCode: string | null;
  weeklyHoursTarget: number;
  dailyHoursMax: number;
  overtimeAfterDaily: number | null;
  overtimeAfterWeekly: number | null;
  overtimeMultiplier: number;
  doubleTimeAfter: number | null;
  doubleTimeMultiplier: number;
  breakAfterHours: number;
  breakDurationMinutes: number;
  paidBreak: boolean;
  roundingRule: TimeRoundingRule;
  requireGeolocation: boolean;
  allowedLocations: unknown[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TimeEntryRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  employeeTimezone: string | null;
  policyId: string | null;
  clockIn: string;
  clockOut: string | null;
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
  clockInMethod: TimeEntryMethod;
  clockOutMethod: TimeEntryMethod | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimesheetRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  weekStart: string;
  weekEnd: string;
  totalRegularMinutes: number;
  totalOvertimeMinutes: number;
  totalDoubleTimeMinutes: number;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  status: TimesheetStatus;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeAttendanceOverviewTotals = {
  workedMinutesToday: number;
  breakMinutesToday: number;
  workedMinutesThisWeek: number;
  overtimeMinutesThisWeek: number;
  openEntrySeconds: number;
  pendingTimesheetCount: number;
};

export type TimeAttendanceOverviewResponseData = {
  profile: TimeAttendanceProfile;
  activeEntry: TimeEntryRecord | null;
  recentEntries: TimeEntryRecord[];
  recentTimesheets: TimesheetRecord[];
  totals: TimeAttendanceOverviewTotals;
};

export type TimeAttendanceOverviewResponse = ApiResponse<TimeAttendanceOverviewResponseData>;

export type TimeAttendanceEntriesResponseData = {
  entries: TimeEntryRecord[];
};

export type TimeAttendanceEntriesResponse = ApiResponse<TimeAttendanceEntriesResponseData>;

export type TimeAttendanceApprovalsResponseData = {
  timesheets: TimesheetRecord[];
};

export type TimeAttendanceApprovalsResponse = ApiResponse<TimeAttendanceApprovalsResponseData>;

export type TimeAttendanceApprovalMutationResponseData = {
  timesheet: TimesheetRecord;
};

export type TimeAttendanceApprovalMutationResponse = ApiResponse<TimeAttendanceApprovalMutationResponseData>;

export type TimeAttendancePoliciesResponseData = {
  policies: TimePolicyRecord[];
};

export type TimeAttendancePoliciesResponse = ApiResponse<TimeAttendancePoliciesResponseData>;
