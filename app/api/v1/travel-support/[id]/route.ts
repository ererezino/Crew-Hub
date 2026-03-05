import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME, sanitizeFileName } from "../../../../../lib/documents";
import { createNotification } from "../../../../../lib/notifications/service";
import { renderTravelSupportLetterPdf } from "../../../../../lib/pdf/travel-support-letter-pdf";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import type {
  TravelSupportRequest,
  TravelSupportUpdateResponseData
} from "../../../../../types/travel-support";

/* ── Helpers ── */

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/* ── Row Schema ── */

const travelSupportRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  destination_country: z.string(),
  embassy_name: z.string(),
  embassy_address: z.string().nullable(),
  travel_start_date: z.string(),
  travel_end_date: z.string(),
  purpose: z.string(),
  additional_notes: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  rejected_by: z.string().uuid().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  document_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const selectColumns = [
  "id",
  "org_id",
  "employee_id",
  "destination_country",
  "embassy_name",
  "embassy_address",
  "travel_start_date",
  "travel_end_date",
  "purpose",
  "additional_notes",
  "status",
  "approved_by",
  "approved_at",
  "rejected_by",
  "rejected_at",
  "rejection_reason",
  "document_path",
  "created_at",
  "updated_at"
].join(", ");

type TravelSupportRow = z.infer<typeof travelSupportRowSchema>;

function toTravelSupportRequest(
  row: TravelSupportRow,
  profileById: Map<string, { full_name: string }>
): TravelSupportRequest {
  const employee = profileById.get(row.employee_id);
  const approver = row.approved_by ? profileById.get(row.approved_by) : null;

  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    employeeName: employee?.full_name ?? null,
    destinationCountry: row.destination_country,
    embassyName: row.embassy_name,
    embassyAddress: row.embassy_address,
    travelStartDate: row.travel_start_date,
    travelEndDate: row.travel_end_date,
    purpose: row.purpose,
    additionalNotes: row.additional_notes,
    status: row.status,
    approvedBy: row.approved_by,
    approverName: approver?.full_name ?? null,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    documentPath: row.document_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/* ── Validation ── */

const paramsSchema = z.object({
  id: z.string().uuid()
});

const patchPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    entityCountry: z.string().trim().min(1, "Entity country is required.").max(200),
    entityAddress: z.string().trim().min(1, "Entity address is required.").max(1000)
  }),
  z.object({
    action: z.literal("reject"),
    rejectionReason: z.string().trim().min(1, "Rejection reason is required.").max(2000)
  })
]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

/* ── GET: Single travel support request ── */

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view this request."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawRow, error: fetchError } = await supabase
    .from("travel_support_requests")
    .select(selectColumns)
    .eq("id", parsedParams.data.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_FETCH_FAILED",
        message: "Unable to load travel support request."
      },
      meta: buildMeta()
    });
  }

  if (!rawRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Travel support request not found."
      },
      meta: buildMeta()
    });
  }

  const parsed = travelSupportRowSchema.safeParse(rawRow);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_PARSE_FAILED",
        message: "Record is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Only the employee or a SUPER_ADMIN can view
  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");
  const isOwner = parsed.data.employee_id === session.profile.id;

  if (!isOwner && !isSuperAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to view this request."
      },
      meta: buildMeta()
    });
  }

  const profileIds = [
    parsed.data.employee_id,
    parsed.data.approved_by
  ].filter((id): id is string => id !== null);

  const profileById = new Map<string, { full_name: string }>();

  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", profileIds);

    if (profiles) {
      for (const p of profiles) {
        profileById.set(p.id, { full_name: p.full_name });
      }
    }
  }

  const travelRequest = toTravelSupportRequest(parsed.data, profileById);

  return jsonResponse<TravelSupportUpdateResponseData>(200, {
    data: { request: travelRequest },
    error: null,
    meta: buildMeta()
  });
}

/* ── PATCH: Approve or reject ── */

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage travel support requests."
      },
      meta: buildMeta()
    });
  }

  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");

  if (!isSuperAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only co-founders can approve or reject travel support requests."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request id must be a valid UUID."
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

  const parsed = patchPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid request payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Fetch existing record
  const { data: existing, error: fetchError } = await supabase
    .from("travel_support_requests")
    .select(selectColumns)
    .eq("id", parsedParams.data.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_FETCH_FAILED",
        message: "Unable to load travel support request."
      },
      meta: buildMeta()
    });
  }

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Travel support request not found."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = travelSupportRowSchema.safeParse(existing);

  if (!parsedExisting.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_PARSE_FAILED",
        message: "Existing record is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedExisting.data.status !== "pending") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: `This request has already been ${parsedExisting.data.status}. Only pending requests can be updated.`
      },
      meta: buildMeta()
    });
  }

  const now = new Date().toISOString();

  if (parsed.data.action === "reject") {
    // Reject
    const { data: updated, error: updateError } = await supabase
      .from("travel_support_requests")
      .update({
        status: "rejected",
        rejected_by: session.profile.id,
        rejected_at: now,
        rejection_reason: parsed.data.rejectionReason,
        updated_at: now
      })
      .eq("id", parsedExisting.data.id)
      .eq("org_id", session.profile.org_id)
      .select(selectColumns)
      .single();

    if (updateError || !updated) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "TRAVEL_SUPPORT_UPDATE_FAILED",
          message: "Unable to reject travel support request."
        },
        meta: buildMeta()
      });
    }

    const parsedUpdated = travelSupportRowSchema.safeParse(updated);

    if (!parsedUpdated.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "TRAVEL_SUPPORT_PARSE_FAILED",
          message: "Updated record is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const profileById = new Map<string, { full_name: string }>();
    profileById.set(session.profile.id, { full_name: session.profile.full_name });

    const travelRequest = toTravelSupportRequest(parsedUpdated.data, profileById);

    await createNotification({
      orgId: session.profile.org_id,
      userId: parsedExisting.data.employee_id,
      type: "travel_letter_rejected",
      title: "Travel support request rejected",
      body: `Your travel support letter request for ${parsedExisting.data.destination_country} was rejected. Reason: ${parsed.data.rejectionReason}`,
      link: "/me/documents"
    });

    return jsonResponse<TravelSupportUpdateResponseData>(200, {
      data: { request: travelRequest },
      error: null,
      meta: buildMeta()
    });
  }

  // Approve — upsert entity address for reuse, then generate PDF
  const entityAddress = parsed.data.entityAddress;
  const entityCountry = parsed.data.entityCountry;

  // Save entity address for reuse
  await supabase
    .from("org_letterhead_entities")
    .upsert(
      {
        org_id: session.profile.org_id,
        country: entityCountry,
        address: entityAddress,
        updated_at: now
      },
      { onConflict: "org_id,country" }
    );

  // Fetch employee profile for PDF content
  const { data: employeeProfile } = await supabase
    .from("profiles")
    .select("id, full_name, department, title, start_date, country_code")
    .eq("id", parsedExisting.data.employee_id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  // Fetch approver profile for title
  const { data: approverProfile } = await supabase
    .from("profiles")
    .select("title")
    .eq("id", session.profile.id)
    .maybeSingle();

  const employeeName = employeeProfile?.full_name ?? "Employee";
  const jobTitle = employeeProfile?.title ?? null;
  const department = employeeProfile?.department ?? null;
  const startDate = employeeProfile?.start_date ?? null;

  const issueDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  let pdfBytes: Uint8Array;

  try {
    pdfBytes = await renderTravelSupportLetterPdf({
      employeeName,
      jobTitle,
      department,
      startDate,
      destinationCountry: parsedExisting.data.destination_country,
      embassyName: parsedExisting.data.embassy_name,
      embassyAddress: parsedExisting.data.embassy_address,
      travelStartDate: parsedExisting.data.travel_start_date,
      travelEndDate: parsedExisting.data.travel_end_date,
      purpose: parsedExisting.data.purpose,
      approverName: session.profile.full_name,
      approverTitle: approverProfile?.title ?? null,
      issueDate,
      entityAddress
    });
  } catch (error) {
    console.error("Travel support letter PDF generation failed.", {
      requestId: parsedExisting.data.id,
      error: error instanceof Error ? error.message : String(error)
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PDF_GENERATION_FAILED",
        message: "Unable to generate travel support letter PDF."
      },
      meta: buildMeta()
    });
  }

  // Upload PDF to storage
  const storageClient = createSupabaseServiceRoleClient();
  const safeName = sanitizeFileName(employeeName).replace(/_+/g, "-");
  const filePath = `${session.profile.org_id}/travel-support/${parsedExisting.data.employee_id}/${parsedExisting.data.id}-${safeName}.pdf`;

  const { error: uploadError } = await storageClient.storage
    .from(DOCUMENT_BUCKET_NAME)
    .upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadError) {
    console.error("Travel support letter upload failed.", {
      requestId: parsedExisting.data.id,
      message: uploadError.message
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PDF_UPLOAD_FAILED",
        message: "Unable to store travel support letter."
      },
      meta: buildMeta()
    });
  }

  // Update record with approval and document path
  const { data: updated, error: updateError } = await supabase
    .from("travel_support_requests")
    .update({
      status: "approved",
      approved_by: session.profile.id,
      approved_at: now,
      document_path: filePath,
      updated_at: now
    })
    .eq("id", parsedExisting.data.id)
    .eq("org_id", session.profile.org_id)
    .select(selectColumns)
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_UPDATE_FAILED",
        message: "Unable to approve travel support request."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdated = travelSupportRowSchema.safeParse(updated);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_PARSE_FAILED",
        message: "Updated record is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map<string, { full_name: string }>();
  profileById.set(session.profile.id, { full_name: session.profile.full_name });

  if (employeeProfile) {
    profileById.set(employeeProfile.id, { full_name: employeeProfile.full_name });
  }

  const travelRequest = toTravelSupportRequest(parsedUpdated.data, profileById);

  await createNotification({
    orgId: session.profile.org_id,
    userId: parsedExisting.data.employee_id,
    type: "travel_letter_approved",
    title: "Travel support letter approved",
    body: `Your travel support letter for ${parsedExisting.data.destination_country} has been approved and is ready for download.`,
    link: "/me/documents"
  });

  return jsonResponse<TravelSupportUpdateResponseData>(200, {
    data: { request: travelRequest },
    error: null,
    meta: buildMeta()
  });
}
