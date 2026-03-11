import type { ApiResponse } from "./auth";

export const LEAVE_TYPES = [
  "annual_leave",
  "sick_leave",
  "personal_day",
  "birthday_leave",
  "unpaid_personal_day",
  "maternity_leave",
  "paternity_leave"
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

/** Leave types where balance tracking is skipped entirely (unlimited). */
export const UNLIMITED_LEAVE_TYPES: ReadonlySet<string> = new Set(["sick_leave", "sick"]);

/** Leave types that should NOT appear in the employee request form (auto-granted). */
export const AUTO_GRANTED_LEAVE_TYPES: ReadonlySet<string> = new Set(["birthday_leave"]);

export const LEAVE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled"
] as const;

export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const LEAVE_ACCRUAL_TYPES = [
  "annual_upfront",
  "monthly",
  "quarterly",
  "manual"
] as const;

export type LeaveAccrualType = (typeof LEAVE_ACCRUAL_TYPES)[number];

export type LeavePolicy = {
  id: string;
  countryCode: string;
  leaveType: string;
  defaultDaysPerYear: number;
  accrualType: LeaveAccrualType;
  carryOver: boolean;
  isUnlimited: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeaveBalance = {
  id: string;
  employeeId: string;
  leaveType: string;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  carriedDays: number;
  availableDays: number;
  createdAt: string;
  updatedAt: string;
};

export type LeaveRequestRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  status: LeaveRequestStatus;
  reason: string;
  approverId: string | null;
  approverName: string | null;
  rejectionReason: string | null;
  requiresDocumentation?: boolean;
  medicalEvidencePath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HolidayCalendarDay = {
  id: string;
  countryCode: string;
  date: string;
  name: string;
  year: number;
};

export type TimeOffSummaryProfile = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  dateOfBirth: string | null;
  status: string | null;
};

export type TimeOffSummaryResponseData = {
  profile: TimeOffSummaryProfile;
  policies: LeavePolicy[];
  balances: LeaveBalance[];
  requests: LeaveRequestRecord[];
  holidays: HolidayCalendarDay[];
};

export type TimeOffSummaryResponse = ApiResponse<TimeOffSummaryResponseData>;

export type TimeOffRequestMutationResponseData = {
  request: LeaveRequestRecord;
};

export type TimeOffRequestMutationResponse = ApiResponse<TimeOffRequestMutationResponseData>;

export type TimeOffApprovalsResponseData = {
  requests: LeaveRequestRecord[];
};

export type TimeOffApprovalsResponse = ApiResponse<TimeOffApprovalsResponseData>;

export type TimeOffCalendarFilterOptions = {
  countries: string[];
  departments: string[];
};

export type AfkCalendarRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  notes: string;
  createdAt: string;
};

export type TimeOffCalendarResponseData = {
  month: string;
  monthStart: string;
  monthEnd: string;
  requests: LeaveRequestRecord[];
  afkLogs: AfkCalendarRecord[];
  holidays: HolidayCalendarDay[];
  filters: TimeOffCalendarFilterOptions;
};

export type TimeOffCalendarResponse = ApiResponse<TimeOffCalendarResponseData>;

export type AfkLogRecord = {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  reclassifiedAs: string | null;
  leaveRequestId: string | null;
  notes: string;
  createdAt: string;
};

export type AfkLogsResponseData = {
  logs: AfkLogRecord[];
  weeklyCount: number;
  weeklyLimit: number;
};

export type AfkLogsResponse = ApiResponse<AfkLogsResponseData>;

export type BirthdayChoiceResponseData = {
  requestId: string;
  chosenDate: string;
};

export type BirthdayChoiceResponse = ApiResponse<BirthdayChoiceResponseData>;
