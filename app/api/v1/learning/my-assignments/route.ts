import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { determineAssignmentStatus } from "../../../../../lib/learning";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import {
  LEARNING_ASSIGNMENT_STATUSES,
  type LearningMyAssignmentsResponseData
} from "../../../../../types/learning";
import {
  assignmentRowSchema,
  buildMeta,
  jsonResponse,
  mapAssignmentRow
} from "../_helpers";

const querySchema = z.object({
  status: z.enum(LEARNING_ASSIGNMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(200)
});

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view learning assignments."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid assignments query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  let assignmentsQuery = supabase
    .from("course_assignments")
    .select(
      "id, org_id, course_id, employee_id, status, progress_pct, module_progress, quiz_score, quiz_attempts, due_date, started_at, completed_at, certificate_url, assigned_by, created_at, updated_at, course:courses(title, category, content_type, duration_minutes), employee:profiles!course_assignments_employee_id_fkey(full_name, department, country_code), assigned_by_profile:profiles!course_assignments_assigned_by_fkey(full_name)"
    )
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(query.limit);

  if (query.status) {
    assignmentsQuery = assignmentsQuery.eq("status", query.status);
  }

  const { data: rawAssignments, error: assignmentsError } = await assignmentsQuery;

  if (assignmentsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENTS_FETCH_FAILED",
        message: "Unable to load learning assignments."
      },
      meta: buildMeta()
    });
  }

  const parsedAssignments = z.array(assignmentRowSchema).safeParse(rawAssignments ?? []);

  if (!parsedAssignments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENTS_PARSE_FAILED",
        message: "Learning assignments are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const assignments = parsedAssignments.data.map((row) => {
    const assignment = mapAssignmentRow(row);

    return {
      ...assignment,
      status: determineAssignmentStatus({
        status: assignment.status,
        dueDate: assignment.dueDate,
        completedAt: assignment.completedAt
      })
    };
  });

  return jsonResponse<LearningMyAssignmentsResponseData>(200, {
    data: {
      assignments
    },
    error: null,
    meta: buildMeta()
  });
}
