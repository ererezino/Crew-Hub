import { z } from "zod";

import type {
  ReviewAnswerValue,
  ReviewAnswers,
  ReviewAssignmentStatus,
  ReviewCycleStatus,
  ReviewQuestionDefinition,
  ReviewResponseType,
  ReviewSectionDefinition
} from "../../types/performance";
import {
  REVIEW_ASSIGNMENT_STATUSES,
  REVIEW_CYCLE_STATUSES,
  REVIEW_RESPONSE_TYPES
} from "../../types/performance";

const reviewAnswerValueSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  text: z.string().trim().max(4000).nullable().optional()
});

const reviewQuestionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  type: z.enum(["rating", "text"]),
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(4000).optional()
});

const reviewSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  questions: z.array(reviewQuestionSchema).default([])
});

function normalizeAnswerValue(value: unknown): ReviewAnswerValue {
  const parsed = reviewAnswerValueSchema.safeParse(value);

  if (!parsed.success) {
    return {
      rating: null,
      text: null
    };
  }

  return {
    rating: parsed.data.rating ?? null,
    text: parsed.data.text ?? null
  };
}

export function normalizeReviewAnswers(value: unknown): ReviewAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: ReviewAnswers = {};

  for (const [questionId, answerValue] of Object.entries(value)) {
    if (questionId.trim().length === 0) {
      continue;
    }

    normalized[questionId] = normalizeAnswerValue(answerValue);
  }

  return normalized;
}

export function normalizeReviewSections(value: unknown): ReviewSectionDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sections: ReviewSectionDefinition[] = [];

  for (const sectionValue of value) {
    const sectionParsed = reviewSectionSchema.safeParse(sectionValue);

    if (!sectionParsed.success) {
      continue;
    }

    const normalizedQuestions: ReviewQuestionDefinition[] = [];

    for (const question of sectionParsed.data.questions) {
      normalizedQuestions.push({
        id: question.id,
        title: question.title,
        prompt: question.prompt,
        type: question.type,
        required: question.required,
        maxLength: question.maxLength
      });
    }

    sections.push({
      id: sectionParsed.data.id,
      title: sectionParsed.data.title,
      description: sectionParsed.data.description,
      questions: normalizedQuestions
    });
  }

  return sections;
}

export function labelForReviewCycleStatus(status: ReviewCycleStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "in_review":
      return "In Review";
    case "completed":
      return "Completed";
    default:
      return "Draft";
  }
}

export function toneForReviewCycleStatus(
  status: ReviewCycleStatus
): "success" | "pending" | "draft" | "info" {
  switch (status) {
    case "active":
      return "success";
    case "in_review":
      return "pending";
    case "completed":
      return "info";
    default:
      return "draft";
  }
}

export function labelForReviewAssignmentStatus(status: ReviewAssignmentStatus): string {
  switch (status) {
    case "pending_self":
      return "Pending Self";
    case "pending_manager":
      return "Pending Manager";
    case "in_review":
      return "In Review";
    default:
      return "Completed";
  }
}

export function toneForReviewAssignmentStatus(
  status: ReviewAssignmentStatus
): "pending" | "warning" | "info" | "success" {
  switch (status) {
    case "pending_self":
      return "warning";
    case "pending_manager":
      return "pending";
    case "in_review":
      return "info";
    default:
      return "success";
  }
}

export function isReviewCycleStatus(value: string): value is ReviewCycleStatus {
  return REVIEW_CYCLE_STATUSES.includes(value as ReviewCycleStatus);
}

export function isReviewAssignmentStatus(value: string): value is ReviewAssignmentStatus {
  return REVIEW_ASSIGNMENT_STATUSES.includes(value as ReviewAssignmentStatus);
}

export function isReviewResponseType(value: string): value is ReviewResponseType {
  return REVIEW_RESPONSE_TYPES.includes(value as ReviewResponseType);
}
