import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  canManageCompliance,
  complianceUrgency,
  isComplianceCadence,
  isComplianceStatus
} from "../../../../../../lib/compliance";
import { sendComplianceReminderEmail } from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import { normalizeUserRoles } from "../../../../../../lib/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type {
  ComplianceDeadlineRecord,
  UpdateComplianceDeadlineData,
  UpdateComplianceDeadlinePayload
} from "../../../../../../types/compliance";

const payloadSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "overdue"]),
  assignedTo: z.string().uuid().nullable(),
  proofDocumentId: z.string().uuid().nullable(),
  notes: z.string().trim().max(2000).nullable()
});

const deadlineRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  due_date: z.string(),
  status: z.string(),
  assigned_to: z.string().uuid().nullable(),
  proof_document_id: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const itemRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string(),
  authority: z.string(),
  requirement: z.string(),
  description: z.string().nullable(),
  cadence: z.string(),
  category: z.string(),
  notes: z.string().nullable(),
  authority_url: z.string().nullable().optional(),
  local_guidance: z.string().nullable().optional()
});

const assigneeRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const proofDocumentRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return Response.json(payload, { status });
}

function dueSoonOrOverdue(dueDate: string): boolean {
  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return false;
  }

  const dueSoonLimit = new Date(today);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7);

  return due.getTime() <= dueSoonLimit.getTime();
}

function mapDeadline({
  deadline,
  item,
  assignee,
  proofDocument
}: {
  deadline: z.infer<typeof deadlineRowSchema>;
  item: z.infer<typeof itemRowSchema>;
  assignee: z.infer<typeof assigneeRowSchema> | null;
  proofDocument: z.infer<typeof proofDocumentRowSchema> | null;
}): ComplianceDeadlineRecord {
  const status = isComplianceStatus(deadline.status) ? deadline.status : "pending";
  const cadence = isComplianceCadence(item.cadence) ? item.cadence : "monthly";
  const urgency = complianceUrgency({
    status,
    dueDate: deadline.due_date
  });

  return {
    id: deadline.id,
    itemId: deadline.item_id,
    countryCode: item.country_code,
    authority: item.authority,
    requirement: item.requirement,
    description: item.description,
    cadence,
    category: item.category,
    itemNotes: item.notes,
    authorityUrl: item.authority_url ?? null,
    localGuidance: item.local_guidance ?? null,
    dueDate: deadline.due_date,
    status,
    urgency,
    assignedTo: deadline.assigned_to,
    assignedToName: assignee?.full_name ?? null,
    proofDocumentId: deadline.proof_document_id,
    proofDocumentTitle: proofDocument?.title ?? null,
    completedAt: deadline.completed_at,
    notes: deadline.notes,
    createdAt: deadline.created_at,
    updatedAt: deadline.updated_at
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deadlineId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update compliance deadlines."
      },
      meta: buildMeta()
    });
  }

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!canManageCompliance(userRoles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin, Finance Admin, and Super Admin can update compliance."
      },
      meta: buildMeta()
    });
  }

  const { deadlineId } = await params;

  if (!deadlineId) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Deadline id is required."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedPayload = payloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid deadline update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data as UpdateComplianceDeadlinePayload;
  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  const { data: rawDeadlineRow, error: deadlineFetchError } = await supabase
    .from("compliance_deadlines")
    .select(
      "id, item_id, due_date, status, assigned_to, proof_document_id, completed_at, notes, created_at, updated_at"
    )
    .eq("id", deadlineId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (deadlineFetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Unable to load compliance deadline."
      },
      meta: buildMeta()
    });
  }

  const parsedDeadline = deadlineRowSchema.safeParse(rawDeadlineRow);

  if (!parsedDeadline.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Compliance deadline was not found."
      },
      meta: buildMeta()
    });
  }

  const { data: rawItemRow, error: itemFetchError } = await supabase
    .from("compliance_items")
    .select("id, country_code, authority, requirement, description, cadence, category, notes, authority_url, local_guidance")
    .eq("id", parsedDeadline.data.item_id)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (itemFetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Unable to load compliance item."
      },
      meta: buildMeta()
    });
  }

  const parsedItem = itemRowSchema.safeParse(rawItemRow);

  if (!parsedItem.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Compliance item was not found."
      },
      meta: buildMeta()
    });
  }

  if (payload.assignedTo) {
    const { data: rawAssignee, error: assigneeError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .eq("id", payload.assignedTo)
      .is("deleted_at", null)
      .maybeSingle();

    if (assigneeError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "COMPLIANCE_UPDATE_FAILED",
          message: "Unable to validate assignee."
        },
        meta: buildMeta()
      });
    }

    if (!assigneeRowSchema.safeParse(rawAssignee).success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Assigned user is invalid."
        },
        meta: buildMeta()
      });
    }
  }

  if (payload.proofDocumentId) {
    const { data: rawProofDocument, error: proofDocumentError } = await supabase
      .from("documents")
      .select("id, title")
      .eq("org_id", orgId)
      .eq("id", payload.proofDocumentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (proofDocumentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "COMPLIANCE_UPDATE_FAILED",
          message: "Unable to validate proof document."
        },
        meta: buildMeta()
      });
    }

    if (!proofDocumentRowSchema.safeParse(rawProofDocument).success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Proof document is invalid."
        },
        meta: buildMeta()
      });
    }
  }

  const completedAt =
    payload.status === "completed"
      ? parsedDeadline.data.completed_at ?? new Date().toISOString()
      : null;

  const { data: rawUpdatedDeadline, error: updateError } = await supabase
    .from("compliance_deadlines")
    .update({
      status: payload.status,
      assigned_to: payload.assignedTo,
      proof_document_id: payload.proofDocumentId,
      completed_at: completedAt,
      notes: payload.notes
    })
    .eq("id", deadlineId)
    .eq("org_id", orgId)
    .select(
      "id, item_id, due_date, status, assigned_to, proof_document_id, completed_at, notes, created_at, updated_at"
    )
    .single();

  if (updateError || !rawUpdatedDeadline) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Unable to update compliance deadline."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedDeadline = deadlineRowSchema.safeParse(rawUpdatedDeadline);

  if (!parsedUpdatedDeadline.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Updated compliance deadline is invalid."
      },
      meta: buildMeta()
    });
  }

  // ── Audit log ──
  void logAudit({
    action: "updated",
    tableName: "compliance_deadlines",
    recordId: deadlineId,
    oldValue: {
      status: parsedDeadline.data.status,
      assigned_to: parsedDeadline.data.assigned_to,
      proof_document_id: parsedDeadline.data.proof_document_id,
      notes: parsedDeadline.data.notes,
      completed_at: parsedDeadline.data.completed_at
    },
    newValue: {
      status: parsedUpdatedDeadline.data.status,
      assigned_to: parsedUpdatedDeadline.data.assigned_to,
      proof_document_id: parsedUpdatedDeadline.data.proof_document_id,
      notes: parsedUpdatedDeadline.data.notes,
      completed_at: parsedUpdatedDeadline.data.completed_at
    }
  });

  const [assigneeResult, proofDocumentResult] = await Promise.all([
    parsedUpdatedDeadline.data.assigned_to
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("org_id", orgId)
          .eq("id", parsedUpdatedDeadline.data.assigned_to)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    parsedUpdatedDeadline.data.proof_document_id
      ? supabase
          .from("documents")
          .select("id, title")
          .eq("org_id", orgId)
          .eq("id", parsedUpdatedDeadline.data.proof_document_id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (assigneeResult.error || proofDocumentResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_UPDATE_FAILED",
        message: "Unable to load updated compliance metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedAssignee = assigneeRowSchema.safeParse(assigneeResult.data);
  const parsedProofDocument = proofDocumentRowSchema.safeParse(proofDocumentResult.data);
  const assignee = parsedAssignee.success ? parsedAssignee.data : null;
  const proofDocument = parsedProofDocument.success ? parsedProofDocument.data : null;

  const responseData: UpdateComplianceDeadlineData = {
    deadline: mapDeadline({
      deadline: parsedUpdatedDeadline.data,
      item: parsedItem.data,
      assignee,
      proofDocument
    })
  };

  if (
    parsedUpdatedDeadline.data.assigned_to &&
    parsedUpdatedDeadline.data.assigned_to !== parsedDeadline.data.assigned_to
  ) {
    await createNotification({
      orgId,
      userId: parsedUpdatedDeadline.data.assigned_to,
      type: "compliance_deadline",
      title: "Compliance deadline assigned",
      body: `${parsedItem.data.requirement} is due on ${parsedUpdatedDeadline.data.due_date}.`,
      link: "/compliance"
    });
  }

  if (
    parsedUpdatedDeadline.data.assigned_to &&
    (parsedUpdatedDeadline.data.status === "pending" ||
      parsedUpdatedDeadline.data.status === "in_progress") &&
    dueSoonOrOverdue(parsedUpdatedDeadline.data.due_date)
  ) {
    await createNotification({
      orgId,
      userId: parsedUpdatedDeadline.data.assigned_to,
      type: "compliance_deadline",
      title: "Compliance reminder",
      body: `${parsedItem.data.requirement} is due on ${parsedUpdatedDeadline.data.due_date}.`,
      link: "/compliance"
    });

    await sendComplianceReminderEmail({
      orgId,
      userId: parsedUpdatedDeadline.data.assigned_to,
      requirement: parsedItem.data.requirement,
      dueDate: parsedUpdatedDeadline.data.due_date
    });
  }

  return jsonResponse<UpdateComplianceDeadlineData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
