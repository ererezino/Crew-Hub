import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  LearningReportsCourseRow,
  LearningReportsResponseData,
  LearningReportsSummary
} from "../../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  canViewLearningReports,
  jsonResponse,
  mapAssignmentRow
} from "../../_helpers";

const reportAssignmentRowSchema = z.object({
  course_id: z.string().uuid(),
  status: z.string(),
  course: z
    .object({
      title: z.string()
    })
    .nullable()
});

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view learning reports."
      },
      meta: buildMeta()
    });
  }

  if (!canViewLearningReports(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can view learning reports."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    { data: rawSummaryRows, error: summaryError },
    { data: rawOverdueRows, error: overdueError }
  ] = await Promise.all([
    supabase
      .from("course_assignments")
      .select("course_id, status, course:courses(title)")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null),
    supabase
      .from("course_assignments")
      .select(
        "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
      )
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .neq("status", "completed")
      .lte("due_date", todayIso)
      .order("due_date", { ascending: true })
      .limit(50)
  ]);

  if (summaryError || overdueError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEARNING_REPORTS_FETCH_FAILED",
        message: "Unable to load learning reports."
      },
      meta: buildMeta()
    });
  }

  const parsedSummaryRows = z.array(reportAssignmentRowSchema).safeParse(rawSummaryRows ?? []);

  if (!parsedSummaryRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEARNING_REPORTS_PARSE_FAILED",
        message: "Learning report rows are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const parsedOverdueRows = z.array(assignmentRowSchema).safeParse(rawOverdueRows ?? []);

  if (!parsedOverdueRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEARNING_OVERDUE_PARSE_FAILED",
        message: "Overdue learning assignments are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const summary: LearningReportsSummary = {
    totalAssigned: 0,
    totalInProgress: 0,
    totalCompleted: 0,
    totalOverdue: 0,
    totalFailed: 0,
    completionRatePct: 0
  };

  const courseAggregate = new Map<string, LearningReportsCourseRow>();

  for (const row of parsedSummaryRows.data) {
    const status = row.status;

    switch (status) {
      case "assigned":
        summary.totalAssigned += 1;
        break;
      case "in_progress":
        summary.totalInProgress += 1;
        break;
      case "completed":
        summary.totalCompleted += 1;
        break;
      case "overdue":
        summary.totalOverdue += 1;
        break;
      case "failed":
        summary.totalFailed += 1;
        break;
      default:
        break;
    }

    const currentCourseAggregate = courseAggregate.get(row.course_id) ?? {
      courseId: row.course_id,
      courseTitle: row.course?.title ?? "Course",
      assignedCount: 0,
      completedCount: 0,
      overdueCount: 0,
      failedCount: 0,
      completionRatePct: 0
    };

    currentCourseAggregate.assignedCount += 1;

    if (status === "completed") {
      currentCourseAggregate.completedCount += 1;
    }

    if (status === "overdue") {
      currentCourseAggregate.overdueCount += 1;
    }

    if (status === "failed") {
      currentCourseAggregate.failedCount += 1;
    }

    courseAggregate.set(row.course_id, currentCourseAggregate);
  }

  const totalAssignmentCount =
    summary.totalAssigned +
    summary.totalInProgress +
    summary.totalCompleted +
    summary.totalOverdue +
    summary.totalFailed;

  summary.completionRatePct =
    totalAssignmentCount > 0
      ? Number(((summary.totalCompleted / totalAssignmentCount) * 100).toFixed(2))
      : 0;

  const courses = [...courseAggregate.values()]
    .map((row) => ({
      ...row,
      completionRatePct:
        row.assignedCount > 0
          ? Number(((row.completedCount / row.assignedCount) * 100).toFixed(2))
          : 0
    }))
    .sort((leftRow, rightRow) => rightRow.assignedCount - leftRow.assignedCount);

  const overdueAssignments = parsedOverdueRows.data.map((row) => mapAssignmentRow(row));

  return jsonResponse<LearningReportsResponseData>(200, {
    data: {
      summary,
      courses,
      overdueAssignments
    },
    error: null,
    meta: buildMeta()
  });
}
