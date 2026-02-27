import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { PerformanceAdminResponseData } from "../../../../../types/performance";
import {
  assignmentRowSchema,
  buildMeta,
  canManagePerformance,
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

const directoryRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable(),
  status: z.enum(["active", "inactive", "onboarding", "offboarding"])
});

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage performance reviews."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePerformance(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can manage performance reviews."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const orgId = session.profile.org_id;

    const [
      { data: rawCycles, error: cyclesError },
      { data: rawTemplates, error: templatesError },
      { data: rawAssignments, error: assignmentsError }
    ] = await Promise.all([
      supabase
        .from("review_cycles")
        .select(
          "id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at"
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("start_date", { ascending: false })
        .limit(100),
      supabase
        .from("review_templates")
        .select("id, org_id, name, sections, created_by, created_at, updated_at")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("review_assignments")
        .select(
          "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, created_at, updated_at"
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(600)
    ]);

    if (cyclesError || templatesError || assignmentsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_ADMIN_FETCH_FAILED",
          message:
            cyclesError?.message ??
            templatesError?.message ??
            assignmentsError?.message ??
            "Unable to load performance admin data."
        },
        meta: buildMeta()
      });
    }

    const parsedCycles = z.array(cycleRowSchema).safeParse(rawCycles ?? []);
    const parsedTemplates = z.array(templateRowSchema).safeParse(rawTemplates ?? []);
    const parsedAssignments = z.array(assignmentRowSchema).safeParse(rawAssignments ?? []);

    if (!parsedCycles.success || !parsedTemplates.success || !parsedAssignments.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_ADMIN_PARSE_FAILED",
          message: "Performance admin records are not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const cycleRows = parsedCycles.data;
    const templateRows = parsedTemplates.data;
    const assignmentRows = parsedAssignments.data;

    const cycleCreatorIds = [...new Set(cycleRows.map((row) => row.created_by))];
    const employeeIds = assignmentRows.map((row) => row.employee_id);
    const reviewerIds = assignmentRows.map((row) => row.reviewer_id);
    const profileIds = [...new Set([...cycleCreatorIds, ...employeeIds, ...reviewerIds])];
    const assignmentIds = assignmentRows.map((row) => row.id);

    const [
      { data: rawProfiles, error: profilesError },
      { data: rawResponses, error: responsesError },
      { data: rawDirectory, error: directoryError }
    ] =
      await Promise.all([
        profileIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, full_name, department, country_code")
              .eq("org_id", orgId)
              .is("deleted_at", null)
              .in("id", profileIds)
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
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("profiles")
          .select("id, full_name, department, country_code, manager_id, status")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("full_name", { ascending: true })
      ]);

    if (profilesError || responsesError || directoryError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_ADMIN_FETCH_FAILED",
          message:
            profilesError?.message ??
            responsesError?.message ??
            directoryError?.message ??
            "Unable to resolve performance admin metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);
    const parsedResponses = z.array(responseRowSchema).safeParse(rawResponses ?? []);
    const parsedDirectory = z.array(directoryRowSchema).safeParse(rawDirectory ?? []);

    if (!parsedProfiles.success || !parsedResponses.success || !parsedDirectory.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PERFORMANCE_ADMIN_PARSE_FAILED",
          message: "Performance admin metadata is invalid."
        },
        meta: buildMeta()
      });
    }

    const profilesById = new Map(parsedProfiles.data.map((row) => [row.id, row]));
    const templatesById = new Map(templateRows.map((row) => [row.id, mapTemplateRow(row)]));
    const cyclesById = new Map<string, ReturnType<typeof mapCycleRow> extends infer T ? Exclude<T, null> : never>();

    for (const cycleRow of cycleRows) {
      const creatorName = profilesById.get(cycleRow.created_by)?.full_name ?? "Unknown user";
      const mappedCycle = mapCycleRow(cycleRow, creatorName);

      if (mappedCycle) {
        cyclesById.set(mappedCycle.id, mappedCycle);
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

    const cycles = [...cyclesById.values()];
    const templates = [...templatesById.values()];
    const directory = parsedDirectory.data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      department: row.department,
      countryCode: row.country_code,
      managerId: row.manager_id,
      status: row.status
    }));

    const responseData: PerformanceAdminResponseData = {
      cycles,
      templates,
      assignments,
      directory,
      metrics: {
        totalAssignments: assignments.length,
        completedAssignments: assignments.filter((row) => row.status === "completed").length,
        pendingSelfAssignments: assignments.filter((row) => row.status === "pending_self").length,
        pendingManagerAssignments: assignments.filter((row) => row.status === "pending_manager").length,
        inReviewAssignments: assignments.filter((row) => row.status === "in_review").length
      }
    };

    return jsonResponse<PerformanceAdminResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PERFORMANCE_ADMIN_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load performance admin data."
      },
      meta: buildMeta()
    });
  }
}
