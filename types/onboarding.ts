import type { ApiResponse } from "./auth";

export const ONBOARDING_TYPES = ["onboarding", "offboarding"] as const;

export type OnboardingType = (typeof ONBOARDING_TYPES)[number];

export const ONBOARDING_INSTANCE_STATUSES = [
  "active",
  "completed",
  "cancelled"
] as const;

export type OnboardingInstanceStatus = (typeof ONBOARDING_INSTANCE_STATUSES)[number];

export const ONBOARDING_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "blocked"
] as const;

export type OnboardingTaskStatus = (typeof ONBOARDING_TASK_STATUSES)[number];

export const ONBOARDING_TASK_TYPES = ["manual", "e_signature", "link", "form"] as const;

export type OnboardingTaskType = (typeof ONBOARDING_TASK_TYPES)[number];

export type OnboardingTemplateTask = {
  title: string;
  description: string;
  category: string;
  dueOffsetDays: number | null;
  taskType?: OnboardingTaskType;
  documentId?: string | null;
  linkUrl?: string | null;
};

export type OnboardingTemplateTaskInput = {
  title: string;
  description?: string;
  category: string;
  dueOffsetDays?: number | null;
  taskType?: OnboardingTaskType;
  documentId?: string | null;
  linkUrl?: string | null;
};

export type OnboardingTemplate = {
  id: string;
  name: string;
  type: OnboardingType;
  countryCode: string | null;
  department: string | null;
  tasks: OnboardingTemplateTask[];
  createdAt: string;
  updatedAt: string;
};

export type OnboardingInstanceSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  templateId: string | null;
  templateName: string;
  type: OnboardingType;
  status: OnboardingInstanceStatus;
  startedAt: string;
  completedAt: string | null;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
};

export type OnboardingTask = {
  id: string;
  instanceId: string;
  title: string;
  description: string | null;
  category: string;
  status: OnboardingTaskStatus;
  taskType: OnboardingTaskType;
  assignedTo: string | null;
  assignedToName: string;
  dueDate: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completedByName: string | null;
  notes: string | null;
  documentId: string | null;
  signatureRequestId: string | null;
};

export type OnboardingTemplatesResponseData = {
  templates: OnboardingTemplate[];
};

export type OnboardingTemplatesResponse = ApiResponse<OnboardingTemplatesResponseData>;

export type OnboardingTemplateCreateResponseData = {
  template: OnboardingTemplate;
};

export type OnboardingTemplateCreateResponse = ApiResponse<OnboardingTemplateCreateResponseData>;

export type OnboardingInstancesResponseData = {
  instances: OnboardingInstanceSummary[];
};

export type OnboardingInstancesResponse = ApiResponse<OnboardingInstancesResponseData>;

export type OnboardingInstanceCreateResponseData = {
  instance: OnboardingInstanceSummary;
};

export type OnboardingInstanceCreateResponse = ApiResponse<OnboardingInstanceCreateResponseData>;

export type OnboardingInstanceDetailResponseData = {
  instance: OnboardingInstanceSummary;
  tasks: OnboardingTask[];
};

export type OnboardingInstanceDetailResponse = ApiResponse<OnboardingInstanceDetailResponseData>;
