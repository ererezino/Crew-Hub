import type { ApiResponse } from "./auth";

export const REVIEW_CYCLE_TYPES = ["quarterly", "annual", "probation"] as const;
export const REVIEW_CYCLE_STATUSES = [
  "draft",
  "active",
  "in_review",
  "completed"
] as const;
export const REVIEW_ASSIGNMENT_STATUSES = [
  "pending_self",
  "pending_manager",
  "in_review",
  "completed"
] as const;
export const REVIEW_RESPONSE_TYPES = ["self", "manager"] as const;
export const REVIEW_QUESTION_TYPES = ["rating", "text"] as const;

export type ReviewCycleType = (typeof REVIEW_CYCLE_TYPES)[number];
export type ReviewCycleStatus = (typeof REVIEW_CYCLE_STATUSES)[number];
export type ReviewAssignmentStatus = (typeof REVIEW_ASSIGNMENT_STATUSES)[number];
export type ReviewResponseType = (typeof REVIEW_RESPONSE_TYPES)[number];
export type ReviewQuestionType = (typeof REVIEW_QUESTION_TYPES)[number];

export const GOAL_STATUSES = ["active", "completed", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type ReviewQuestionDefinition = {
  id: string;
  title: string;
  prompt: string;
  type: ReviewQuestionType;
  required: boolean;
  maxLength?: number;
};

export type ReviewSectionDefinition = {
  id: string;
  title: string;
  description: string;
  questions: ReviewQuestionDefinition[];
};

export type ReviewTemplateSummary = {
  id: string;
  name: string;
  sections: ReviewSectionDefinition[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewCycleSummary = {
  id: string;
  name: string;
  type: ReviewCycleType;
  status: ReviewCycleStatus;
  startDate: string;
  endDate: string;
  selfReviewDeadline: string | null;
  managerReviewDeadline: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewAnswerValue = {
  rating: number | null;
  text: string | null;
};

export type ReviewAnswers = Record<string, ReviewAnswerValue>;

export type ReviewResponseRecord = {
  id: string;
  assignmentId: string;
  respondentId: string;
  responseType: ReviewResponseType;
  answers: ReviewAnswers;
  submittedAt: string | null;
  updatedAt: string;
};

export type ReviewAssignmentSummary = {
  id: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: ReviewCycleStatus;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  reviewerId: string;
  reviewerName: string;
  templateId: string;
  templateName: string;
  templateSections: ReviewSectionDefinition[];
  status: ReviewAssignmentStatus;
  dueAt: string | null;
  sharedAt: string | null;
  sharedBy: string | null;
  sharedByName: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  selfResponse: ReviewResponseRecord | null;
  managerResponse: ReviewResponseRecord | null;
};

export type PerformanceOverviewResponseData = {
  activeCycle: ReviewCycleSummary | null;
  selfAssignment: ReviewAssignmentSummary | null;
  managerAssignments: ReviewAssignmentSummary[];
  pastAssignments: ReviewAssignmentSummary[];
};

export type PerformanceAdminResponseData = {
  cycles: ReviewCycleSummary[];
  templates: ReviewTemplateSummary[];
  assignments: ReviewAssignmentSummary[];
  directory: Array<{
    id: string;
    fullName: string;
    department: string | null;
    countryCode: string | null;
    managerId: string | null;
    status: "active" | "inactive" | "onboarding" | "offboarding";
  }>;
  metrics: {
    totalAssignments: number;
    completedAssignments: number;
    pendingSelfAssignments: number;
    pendingManagerAssignments: number;
    inReviewAssignments: number;
  };
};

export type SaveReviewResponsePayload = {
  assignmentId: string;
  responseType: ReviewResponseType;
  answers: ReviewAnswers;
  submit: boolean;
};

export type SaveReviewResponseData = {
  assignment: ReviewAssignmentSummary;
  response: ReviewResponseRecord;
};

export type CreateReviewCyclePayload = {
  name: string;
  type: ReviewCycleType;
  status: ReviewCycleStatus;
  startDate: string;
  endDate: string;
  selfReviewDeadline: string | null;
  managerReviewDeadline: string | null;
};

export type CreateReviewCycleData = {
  cycle: ReviewCycleSummary;
};

export type CreateReviewTemplatePayload = {
  name: string;
  sections: ReviewSectionDefinition[];
};

export type CreateReviewTemplateData = {
  template: ReviewTemplateSummary;
};

export type AssignReviewPayload = {
  cycleId: string;
  templateId: string;
  assignments: Array<{
    employeeId: string;
    reviewerId: string;
    dueAt: string | null;
  }>;
};

export type AssignReviewData = {
  assignments: ReviewAssignmentSummary[];
  createdCount: number;
  skippedCount: number;
};

// ── Goals ──

export type GoalRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  cycleId: string | null;
  cycleName: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: GoalStatus;
  progressPct: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoalsListResponseData = {
  goals: GoalRecord[];
};

export type GoalMutationResponseData = {
  goal: GoalRecord;
};

export type CreateGoalPayload = {
  employeeId: string;
  cycleId?: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
};

export type UpdateGoalPayload = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: GoalStatus;
};

export type UpdateGoalProgressPayload = {
  progressPct: number;
};

// ── Review Sharing ──

export type ShareReviewResponseData = {
  assignment: ReviewAssignmentSummary;
};

export type AcknowledgeReviewResponseData = {
  assignment: ReviewAssignmentSummary;
};

// ── Calibration ──

export type CalibrationRow = {
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  countryCode: string | null;
  reviewType: ReviewCycleType;
  selfScore: number | null;
  managerScore: number | null;
  variance: number | null;
  status: "unshared" | "shared" | "acknowledged";
};

export type CalibrationResponseData = {
  cycle: ReviewCycleSummary;
  rows: CalibrationRow[];
  summary: {
    totalAssignments: number;
    completedAssignments: number;
    completionPct: number;
    avgSelfScore: number | null;
    avgManagerScore: number | null;
  };
};

export type PerformanceOverviewResponse = ApiResponse<PerformanceOverviewResponseData>;
export type PerformanceAdminResponse = ApiResponse<PerformanceAdminResponseData>;
export type SaveReviewResponseApiResponse = ApiResponse<SaveReviewResponseData>;
export type CreateReviewCycleApiResponse = ApiResponse<CreateReviewCycleData>;
export type CreateReviewTemplateApiResponse = ApiResponse<CreateReviewTemplateData>;
export type AssignReviewApiResponse = ApiResponse<AssignReviewData>;
export type GoalsListResponse = ApiResponse<GoalsListResponseData>;
export type GoalMutationResponse = ApiResponse<GoalMutationResponseData>;
export type ShareReviewResponse = ApiResponse<ShareReviewResponseData>;
export type AcknowledgeReviewResponse = ApiResponse<AcknowledgeReviewResponseData>;
export type CalibrationResponse = ApiResponse<CalibrationResponseData>;
