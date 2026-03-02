import type { UserRole } from "./navigation";
import type {
  SurveyAnswerValue,
  SurveyAnswers,
  SurveyAudience,
  SurveyQuestionDefinition,
  SurveyQuestionType,
  SurveyRecurrence,
  SurveyStatus,
  SurveyType
} from "../types/surveys";

const surveyTypes: readonly SurveyType[] = ["engagement", "pulse", "onboarding", "exit", "custom"];
const surveyStatuses: readonly SurveyStatus[] = ["draft", "active", "closed", "archived"];
const surveyRecurrences: readonly SurveyRecurrence[] = ["weekly", "monthly", "quarterly"];
const surveyQuestionTypes: readonly SurveyQuestionType[] = ["rating", "text", "select", "likert"];

export function isSurveyType(value: string): value is SurveyType {
  return surveyTypes.includes(value as SurveyType);
}

export function isSurveyStatus(value: string): value is SurveyStatus {
  return surveyStatuses.includes(value as SurveyStatus);
}

export function isSurveyRecurrence(value: string): value is SurveyRecurrence {
  return surveyRecurrences.includes(value as SurveyRecurrence);
}

export function isSurveyQuestionType(value: string): value is SurveyQuestionType {
  return surveyQuestionTypes.includes(value as SurveyQuestionType);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function normalizeSurveyAudience(value: unknown): SurveyAudience {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      departments: [],
      employmentTypes: [],
      countries: []
    };
  }

  const record = value as Record<string, unknown>;

  return {
    departments: normalizeStringArray(record.departments),
    employmentTypes: normalizeStringArray(record.employment_types ?? record.employmentTypes),
    countries: normalizeStringArray(record.countries)
  };
}

function fallbackOptionsForLikert(): string[] {
  return [
    "strongly_disagree",
    "disagree",
    "neutral",
    "agree",
    "strongly_agree"
  ];
}

export function normalizeSurveyQuestions(value: unknown): SurveyQuestionDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedQuestions: SurveyQuestionDefinition[] = [];

  for (const rawQuestion of value) {
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
      continue;
    }

    const question = rawQuestion as Record<string, unknown>;
    const id = typeof question.id === "string" ? question.id.trim() : "";
    const text = typeof question.text === "string" ? question.text.trim() : "";
    const rawType = typeof question.type === "string" ? question.type : "";

    if (!id || !text || !isSurveyQuestionType(rawType)) {
      continue;
    }

    const rawScale =
      typeof question.scale === "number"
        ? Math.trunc(question.scale)
        : typeof question.scale === "string"
          ? Math.trunc(Number.parseInt(question.scale, 10))
          : null;

    const scale = Number.isFinite(rawScale) && rawScale !== null && rawScale >= 2 ? rawScale : null;
    const options = normalizeStringArray(question.options);

    normalizedQuestions.push({
      id,
      text,
      type: rawType,
      required: Boolean(question.required),
      scale,
      options: rawType === "likert" && options.length === 0 ? fallbackOptionsForLikert() : options
    });
  }

  return normalizedQuestions;
}

export function normalizeSurveyAnswers(value: unknown): SurveyAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const answers: SurveyAnswers = {};

  for (const [questionId, answerValue] of Object.entries(record)) {
    if (!questionId.trim()) {
      continue;
    }

    if (
      typeof answerValue === "string" ||
      typeof answerValue === "number" ||
      typeof answerValue === "boolean" ||
      answerValue === null
    ) {
      answers[questionId] = answerValue;
    }
  }

  return answers;
}

export function canManageSurveys(roles: readonly UserRole[]): boolean {
  return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
}

export function isSurveyActiveNow({
  status,
  startDate,
  endDate,
  nowDate = new Date().toISOString().slice(0, 10)
}: {
  status: SurveyStatus;
  startDate: string | null;
  endDate: string | null;
  nowDate?: string;
}): boolean {
  if (status !== "active") {
    return false;
  }

  if (startDate && startDate > nowDate) {
    return false;
  }

  if (endDate && endDate < nowDate) {
    return false;
  }

  return true;
}

export function surveyAudienceMatchesProfile({
  audience,
  department,
  countryCode,
  employmentType
}: {
  audience: SurveyAudience;
  department: string | null;
  countryCode: string | null;
  employmentType: string | null;
}): boolean {
  const departmentMatch =
    audience.departments.length === 0 ||
    (department !== null && audience.departments.includes(department));

  const countryMatch =
    audience.countries.length === 0 ||
    (countryCode !== null && audience.countries.includes(countryCode));

  const employmentTypeMatch =
    audience.employmentTypes.length === 0 ||
    (employmentType !== null && audience.employmentTypes.includes(employmentType));

  return departmentMatch && countryMatch && employmentTypeMatch;
}

export function validateAnswerForQuestion({
  question,
  answer
}: {
  question: SurveyQuestionDefinition;
  answer: SurveyAnswerValue;
}): string | null {
  if (question.required && (answer === null || answer === "")) {
    return `Question \"${question.text}\" is required.`;
  }

  if (answer === null || answer === "") {
    return null;
  }

  if (question.type === "rating") {
    if (typeof answer !== "number") {
      return `Question \"${question.text}\" requires a numeric rating.`;
    }

    const maxScale = question.scale ?? 10;

    if (answer < 1 || answer > maxScale) {
      return `Question \"${question.text}\" must be between 1 and ${maxScale}.`;
    }
  }

  if (question.type === "likert" || question.type === "select") {
    if (typeof answer !== "string") {
      return `Question \"${question.text}\" requires a text selection.`;
    }

    if (question.options.length > 0 && !question.options.includes(answer)) {
      return `Question \"${question.text}\" has an invalid option.`;
    }
  }

  if (question.type === "text") {
    if (typeof answer !== "string") {
      return `Question \"${question.text}\" requires a text response.`;
    }

    if (answer.length > 5000) {
      return `Question \"${question.text}\" exceeds max response length.`;
    }
  }

  return null;
}
