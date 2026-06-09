import type { ApiResponse } from "./auth";

export const WORK_TOOL_TYPES = [
  "laptop",
  "phone",
  "mouse",
  "webcam",
  "keyboard",
  "headset",
  "monitor",
  "microphone",
  "earbuds",
  "other"
] as const;

export type WorkToolType = (typeof WORK_TOOL_TYPES)[number];

export const WORK_TOOL_STATUSES = [
  "assigned",
  "maintenance",
  "available",
  "returned",
  "retired",
  "lost",
  "stolen"
] as const;

export type WorkToolStatus = (typeof WORK_TOOL_STATUSES)[number];

export const WORK_TOOL_REQUEST_KINDS = [
  "tool_request",
  "issue_report"
] as const;

export type WorkToolRequestKind = (typeof WORK_TOOL_REQUEST_KINDS)[number];

export const WORK_TOOL_ISSUE_TYPES = [
  "faulty",
  "stolen",
  "not_in_possession",
  "spec_mismatch"
] as const;

export type WorkToolIssueType = (typeof WORK_TOOL_ISSUE_TYPES)[number];

export const WORK_TOOL_REQUEST_STATUSES = [
  "open",
  "in_review",
  "approved",
  "fulfilled",
  "resolved",
  "declined"
] as const;

export type WorkToolRequestStatus = (typeof WORK_TOOL_REQUEST_STATUSES)[number];

export type WorkToolRecord = {
  id: string;
  orgId: string;
  employeeId: string | null;
  employeeName: string | null;
  itemType: WorkToolType;
  itemName: string;
  serialNumber: string | null;
  transactionCurrency: string | null;
  costAmount: number | null;
  status: WorkToolStatus;
  assignedAt: string | null;
  returnedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkToolRequestRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string | null;
  toolId: string | null;
  toolLabel: string | null;
  requestKind: WorkToolRequestKind;
  requestedItemType: WorkToolType | null;
  issueType: WorkToolIssueType | null;
  details: string;
  status: WorkToolRequestStatus;
  hrNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type WorkToolsAdminSummary = {
  assignedCount: number;
  employeeCount: number;
  outstandingOffboardingCount: number;
  openRequestCount: number;
};

export type WorkToolsAdminResponseData = {
  tools: WorkToolRecord[];
  requests: WorkToolRequestRecord[];
  summary: WorkToolsAdminSummary;
};

export type WorkToolsAdminResponse = ApiResponse<WorkToolsAdminResponseData>;

export type WorkToolUpsertResponseData = {
  tool: WorkToolRecord;
};

export type WorkToolUpsertResponse = ApiResponse<WorkToolUpsertResponseData>;

export type WorkToolRequestCreateResponseData = {
  request: WorkToolRequestRecord;
};

export type WorkToolRequestCreateResponse = ApiResponse<WorkToolRequestCreateResponseData>;

export type WorkToolRequestUpdateResponseData = {
  request: WorkToolRequestRecord;
};

export type WorkToolRequestUpdateResponse = ApiResponse<WorkToolRequestUpdateResponseData>;

export type PersonWorkToolsResponseData = {
  tools: WorkToolRecord[];
  requests: WorkToolRequestRecord[];
  outstandingAssignedCount: number;
};

export type PersonWorkToolsResponse = ApiResponse<PersonWorkToolsResponseData>;
