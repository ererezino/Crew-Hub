import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { normalizeUserRoles } from "../../../../../lib/navigation";
import { normalizeReviewAnswers, normalizeReviewSections } from "../../../../../lib/performance/reviews";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  CalibrationResponseData,
  CalibrationRow,
  ReviewCycleType
} from "../../../../../types/performance";
import { buildMeta, cycleRowSchema, jsonResponse, mapCycleRow, profileRowSchema } from "../_helpers";

const querySchema = z.object({
  cycleId: z.string().uuid().optional(),
  department: z.string().min(1).max(200).optional(),
  country: z.string().min(2).max(2).optional()
});

const assignmentCalibrationSchema = z.object({
  id: z.string().uuid(),
  cycle_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  reviewer_id: z.string().uuid(),
  template_id: z.string().uuid(),
  status: z.string(),
  shared_at: z.string().nullable(),
  acknowledged_at: z.string().nullable()
});

const responseCalibrationSchema = z.object({
  assignment_id: z.string().uuid(),
  response_type: z.string(),
  answers: z.unknown(),
  submitted_at: z.string().nullable()
});

const templateCalibrationSchema = z.object({
  id: z.string().uuid(),
  sections: z.unknown()
});

function computeAverageRatingScore(
  answers: Record<string, { rating: number | null; text: string | null }>,
  sections: Array<{ questions: Array<{ id: string; type: string }> }>
): number | null {
  const ratingQuestionIds = new Set<string>();
  for (const section of sections) {
    for (const q of section.questions) {
      if (q.type === "rating") {
        ratingQuestionIds.add(q.id);
      }
    }
  }

  if (ratingQuestionIds.size === 0) return null;

  let total = 0;
  let count = 0;

  for (const [qId, answer] of Object.entries(answers)) {
    if (ratingQuestionIds.has(qId) && answer.rating !== null && answer.rating !== undefined) {
      total += answer.rating;
      count += 1;
    }
  }

  return count > 0 ? Number((total / count).toFixed(2)) : null;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!hasRole(userRoles, "HR_ADMIN") && !hasRole(userRoles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can access calibration."
      },
      meta: buildMeta()
    });
  }

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid calibration query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Find the cycle — either specified or most recent active
  let cycleId = query.cycleId;

  if (!cycleId) {
    const { data: latestCycle } = await supabase
      .from("review_cycles")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("status", ["active", "in_review", "completed"])
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    cycleId = latestCycle?.id as string | undefined;
  }

  if (!cycleId) {
    return jsonResponse<CalibrationResponseData>(200, {
      data: {
        cycle: {
          id: "",
          name: "No cycles found",
          type: "quarterly",
          status: "draft",
          startDate: "",
          endDate: "",
          selfReviewDeadline: null,
          managerReviewDeadline: null,
          createdBy: "",
          createdByName: "",
          createdAt: "",
          updatedAt: ""
        },
        rows: [],
        summary: {
          totalAssignments: 0,
          completedAssignments: 0,
          completionPct: 0,
          avgSelfScore: null,
          avgManagerScore: null
        }
      },
      error: null,
      meta: buildMeta()
    });
  }

  // Fetch cycle, assignments, templates, profiles, responses in parallel
  const [cycleResult, assignmentsResult, templatesResult] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at")
      .eq("id", cycleId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("review_assignments")
      .select("id, cycle_id, employee_id, reviewer_id, template_id, status, shared_at, acknowledged_at")
      .eq("org_id", orgId)
      .eq("cycle_id", cycleId)
      .is("deleted_at", null),
    supabase
      .from("review_templates")
      .select("id, sections")
      .eq("org_id", orgId)
      .is("deleted_at", null)
  ]);

  const parsedCycle = cycleRowSchema.safeParse(cycleResult.data);

  if (!parsedCycle.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Review cycle was not found." },
      meta: buildMeta()
    });
  }

  const cycle = mapCycleRow(parsedCycle.data, "System");

  if (!cycle) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "CALIBRATION_FAILED", message: "Unable to map cycle." },
      meta: buildMeta()
    });
  }

  const parsedAssignments = z.array(assignmentCalibrationSchema).safeParse(assignmentsResult.data ?? []);

  if (!parsedAssignments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "CALIBRATION_FAILED", message: "Unable to parse assignments." },
      meta: buildMeta()
    });
  }

  const parsedTemplates = z.array(templateCalibrationSchema).safeParse(templatesResult.data ?? []);
  const templatesById = new Map<string, Array<{ questions: Array<{ id: string; type: string }> }>>();

  if (parsedTemplates.success) {
    for (const t of parsedTemplates.data) {
      const sections = normalizeReviewSections(t.sections);
      templatesById.set(t.id, sections);
    }
  }

  // Collect employee IDs for profiles
  const employeeIds = new Set<string>();
  const assignmentIds: string[] = [];

  for (const a of parsedAssignments.data) {
    employeeIds.add(a.employee_id);
    assignmentIds.push(a.id);
  }

  const [profilesResult, responsesResult] = await Promise.all([
    employeeIds.size > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, department, country_code")
          .eq("org_id", orgId)
          .in("id", [...employeeIds])
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length > 0
      ? supabase
          .from("review_responses")
          .select("assignment_id, response_type, answers, submitted_at")
          .in("assignment_id", assignmentIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null })
  ]);

  const parsedProfiles = z.array(profileRowSchema).safeParse(profilesResult.data ?? []);
  const profilesById = new Map(
    (parsedProfiles.success ? parsedProfiles.data : []).map((p) => [p.id, p] as const)
  );

  const parsedResponses = z.array(responseCalibrationSchema).safeParse(responsesResult.data ?? []);

  // Build responses map: assignmentId -> { self answers, manager answers }
  const responsesByAssignment = new Map<
    string,
    {
      selfAnswers: Record<string, { rating: number | null; text: string | null }> | null;
      managerAnswers: Record<string, { rating: number | null; text: string | null }> | null;
    }
  >();

  if (parsedResponses.success) {
    for (const r of parsedResponses.data) {
      if (!r.submitted_at) continue;
      const existing = responsesByAssignment.get(r.assignment_id) ?? {
        selfAnswers: null,
        managerAnswers: null
      };
      const answers = normalizeReviewAnswers(r.answers);
      if (r.response_type === "self") existing.selfAnswers = answers;
      if (r.response_type === "manager") existing.managerAnswers = answers;
      responsesByAssignment.set(r.assignment_id, existing);
    }
  }

  // Build calibration rows
  const rows: CalibrationRow[] = [];
  let completedCount = 0;
  let totalSelfScore = 0;
  let selfScoreCount = 0;
  let totalManagerScore = 0;
  let managerScoreCount = 0;

  for (const assignment of parsedAssignments.data) {
    const employee = profilesById.get(assignment.employee_id);

    // Apply filters
    if (query.department && employee?.department !== query.department) continue;
    if (query.country && employee?.country_code !== query.country) continue;

    const sections = templatesById.get(assignment.template_id) ?? [];
    const responses = responsesByAssignment.get(assignment.id);

    const selfScore = responses?.selfAnswers
      ? computeAverageRatingScore(responses.selfAnswers, sections)
      : null;

    const managerScore = responses?.managerAnswers
      ? computeAverageRatingScore(responses.managerAnswers, sections)
      : null;

    const variance =
      selfScore !== null && managerScore !== null
        ? Number((selfScore - managerScore).toFixed(2))
        : null;

    let status: "unshared" | "shared" | "acknowledged" = "unshared";
    if (assignment.acknowledged_at) {
      status = "acknowledged";
    } else if (assignment.shared_at) {
      status = "shared";
    }

    if (assignment.status === "completed") {
      completedCount += 1;
    }

    if (selfScore !== null) {
      totalSelfScore += selfScore;
      selfScoreCount += 1;
    }

    if (managerScore !== null) {
      totalManagerScore += managerScore;
      managerScoreCount += 1;
    }

    rows.push({
      assignmentId: assignment.id,
      employeeId: assignment.employee_id,
      employeeName: employee?.full_name ?? "Unknown user",
      department: employee?.department ?? null,
      countryCode: employee?.country_code ?? null,
      reviewType: cycle.type as ReviewCycleType,
      selfScore,
      managerScore,
      variance,
      status
    });
  }

  const totalAssignments = rows.length;

  return jsonResponse<CalibrationResponseData>(200, {
    data: {
      cycle,
      rows,
      summary: {
        totalAssignments,
        completedAssignments: completedCount,
        completionPct: totalAssignments > 0 ? Number(((completedCount / totalAssignments) * 100).toFixed(1)) : 0,
        avgSelfScore: selfScoreCount > 0 ? Number((totalSelfScore / selfScoreCount).toFixed(2)) : null,
        avgManagerScore: managerScoreCount > 0 ? Number((totalManagerScore / managerScoreCount).toFixed(2)) : null
      }
    },
    error: null,
    meta: buildMeta()
  });
}
