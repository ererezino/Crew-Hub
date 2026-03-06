import { z } from "zod";

import { logAudit } from "../../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ReviewActionItem, ReviewActionItemMutationResponseData, ReviewActionItemsResponseData } from "../../../../../../../types/performance";
import {
  buildMeta,
  canManagePerformance,
  jsonResponse
} from "../../../_helpers";

const actionItemStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const actionItemRowSchema = z.object({
  id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  description: z.string(),
  due_date: z.string().nullable(),
  assigned_to: z.string().uuid().nullable(),
  status: actionItemStatusSchema,
  completed_at: z.string().nullable(),
  created_at: z.string()
});

const createActionItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required.").max(2000, "Description is too long."),
  dueDate: z.string().date().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional()
});

const assignmentScopeSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  reviewer_id: z.string().uuid()
});

const profileNameRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

function canAccessAssignment({
  profileId,
  assignment,
  isAdmin
}: {
  profileId: string;
  assignment: z.infer<typeof assignmentScopeSchema>;
  isAdmin: boolean;
}) {
  if (isAdmin) {
    return true;
  }

  return profileId === assignment.employee_id || profileId === assignment.reviewer_id;
}

function mapActionItemRow(
  row: z.infer<typeof actionItemRowSchema>,
  nameById: ReadonlyMap<string, string>
): ReviewActionItem {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    description: row.description,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to ? nameById.get(row.assigned_to) ?? "Unknown user" : null,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export async function GET(
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

  const profile = session.profile;

  const { id: assignmentId } = await params;

  if (!assignmentId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Assignment id is required." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const serviceRole = createSupabaseServiceRoleClient();
  const orgId = profile.org_id;

  const { data: rawAssignment, error: assignmentError } = await supabase
    .from("review_assignments")
    .select("id, org_id, employee_id, reviewer_id")
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (assignmentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ASSIGNMENT_FETCH_FAILED", message: "Unable to load assignment." },
      meta: buildMeta()
    });
  }

  const parsedAssignment = assignmentScopeSchema.safeParse(rawAssignment);

  if (!parsedAssignment.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Assignment was not found." },
      meta: buildMeta()
    });
  }

  const isAdmin = canManagePerformance(profile.roles);

  if (
    !canAccessAssignment({
      profileId: profile.id,
      assignment: parsedAssignment.data,
      isAdmin
    })
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You cannot access action items for this assignment." },
      meta: buildMeta()
    });
  }

  const { data: rawActionItems, error: actionItemsError } = await serviceRole
    .from("review_action_items")
    .select("id, assignment_id, description, due_date, assigned_to, status, completed_at, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  if (actionItemsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEMS_FETCH_FAILED", message: "Unable to load review action items." },
      meta: buildMeta()
    });
  }

  const parsedActionItems = z.array(actionItemRowSchema).safeParse(rawActionItems ?? []);

  if (!parsedActionItems.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEMS_PARSE_FAILED", message: "Action item data is invalid." },
      meta: buildMeta()
    });
  }

  const nameIds = new Set<string>();
  nameIds.add(parsedAssignment.data.employee_id);
  nameIds.add(parsedAssignment.data.reviewer_id);

  for (const row of parsedActionItems.data) {
    if (row.assigned_to) {
      nameIds.add(row.assigned_to);
    }
  }

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("id", [...nameIds]);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEMS_PROFILES_FETCH_FAILED", message: "Unable to resolve action item assignees." },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileNameRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEMS_PROFILES_PARSE_FAILED", message: "Assignee profile data is invalid." },
      meta: buildMeta()
    });
  }

  const nameById = new Map(parsedProfiles.data.map((row) => [row.id, row.full_name]));
  const actionItems = parsedActionItems.data.map((row) => mapActionItemRow(row, nameById));

  return jsonResponse<ReviewActionItemsResponseData>(200, {
    data: { actionItems },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(
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

  const profile = session.profile;

  const { id: assignmentId } = await params;

  if (!assignmentId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Assignment id is required." },
      meta: buildMeta()
    });
  }

  let parsedBody: z.infer<typeof createActionItemSchema>;

  try {
    const body = (await request.json()) as unknown;
    const parsed = createActionItemSchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid action item payload."
        },
        meta: buildMeta()
      });
    }

    parsedBody = parsed.data;
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const serviceRole = createSupabaseServiceRoleClient();
  const orgId = profile.org_id;

  const { data: rawAssignment, error: assignmentError } = await supabase
    .from("review_assignments")
    .select("id, org_id, employee_id, reviewer_id")
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (assignmentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ASSIGNMENT_FETCH_FAILED", message: "Unable to load assignment." },
      meta: buildMeta()
    });
  }

  const parsedAssignment = assignmentScopeSchema.safeParse(rawAssignment);

  if (!parsedAssignment.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Assignment was not found." },
      meta: buildMeta()
    });
  }

  const isAdmin = canManagePerformance(profile.roles);

  if (
    !canAccessAssignment({
      profileId: profile.id,
      assignment: parsedAssignment.data,
      isAdmin
    })
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You cannot create action items for this assignment." },
      meta: buildMeta()
    });
  }

  const assignedTo = parsedBody.assignedTo ?? parsedAssignment.data.employee_id;
  const validAssignedToValues = new Set([
    parsedAssignment.data.employee_id,
    parsedAssignment.data.reviewer_id
  ]);

  if (!validAssignedToValues.has(assignedTo)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Action items can only be assigned to the employee or reviewer for this review."
      },
      meta: buildMeta()
    });
  }

  const { data: rawInserted, error: insertError } = await serviceRole
    .from("review_action_items")
    .insert({
      assignment_id: assignmentId,
      description: parsedBody.description,
      due_date: parsedBody.dueDate ?? null,
      assigned_to: assignedTo,
      status: "pending",
      completed_at: null
    })
    .select("id, assignment_id, description, due_date, assigned_to, status, completed_at, created_at")
    .single();

  if (insertError || !rawInserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_CREATE_FAILED", message: "Unable to create action item." },
      meta: buildMeta()
    });
  }

  const parsedInserted = actionItemRowSchema.safeParse(rawInserted);

  if (!parsedInserted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_PARSE_FAILED", message: "Created action item is invalid." },
      meta: buildMeta()
    });
  }

  const { data: rawProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("id", [parsedAssignment.data.employee_id, parsedAssignment.data.reviewer_id]);

  const parsedProfiles = z.array(profileNameRowSchema).safeParse(rawProfiles ?? []);
  const nameById = parsedProfiles.success
    ? new Map(parsedProfiles.data.map((row) => [row.id, row.full_name]))
    : new Map<string, string>();
  const actionItem = mapActionItemRow(parsedInserted.data, nameById);

  void logAudit({
    action: "created",
    tableName: "review_action_items",
    recordId: actionItem.id,
    oldValue: null,
    newValue: {
      assignment_id: actionItem.assignmentId,
      description: actionItem.description,
      due_date: actionItem.dueDate,
      assigned_to: actionItem.assignedTo,
      status: actionItem.status
    }
  });

  if (assignedTo !== profile.id) {
    await createNotification({
      orgId,
      userId: assignedTo,
      type: "review_action_item_added",
      title: "New post-review action item",
      body: parsedBody.description,
      link: "/performance"
    });
  }

  return jsonResponse<ReviewActionItemMutationResponseData>(201, {
    data: { actionItem },
    error: null,
    meta: buildMeta()
  });
}
