import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createNotification } from "../../../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ReviewActionItemMutationResponseData } from "../../../../../../types/performance";
import {
  buildMeta,
  canManagePerformance,
  jsonResponse
} from "../../_helpers";

const actionItemStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const updateActionItemSchema = z.object({
  status: actionItemStatusSchema
});

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
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

  const { itemId } = await params;

  if (!itemId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Action item id is required." },
      meta: buildMeta()
    });
  }

  let parsedBody: z.infer<typeof updateActionItemSchema>;

  try {
    const body = (await request.json()) as unknown;
    const parsed = updateActionItemSchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid action item update payload."
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

  const { data: rawCurrentItem, error: itemError } = await serviceRole
    .from("review_action_items")
    .select("id, assignment_id, description, due_date, assigned_to, status, completed_at, created_at")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_FETCH_FAILED", message: "Unable to load action item." },
      meta: buildMeta()
    });
  }

  const parsedCurrentItem = actionItemRowSchema.safeParse(rawCurrentItem);

  if (!parsedCurrentItem.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Action item was not found." },
      meta: buildMeta()
    });
  }

  const { data: rawAssignment, error: assignmentError } = await supabase
    .from("review_assignments")
    .select("id, org_id, employee_id, reviewer_id")
    .eq("id", parsedCurrentItem.data.assignment_id)
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
      error: { code: "FORBIDDEN", message: "You cannot update this action item." },
      meta: buildMeta()
    });
  }

  const completedAt = parsedBody.status === "completed" ? new Date().toISOString() : null;

  const { data: rawUpdated, error: updateError } = await serviceRole
    .from("review_action_items")
    .update({
      status: parsedBody.status,
      completed_at: completedAt
    })
    .eq("id", itemId)
    .select("id, assignment_id, description, due_date, assigned_to, status, completed_at, created_at")
    .single();

  if (updateError || !rawUpdated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_UPDATE_FAILED", message: "Unable to update action item." },
      meta: buildMeta()
    });
  }

  const parsedUpdated = actionItemRowSchema.safeParse(rawUpdated);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACTION_ITEM_PARSE_FAILED", message: "Updated action item is invalid." },
      meta: buildMeta()
    });
  }

  const { data: rawProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("id", [
      parsedAssignment.data.employee_id,
      parsedAssignment.data.reviewer_id,
      ...(parsedUpdated.data.assigned_to ? [parsedUpdated.data.assigned_to] : [])
    ]);

  const parsedProfiles = z.array(profileNameRowSchema).safeParse(rawProfiles ?? []);
  const nameById = parsedProfiles.success
    ? new Map(parsedProfiles.data.map((row) => [row.id, row.full_name]))
    : new Map<string, string>();

  const actionItem = {
    id: parsedUpdated.data.id,
    assignmentId: parsedUpdated.data.assignment_id,
    description: parsedUpdated.data.description,
    dueDate: parsedUpdated.data.due_date,
    assignedTo: parsedUpdated.data.assigned_to,
    assignedToName: parsedUpdated.data.assigned_to
      ? nameById.get(parsedUpdated.data.assigned_to) ?? "Unknown user"
      : null,
    status: parsedUpdated.data.status,
    completedAt: parsedUpdated.data.completed_at,
    createdAt: parsedUpdated.data.created_at
  };

  void logAudit({
    action: "updated",
    tableName: "review_action_items",
    recordId: itemId,
    oldValue: {
      status: parsedCurrentItem.data.status,
      completed_at: parsedCurrentItem.data.completed_at
    },
    newValue: {
      status: actionItem.status,
      completed_at: actionItem.completedAt
    }
  });

  if (parsedBody.status === "completed") {
    const notifyUserIds = [parsedAssignment.data.employee_id, parsedAssignment.data.reviewer_id].filter(
      (userId) => userId !== profile.id
    );

    for (const userId of notifyUserIds) {
      await createNotification({
        orgId,
        userId,
        type: "review_action_item_completed",
        title: "Post-review action completed",
        body: actionItem.description,
        link: "/performance"
      });
    }
  }

  return jsonResponse<ReviewActionItemMutationResponseData>(200, {
    data: { actionItem },
    error: null,
    meta: buildMeta()
  });
}
