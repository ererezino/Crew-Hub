import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { PerformanceOverviewResponseData } from "../../../../../types/performance";
import {
  assignmentRowSchema,
  buildMeta,
  cycleRowSchema,
  jsonResponse,
  mapAssignmentRows,
  mapCycleRow,
  mapResponseRow,
  mapTemplateRow,
  profileRowSchema,
  responseRowSchema,
  templateRowSchema
} from "../_helpers";

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view performance reviews."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const orgId = session.profile.org_id;
    const userId = session.profile.id;

    const [{ data: rawCycles, error: cyclesError }, { data: rawAssignments, error: assignmentsError }] =
      await Promise.all([
        supabase
          .from("review_cycles")
          .select(
            "id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at"
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("start_date", { ascending: false })
          .limit(64),
        supabase
          .from("review_assignments")
          .select(
            "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, shared_at, shared_by, acknowledged_at, created_at, updated_at"
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .or(`employee_id.eq.${userId},reviewer_id.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(240)
      ]);

    if (cyclesError || assignmentsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_FETCH_FAILED",
          message:
            cyclesError?.message ??
            assignmentsError?.message ??
            "Unable to load performance data."
        },
        meta: buildMeta()
      });
    }

    const parsedCycles = z.array(cycleRowSchema).safeParse(rawCycles ?? []);
    const parsedAssignments = z.array(assignmentRowSchema).safeParse(rawAssignments ?? []);

    if (!parsedCycles.success || !parsedAssignments.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_PARSE_FAILED",
          message: "Performance data is not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const cycleRows = parsedCycles.data;
    const assignmentRows = parsedAssignments.data;

    const cycleCreatorIds = [...new Set(cycleRows.map((row) => row.created_by))];
    const employeeIds = assignmentRows.map((row) => row.employee_id);
    const reviewerIds = assignmentRows.map((row) => row.reviewer_id);
    const profileIds = [...new Set([...cycleCreatorIds, ...employeeIds, ...reviewerIds])];
    const templateIds = [...new Set(assignmentRows.map((row) => row.template_id))];
    const assignmentIds = assignmentRows.map((row) => row.id);

    const [
      { data: rawProfiles, error: profilesError },
      { data: rawTemplates, error: templatesError },
      { data: rawResponses, error: responsesError }
    ] = await Promise.all([
      profileIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name, department, country_code")
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      templateIds.length > 0
        ? supabase
            .from("review_templates")
            .select("id, org_id, name, sections, created_by, created_at, updated_at")
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .in("id", templateIds)
        : Promise.resolve({ data: [], error: null }),
      assignmentIds.length > 0
        ? supabase
            .from("review_responses")
            .select(
              "id, org_id, assignment_id, respondent_id, response_type, answers, submitted_at, updated_at"
            )
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .in("assignment_id", assignmentIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (profilesError || templatesError || responsesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_FETCH_FAILED",
          message:
            profilesError?.message ??
            templatesError?.message ??
            responsesError?.message ??
            "Unable to resolve performance metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);
    const parsedTemplates = z.array(templateRowSchema).safeParse(rawTemplates ?? []);
    const parsedResponses = z.array(responseRowSchema).safeParse(rawResponses ?? []);

    if (!parsedProfiles.success || !parsedTemplates.success || !parsedResponses.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_PARSE_FAILED",
          message: "Performance metadata is not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const profilesById = new Map(parsedProfiles.data.map((row) => [row.id, row]));
    const templatesById = new Map(
      parsedTemplates.data.map((row) => [row.id, mapTemplateRow(row)])
    );

    const cyclesById = new Map<string, ReturnType<typeof mapCycleRow> extends infer T ? Exclude<T, null> : never>();

    for (const cycleRow of cycleRows) {
      const creatorName = profilesById.get(cycleRow.created_by)?.full_name ?? "Unknown user";
      const mappedCycle = mapCycleRow(cycleRow, creatorName);

      if (mappedCycle) {
        cyclesById.set(cycleRow.id, mappedCycle);
      }
    }

    const responsesByAssignmentId = new Map<
      string,
      {
        selfResponse: ReturnType<typeof mapResponseRow>;
        managerResponse: ReturnType<typeof mapResponseRow>;
      }
    >();

    for (const responseRow of parsedResponses.data) {
      const mappedResponse = mapResponseRow(responseRow);

      if (!mappedResponse) {
        continue;
      }

      const current = responsesByAssignmentId.get(mappedResponse.assignmentId) ?? {
        selfResponse: null,
        managerResponse: null
      };

      if (mappedResponse.responseType === "self") {
        current.selfResponse = mappedResponse;
      } else {
        current.managerResponse = mappedResponse;
      }

      responsesByAssignmentId.set(mappedResponse.assignmentId, current);
    }

    const assignments = mapAssignmentRows({
      assignments: assignmentRows,
      cyclesById,
      templatesById,
      profilesById,
      responsesByAssignmentId
    });

    const activeCycle =
      [...cyclesById.values()].find(
        (cycle) => cycle.status === "active" || cycle.status === "in_review"
      ) ?? null;

    const selfAssignment =
      assignments.find(
        (assignment) =>
          assignment.employeeId === userId &&
          (assignment.cycleStatus === "active" || assignment.cycleStatus === "in_review")
      ) ?? null;

    const managerAssignments = assignments.filter(
      (assignment) =>
        assignment.reviewerId === userId &&
        assignment.employeeId !== userId &&
        (assignment.cycleStatus === "active" || assignment.cycleStatus === "in_review")
    );

    const pastAssignments = assignments.filter(
      (assignment) =>
        assignment.employeeId === userId &&
        assignment.cycleStatus === "completed"
    );

    const responseData: PerformanceOverviewResponseData = {
      activeCycle,
      selfAssignment,
      managerAssignments,
      pastAssignments
    };

    return jsonResponse<PerformanceOverviewResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PERFORMANCE_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load performance data."
      },
      meta: buildMeta()
    });
  }
}
