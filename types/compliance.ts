import type { ApiResponse } from "./auth";

export const COMPLIANCE_CADENCES = [
  "monthly",
  "quarterly",
  "annual",
  "ongoing",
  "one_time"
] as const;

export const COMPLIANCE_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "overdue"
] as const;

export type ComplianceCadence = (typeof COMPLIANCE_CADENCES)[number];
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];
export type ComplianceUrgency = "overdue" | "due_soon" | "upcoming" | "completed";

export type ComplianceDeadlineRecord = {
  id: string;
  itemId: string;
  countryCode: string;
  authority: string;
  requirement: string;
  description: string | null;
  cadence: ComplianceCadence;
  category: string;
  itemNotes: string | null;
  dueDate: string;
  status: ComplianceStatus;
  urgency: ComplianceUrgency;
  assignedTo: string | null;
  assignedToName: string | null;
  proofDocumentId: string | null;
  proofDocumentTitle: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ComplianceSummary = {
  overdueCount: number;
  dueSoonCount: number;
  upcomingCount: number;
  completedCount: number;
  nextDeadline: ComplianceDeadlineRecord | null;
};

export type ComplianceResponseData = {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: ComplianceSummary;
  deadlines: ComplianceDeadlineRecord[];
  assignees: Array<{
    id: string;
    fullName: string;
  }>;
  proofDocuments: Array<{
    id: string;
    title: string;
  }>;
};

export type UpdateComplianceDeadlinePayload = {
  status: ComplianceStatus;
  assignedTo: string | null;
  proofDocumentId: string | null;
  notes: string | null;
};

export type UpdateComplianceDeadlineData = {
  deadline: ComplianceDeadlineRecord;
};

export type ComplianceResponse = ApiResponse<ComplianceResponseData>;
export type UpdateComplianceDeadlineResponse = ApiResponse<UpdateComplianceDeadlineData>;
