import type { ApiResponse } from "./auth";

export const LEARNING_COURSE_CONTENT_TYPES = [
  "video",
  "document",
  "scorm",
  "link",
  "quiz",
  "multi_module"
] as const;

export type LearningCourseContentType =
  (typeof LEARNING_COURSE_CONTENT_TYPES)[number];

export const LEARNING_ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
  "overdue",
  "failed"
] as const;

export type LearningAssignmentStatus =
  (typeof LEARNING_ASSIGNMENT_STATUSES)[number];

export const LEARNING_COURSE_DIFFICULTIES = [
  "beginner",
  "intermediate",
  "advanced"
] as const;

export type LearningCourseDifficulty = (typeof LEARNING_COURSE_DIFFICULTIES)[number];

export const LEARNING_COURSE_RECURRENCES = [
  "annual",
  "semi_annual",
  "quarterly"
] as const;

export type LearningCourseRecurrence = (typeof LEARNING_COURSE_RECURRENCES)[number];

export type LearningCourseRecord = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  category: string | null;
  contentType: LearningCourseContentType;
  contentUrl: string | null;
  contentFilePath: string | null;
  thumbnailUrl: string | null;
  modules: unknown[];
  durationMinutes: number | null;
  difficulty: LearningCourseDifficulty | null;
  passingScore: number | null;
  autoAssignRules: unknown[];
  isMandatory: boolean;
  allowRetake: boolean;
  certificateTemplate: string | null;
  recurrence: LearningCourseRecurrence | null;
  createdBy: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  assignmentCount: number;
  completionCount: number;
};

export type LearningAssignmentRecord = {
  id: string;
  orgId: string;
  courseId: string;
  courseTitle: string;
  courseCategory: string | null;
  courseContentType: LearningCourseContentType;
  courseDurationMinutes: number | null;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  status: LearningAssignmentStatus;
  progressPct: number;
  moduleProgress: Record<string, unknown>;
  quizScore: number | null;
  quizAttempts: number;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  certificateUrl: string | null;
  assignedBy: string | null;
  assignedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LearningMyAssignmentsResponseData = {
  assignments: LearningAssignmentRecord[];
};

export type LearningCoursesResponseData = {
  courses: LearningCourseRecord[];
};

export type LearningCourseMutationResponseData = {
  course: LearningCourseRecord;
};

export type LearningAssignmentMutationResponseData = {
  assignment: LearningAssignmentRecord;
};

export type LearningReportsSummary = {
  totalAssigned: number;
  totalInProgress: number;
  totalCompleted: number;
  totalOverdue: number;
  totalFailed: number;
  completionRatePct: number;
};

export type LearningReportsCourseRow = {
  courseId: string;
  courseTitle: string;
  assignedCount: number;
  completedCount: number;
  overdueCount: number;
  failedCount: number;
  completionRatePct: number;
};

export type LearningReportsResponseData = {
  summary: LearningReportsSummary;
  courses: LearningReportsCourseRow[];
  overdueAssignments: LearningAssignmentRecord[];
};

export type LearningCertificateResponseData = {
  url: string;
  expiresInSeconds: number;
};

export type LearningAssignmentsBulkMutationResponseData = {
  assignments: LearningAssignmentRecord[];
};

export type LearningQuizResult = {
  score: number;
  passed: boolean;
  totalQuestions: number;
  correctCount: number;
  passingScore: number | null;
  allowRetake: boolean;
};

export type LearningModuleProgressResponseData = {
  assignment: LearningAssignmentRecord;
  quizResult: LearningQuizResult | null;
};

export type LearningModuleDefinition = {
  id: string;
  title: string;
  type: "video" | "document" | "link" | "quiz";
  contentUrl: string | null;
  durationMinutes: number | null;
  questions: LearningQuizQuestion[];
};

export type LearningQuizQuestion = {
  id: string;
  text: string;
  options: string[];
};

export type LearningModuleStatus = {
  status: "locked" | "in_progress" | "completed";
  startedAt?: string;
  completedAt?: string;
};

export type LearningCoursesResponse = ApiResponse<LearningCoursesResponseData>;
export type LearningMyAssignmentsResponse = ApiResponse<LearningMyAssignmentsResponseData>;
export type LearningCourseMutationResponse = ApiResponse<LearningCourseMutationResponseData>;
export type LearningAssignmentMutationResponse = ApiResponse<LearningAssignmentMutationResponseData>;
export type LearningModuleProgressResponse = ApiResponse<LearningModuleProgressResponseData>;
export type LearningAssignmentsBulkMutationResponse = ApiResponse<LearningAssignmentsBulkMutationResponseData>;
export type LearningReportsResponse = ApiResponse<LearningReportsResponseData>;
export type LearningCertificateResponse = ApiResponse<LearningCertificateResponseData>;
