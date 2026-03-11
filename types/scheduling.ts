import type { ApiResponse } from "./auth";

export const SCHEDULE_STATUSES = ["draft", "published", "locked"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SHIFT_STATUSES = ["scheduled", "swap_requested", "swapped", "cancelled"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_SWAP_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
export type ShiftSwapStatus = (typeof SHIFT_SWAP_STATUSES)[number];

export type ShiftTemplateRecord = {
  id: string;
  orgId: string;
  name: string;
  department: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleTrack = "weekday" | "weekend";

export type WeekendHourOption = "2" | "3" | "4" | "8";

export type ScheduleRecord = {
  id: string;
  orgId: string;
  name: string | null;
  department: string | null;
  startDate: string;
  endDate: string;
  scheduleTrack: ScheduleTrack;
  status: ScheduleStatus;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByName: string | null;
  createdAt: string;
  updatedAt: string;
  shiftCount: number;
};

export type ScheduleRosterEntry = {
  id: string;
  scheduleId: string;
  employeeId: string;
  employeeName?: string;
  employeeDepartment?: string;
  employeeCountryCode?: string;
  scheduleType?: string;
  weekendHours: WeekendHourOption | null;
};

export type ShiftRecord = {
  id: string;
  orgId: string;
  scheduleId: string;
  scheduleName: string | null;
  templateId: string | null;
  templateName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: ShiftStatus;
  notes: string | null;
  color: string | null;
  isOpenShift: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShiftSwapRecord = {
  id: string;
  orgId: string;
  shiftId: string;
  shiftDate: string;
  shiftStartTime: string;
  shiftEndTime: string;
  requesterId: string;
  requesterName: string;
  targetId: string | null;
  targetName: string | null;
  reason: string | null;
  status: ShiftSwapStatus;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SchedulingSchedulesResponseData = {
  schedules: ScheduleRecord[];
};

export type SchedulingSchedulesResponse = ApiResponse<SchedulingSchedulesResponseData>;

export type SchedulingTemplatesResponseData = {
  templates: ShiftTemplateRecord[];
};

export type SchedulingTemplatesResponse = ApiResponse<SchedulingTemplatesResponseData>;

export type SchedulingShiftsResponseData = {
  shifts: ShiftRecord[];
};

export type SchedulingShiftsResponse = ApiResponse<SchedulingShiftsResponseData>;

export type SchedulingSwapsResponseData = {
  swaps: ShiftSwapRecord[];
};

export type SchedulingSwapsResponse = ApiResponse<SchedulingSwapsResponseData>;

export type SchedulingScheduleMutationResponseData = {
  schedule: ScheduleRecord;
};

export type SchedulingShiftMutationResponseData = {
  shift: ShiftRecord;
};

export type SchedulingTemplateMutationResponseData = {
  template: ShiftTemplateRecord;
};

export type SchedulingSwapMutationResponseData = {
  swap: ShiftSwapRecord;
};
