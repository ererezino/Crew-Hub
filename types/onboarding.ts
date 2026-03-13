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

export const ONBOARDING_TRACKS = ["employee", "operations"] as const;

export type OnboardingTrack = (typeof ONBOARDING_TRACKS)[number];

export const ONBOARDING_SECTION_TYPES = ["content", "tasks", "policies", "tools"] as const;

export type OnboardingSectionType = (typeof ONBOARDING_SECTION_TYPES)[number];

export type OnboardingContentSection = {
  id: string;
  title: string;
  type: OnboardingSectionType;
  content: string;
  order: number;
  isRoleSpecific?: boolean;
  department?: string | null;
};

export type OnboardingTemplateTask = {
  title: string;
  description: string;
  category: string;
  track?: OnboardingTrack;
  sectionId?: string | null;
  dueOffsetDays: number | null;
  taskType?: OnboardingTaskType;
  documentId?: string | null;
  linkUrl?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  completionGuidance?: string | null;
};

export type OnboardingTemplateTaskInput = {
  title: string;
  description?: string;
  category: string;
  track?: OnboardingTrack;
  sectionId?: string | null;
  dueOffsetDays?: number | null;
  taskType?: OnboardingTaskType;
  documentId?: string | null;
  linkUrl?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  completionGuidance?: string | null;
};

export type OnboardingTemplate = {
  id: string;
  name: string;
  type: OnboardingType;
  countryCode: string | null;
  department: string | null;
  tasks: OnboardingTemplateTask[];
  sections?: OnboardingContentSection[];
  createdAt: string;
  updatedAt: string;
};

export type TrackProgress = {
  total: number;
  completed: number;
  percent: number;
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
  employeeTrack: TrackProgress;
  operationsTrack: TrackProgress;
  sections?: OnboardingContentSection[];
};

export type OnboardingTask = {
  id: string;
  instanceId: string;
  title: string;
  description: string | null;
  category: string;
  track: OnboardingTrack;
  sectionId: string | null;
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
  actionUrl: string | null;
  actionLabel: string | null;
  completionGuidance: string | null;
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

export type AtRiskStuckTask = {
  id: string;
  title: string;
  daysPastDue: number;
};

export type AtRiskInstance = {
  instanceId: string;
  employeeId: string;
  employeeName: string;
  startedAt: string;
  daysSinceLastActivity: number;
  totalTasks: number;
  completedTasks: number;
  stuckTask: AtRiskStuckTask | null;
};

export type AtRiskOnboardingsResponseData = {
  instances: AtRiskInstance[];
};

export type AtRiskOnboardingsResponse = ApiResponse<AtRiskOnboardingsResponseData>;

export type OnboardingRemindResponseData = {
  sent: boolean;
};

export type OnboardingRemindResponse = ApiResponse<OnboardingRemindResponseData>;
