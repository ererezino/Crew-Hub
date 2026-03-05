import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isReviewAssignmentStatus,
  isReviewCycleStatus,
  isReviewResponseType,
  normalizeReviewAnswers,
  normalizeReviewSections
} from "../../../../lib/performance/reviews";
import { normalizeUserRoles } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import type { ApiResponse } from "../../../../types/auth";
import type {
  ReviewActionItem,
  ReviewAssignmentSummary,
  ReviewCycleSummary,
  ReviewResponseRecord,
  ReviewTemplateSummary
} from "../../../../types/performance";

export const cycleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  self_review_deadline: z.string().nullable(),
  manager_review_deadline: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string()
});

export const templateRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  sections: z.unknown(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string()
});

export const assignmentRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  cycle_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  reviewer_id: z.string().uuid(),
  template_id: z.string().uuid(),
  status: z.string(),
  due_at: z.string().nullable(),
  shared_at: z.string().nullable().default(null),
  shared_by: z.string().uuid().nullable().default(null),
  acknowledged_at: z.string().nullable().default(null),
  next_steps: z.string().nullable().default(null),
  action_items: z.unknown().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

export const assignmentSelectColumns =
  "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, shared_at, shared_by, acknowledged_at, next_steps, action_items, created_at, updated_at";

function normalizeActionItems(raw: unknown): ReviewActionItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is ReviewActionItem =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>).id === "string" &&
    typeof (item as Record<string, unknown>).text === "string"
  ).map((item) => ({
    id: item.id,
    text: item.text,
    completed: Boolean(item.completed),
    completedAt: typeof item.completedAt === "string" ? item.completedAt : null
  }));
}

export const responseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  respondent_id: z.string().uuid(),
  response_type: z.string(),
  answers: z.unknown(),
  submitted_at: z.string().nullable(),
  updated_at: z.string()
});

export const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

export function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canManagePerformance(userRoles: readonly string[]): boolean {
  const normalizedRoles = normalizeUserRoles(userRoles);
  return hasRole(normalizedRoles, "HR_ADMIN") || hasRole(normalizedRoles, "SUPER_ADMIN");
}

export function mapCycleRow(
  row: z.infer<typeof cycleRowSchema>,
  createdByName: string
): ReviewCycleSummary | null {
  if (!isReviewCycleStatus(row.status)) {
    return null;
  }

  if (
    row.type !== "quarterly" &&
    row.type !== "annual" &&
    row.type !== "probation"
  ) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    selfReviewDeadline: row.self_review_deadline,
    managerReviewDeadline: row.manager_review_deadline,
    createdBy: row.created_by,
    createdByName,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapTemplateRow(row: z.infer<typeof templateRowSchema>): ReviewTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    sections: normalizeReviewSections(row.sections),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapResponseRow(row: z.infer<typeof responseRowSchema>): ReviewResponseRecord | null {
  if (!isReviewResponseType(row.response_type)) {
    return null;
  }

  return {
    id: row.id,
    assignmentId: row.assignment_id,
    respondentId: row.respondent_id,
    responseType: row.response_type,
    answers: normalizeReviewAnswers(row.answers),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at
  };
}

export function mapAssignmentRows({
  assignments,
  cyclesById,
  templatesById,
  profilesById,
  responsesByAssignmentId
}: {
  assignments: z.infer<typeof assignmentRowSchema>[];
  cyclesById: ReadonlyMap<string, ReviewCycleSummary>;
  templatesById: ReadonlyMap<string, ReviewTemplateSummary>;
  profilesById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>;
  responsesByAssignmentId: ReadonlyMap<
    string,
    {
      selfResponse: ReviewResponseRecord | null;
      managerResponse: ReviewResponseRecord | null;
    }
  >;
}): ReviewAssignmentSummary[] {
  const mapped: ReviewAssignmentSummary[] = [];

  for (const assignment of assignments) {
    if (!isReviewAssignmentStatus(assignment.status)) {
      continue;
    }

    const cycle = cyclesById.get(assignment.cycle_id);
    const template = templatesById.get(assignment.template_id);
    const employee = profilesById.get(assignment.employee_id);
    const reviewer = profilesById.get(assignment.reviewer_id);

    if (!cycle || !template || !employee || !reviewer) {
      continue;
    }

    const responses = responsesByAssignmentId.get(assignment.id) ?? {
      selfResponse: null,
      managerResponse: null
    };

    const sharedByProfile = assignment.shared_by
      ? profilesById.get(assignment.shared_by)
      : null;

    mapped.push({
      id: assignment.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleStatus: cycle.status,
      employeeId: assignment.employee_id,
      employeeName: employee.full_name,
      employeeDepartment: employee.department,
      employeeCountryCode: employee.country_code,
      reviewerId: assignment.reviewer_id,
      reviewerName: reviewer.full_name,
      templateId: template.id,
      templateName: template.name,
      templateSections: template.sections,
      status: assignment.status,
      dueAt: assignment.due_at,
      sharedAt: assignment.shared_at,
      sharedBy: assignment.shared_by,
      sharedByName: sharedByProfile?.full_name ?? null,
      acknowledgedAt: assignment.acknowledged_at,
      nextSteps: assignment.next_steps ?? null,
      actionItems: normalizeActionItems(assignment.action_items),
      createdAt: assignment.created_at,
      updatedAt: assignment.updated_at,
      selfResponse: responses.selfResponse,
      managerResponse: responses.managerResponse
    });
  }

  return mapped;
}
