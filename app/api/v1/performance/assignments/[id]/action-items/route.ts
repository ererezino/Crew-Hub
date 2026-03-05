import { z } from "zod";

import { logAudit } from "../../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ShareReviewResponseData } from "../../../../../../../types/performance";
import {
  assignmentRowSchema,
  assignmentSelectColumns,
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

const patchBodySchema = z.object({
  actionItemId: z.string().min(1),
  completed: z.boolean()
});

export async function PATCH(
  request: Request,
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid JSON body." },
      meta: buildMeta()
    });
  }

  const parsedBody = patchBodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid request."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Fetch assignment
  const { data: rawAssignment, error: fetchError } = await supabase
    .from("review_assignments")
    .select(assignmentSelectColumns)
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_FAILED", message: "Unable to load assignment." },
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

  // Only the employee can toggle their own action items
  if (parsedAssignment.data.employee_id !== session.profile.id) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the assigned employee can update action items."
      },
      meta: buildMeta()
    });
  }

  // Must be shared
  if (!parsedAssignment.data.shared_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Review must be shared before action items can be updated."
      },
      meta: buildMeta()
    });
  }

  // Parse existing action items
  const existingItems = Array.isArray(parsedAssignment.data.action_items)
    ? (parsedAssignment.data.action_items as Array<Record<string, unknown>>)
    : [];

  const itemIndex = existingItems.findIndex(
    (item) => item.id === parsedBody.data.actionItemId
  );

  if (itemIndex === -1) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Action item was not found." },
      meta: buildMeta()
    });
  }

  // Update the action item
  const updatedItems = [...existingItems];
  updatedItems[itemIndex] = {
    ...updatedItems[itemIndex],
    completed: parsedBody.data.completed,
    completedAt: parsedBody.data.completed ? new Date().toISOString() : null
  };

  const { data: rawUpdated, error: updateError } = await supabase
    .from("review_assignments")
    .update({ action_items: updatedItems })
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .select(assignmentSelectColumns)
    .single();

  if (updateError || !rawUpdated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_FAILED", message: "Unable to update action item." },
      meta: buildMeta()
    });
  }

  const parsedUpdated = assignmentRowSchema.safeParse(rawUpdated);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_FAILED", message: "Updated assignment is invalid." },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "review_assignments",
    recordId: assignmentId,
    oldValue: { action_items: existingItems },
    newValue: { action_items: updatedItems }
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
      error: { code: "ACTION_ITEM_FAILED", message: "Unable to load enrichment data." },
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
      error: { code: "ACTION_ITEM_FAILED", message: "Cycle mapping failed." },
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
      error: { code: "ACTION_ITEM_FAILED", message: "Assignment mapping failed." },
      meta: buildMeta()
    });
  }

  return jsonResponse<ShareReviewResponseData>(200, {
    data: { assignment: assignments[0] },
    error: null,
    meta: buildMeta()
  });
}
