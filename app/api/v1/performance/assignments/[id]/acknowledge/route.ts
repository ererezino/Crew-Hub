import { z } from "zod";

import { logAudit } from "../../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { sendReviewAcknowledgedEmail } from "../../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";
import type { AcknowledgeReviewResponseData } from "../../../../../../../types/performance";
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
} from "../../../_helpers";

const assignmentSelectCols =
  "id, org_id, cycle_id, employee_id, reviewer_id, template_id, status, due_at, shared_at, shared_by, acknowledged_at, created_at, updated_at";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const { id: assignmentId } = await params;

  if (!assignmentId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Assignment id is required." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Fetch assignment
  const { data: rawAssignment, error: fetchError } = await supabase
    .from("review_assignments")
    .select(assignmentSelectCols)
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Unable to load assignment." },
      meta: buildMeta()
    });
  }

  const parsedAssignment = assignmentRowSchema.safeParse(rawAssignment);

  if (!parsedAssignment.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Assignment was not found." },
      meta: buildMeta()
    });
  }

  // Only the employee (review subject) can acknowledge
  if (parsedAssignment.data.employee_id !== session.profile.id) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the review subject can acknowledge this review."
      },
      meta: buildMeta()
    });
  }

  // Must be shared first
  if (!parsedAssignment.data.shared_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Review must be shared before it can be acknowledged."
      },
      meta: buildMeta()
    });
  }

  // Already acknowledged?
  if (parsedAssignment.data.acknowledged_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "This review has already been acknowledged."
      },
      meta: buildMeta()
    });
  }

  // Update assignment
  const { data: rawUpdated, error: updateError } = await supabase
    .from("review_assignments")
    .update({
      acknowledged_at: new Date().toISOString()
    })
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .select(assignmentSelectCols)
    .single();

  if (updateError || !rawUpdated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Unable to acknowledge review." },
      meta: buildMeta()
    });
  }

  const parsedUpdated = assignmentRowSchema.safeParse(rawUpdated);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Updated assignment is invalid." },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "review_assignments",
    recordId: assignmentId,
    oldValue: { acknowledged_at: null },
    newValue: { acknowledged_at: parsedUpdated.data.acknowledged_at }
  });

  // Fetch enrichment data for response
  const [cycleResult, templateResult, profilesResult, responsesResult] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("id, org_id, name, type, status, start_date, end_date, self_review_deadline, manager_review_deadline, created_by, created_at, updated_at")
      .eq("id", parsedUpdated.data.cycle_id)
      .maybeSingle(),
    supabase
      .from("review_templates")
      .select("id, org_id, name, sections, created_by, created_at, updated_at")
      .eq("id", parsedUpdated.data.template_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, department, country_code")
      .eq("org_id", orgId)
      .in("id", [
        parsedUpdated.data.employee_id,
        parsedUpdated.data.reviewer_id,
        ...(parsedUpdated.data.shared_by ? [parsedUpdated.data.shared_by] : [])
      ]),
    supabase
      .from("review_responses")
      .select("id, org_id, assignment_id, respondent_id, response_type, answers, submitted_at, updated_at")
      .eq("assignment_id", assignmentId)
      .is("deleted_at", null)
  ]);

  const parsedCycle = cycleRowSchema.safeParse(cycleResult.data);
  const parsedTemplate = templateRowSchema.safeParse(templateResult.data);
  const parsedProfiles = z.array(profileRowSchema).safeParse(profilesResult.data ?? []);
  const parsedResponses = z.array(responseRowSchema).safeParse(responsesResult.data ?? []);

  if (!parsedCycle.success || !parsedTemplate.success || !parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Unable to load enrichment data." },
      meta: buildMeta()
    });
  }

  const cycle = mapCycleRow(parsedCycle.data, "System");
  const template = mapTemplateRow(parsedTemplate.data);
  const profilesById = new Map(parsedProfiles.data.map((p) => [p.id, p] as const));

  const responsesByAssignmentId = new Map<string, { selfResponse: ReturnType<typeof mapResponseRow>; managerResponse: ReturnType<typeof mapResponseRow> }>();
  if (parsedResponses.success) {
    let selfResp: ReturnType<typeof mapResponseRow> = null;
    let managerResp: ReturnType<typeof mapResponseRow> = null;
    for (const r of parsedResponses.data) {
      const mapped = mapResponseRow(r);
      if (r.response_type === "self") selfResp = mapped;
      if (r.response_type === "manager") managerResp = mapped;
    }
    responsesByAssignmentId.set(assignmentId, { selfResponse: selfResp, managerResponse: managerResp });
  }

  if (!cycle) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Cycle mapping failed." },
      meta: buildMeta()
    });
  }

  const cyclesById = new Map([[cycle.id, cycle]]);
  const templatesById = new Map([[template.id, template]]);

  const assignments = mapAssignmentRows({
    assignments: [parsedUpdated.data],
    cyclesById,
    templatesById,
    profilesById,
    responsesByAssignmentId
  });

  if (assignments.length === 0) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Assignment mapping failed." },
      meta: buildMeta()
    });
  }

  // Notify the reviewer
  const employeeProfile = profilesById.get(parsedUpdated.data.employee_id);
  await createNotification({
    orgId,
    userId: parsedUpdated.data.reviewer_id,
    type: "review_acknowledged",
    title: "Review acknowledged",
    body: `${employeeProfile?.full_name ?? "An employee"} has acknowledged their review.`,
    link: "/performance"
  });

  void sendReviewAcknowledgedEmail({
    orgId,
    userId: parsedUpdated.data.reviewer_id,
    cycleName: cycle.name,
    employeeName: employeeProfile?.full_name ?? "An employee"
  });

  return jsonResponse<AcknowledgeReviewResponseData>(200, {
    data: { assignment: assignments[0] },
    error: null,
    meta: buildMeta()
  });
}
