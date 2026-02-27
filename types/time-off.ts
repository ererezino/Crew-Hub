import type { ApiResponse } from "./auth";

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

export type TimeOffCalendarResponseData = {
  month: string;
  monthStart: string;
  monthEnd: string;
  requests: LeaveRequestRecord[];
  holidays: HolidayCalendarDay[];
  filters: TimeOffCalendarFilterOptions;
};

export type TimeOffCalendarResponse = ApiResponse<TimeOffCalendarResponseData>;
