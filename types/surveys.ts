import type { ApiResponse } from "./auth";

export const SURVEY_TYPES = [
  "engagement",
  "pulse",
  "onboarding",
  "exit",
  "custom"
] as const;

export type SurveyType = (typeof SURVEY_TYPES)[number];

export const SURVEY_STATUSES = ["draft", "active", "closed", "archived"] as const;

export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_RECURRENCES = ["weekly", "monthly", "quarterly"] as const;

export type SurveyRecurrence = (typeof SURVEY_RECURRENCES)[number];

export const SURVEY_QUESTION_TYPES = ["rating", "text", "select", "likert"] as const;

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export type SurveyQuestionDefinition = {
  id: string;
  text: string;
  type: SurveyQuestionType;
  required: boolean;
  scale: number | null;
  options: string[];
};

export type SurveyAudience = {
  departments: string[];
  employmentTypes: string[];
  countries: string[];
};

export type SurveyRecord = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  type: SurveyType;
  questions: SurveyQuestionDefinition[];
  isAnonymous: boolean;
  minResponsesForResults: number;
  targetAudience: SurveyAudience;
  status: SurveyStatus;
  startDate: string | null;
  endDate: string | null;
  recurrence: SurveyRecurrence | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
  hasResponded: boolean;
};

export type SurveyAnswerValue = string | number | boolean | null;

export type SurveyAnswers = Record<string, SurveyAnswerValue>;

export type SurveyResponseRecord = {
  id: string;
  orgId: string;
  surveyId: string;
  respondentId: string | null;
  answers: SurveyAnswers;
  department: string | null;
  countryCode: string | null;
  submittedAt: string;
  createdAt: string;
};

export type SurveyDetailResponseData = {
  survey: SurveyRecord;
  hasResponded: boolean;
  responseId: string | null;
};

export type SurveyPendingListResponseData = {
  surveys: SurveyRecord[];
};

export type SurveyAdminListResponseData = {
  surveys: SurveyRecord[];
};

export type SurveyMutationResponseData = {
  survey: SurveyRecord;
};

export type SurveyLaunchResponseData = {
  survey: SurveyRecord;
};

export type SurveyResponseMutationResponseData = {
  response: SurveyResponseRecord;
};

export type SurveyQuestionResult = {
  questionId: string;
  questionText: string;
  questionType: SurveyQuestionType;
  responseCount: number;
  averageScore: number | null;
  optionBreakdown: Array<{
    option: string;
    count: number;
  }>;
  textResponses: string[];
};

export type SurveyHeatmapCell = {
  department: string;
  questionId: string;
  averageScore: number | null;
  responseCount: number;
  protected: boolean;
};

export type SurveyHeatmapData = {
  departments: string[];
  questions: Array<{ id: string; text: string }>;
  cells: SurveyHeatmapCell[];
};

export type SurveyTrendPoint = {
  surveyId: string;
  surveyTitle: string;
  closedAt: string;
  questionId: string;
  questionText: string;
  averageScore: number | null;
};

export type SurveyTrendData = {
  instanceCount: number;
  trendDirection: "up" | "down" | "flat";
  points: SurveyTrendPoint[];
};

export type SurveyResultsResponseData = {
  survey: SurveyRecord;
  totalResponses: number;
  minResponsesForResults: number;
  hasMinimumResponses: boolean;
  protected: boolean;
  message: string | null;
  questionResults: SurveyQuestionResult[];
  heatmap: SurveyHeatmapData | null;
  trend: SurveyTrendData | null;
};

export type SurveySignedExportResponseData = {
  fileName: string;
  csv: string;
};

export type SurveyRespondPayload = {
  answers: SurveyAnswers;
};

export type SurveyPendingListResponse = ApiResponse<SurveyPendingListResponseData>;
export type SurveyAdminListResponse = ApiResponse<SurveyAdminListResponseData>;
export type SurveyMutationResponse = ApiResponse<SurveyMutationResponseData>;
export type SurveyDetailResponse = ApiResponse<SurveyDetailResponseData>;
export type SurveyLaunchResponse = ApiResponse<SurveyLaunchResponseData>;
export type SurveyResponseMutationResponse = ApiResponse<SurveyResponseMutationResponseData>;
export type SurveyResultsResponse = ApiResponse<SurveyResultsResponseData>;
export type SurveySignedExportResponse = ApiResponse<SurveySignedExportResponseData>;
