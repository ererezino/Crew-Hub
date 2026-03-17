import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME, sanitizeFileName } from "../../../../../lib/documents";
import { createBulkNotifications, createNotification } from "../../../../../lib/notifications/service";
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
  destination_countries: z.array(z.string()).default([]),
  embassy_name: z.string(),
  embassy_address: z.string().nullable(),
  travel_start_date: z.string(),
  travel_end_date: z.string(),
  purpose: z.string(),
  additional_notes: z.string().nullable(),
  status: z.enum(["pending", "hr_draft", "pending_signature", "approved", "rejected"]),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  rejected_by: z.string().uuid().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  hr_drafted_by: z.string().uuid().nullable(),
  hr_drafted_at: z.string().nullable(),
  letter_body: z.string().nullable(),
  document_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const selectColumns = [
  "id",
  "org_id",
  "employee_id",
  "destination_country",
  "destination_countries",
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
  "hr_drafted_by",
  "hr_drafted_at",
  "letter_body",
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
    destinationCountries: row.destination_countries.length > 0
      ? row.destination_countries
      : [row.destination_country],
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
    hrDraftedBy: row.hr_drafted_by,
    hrDraftedAt: row.hr_drafted_at,
    letterBody: row.letter_body,
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
    action: z.literal("hr_draft"),
    letterBody: z.string().trim().min(1, "Letter body is required.").max(10000)
  }),
  z.object({
    action: z.literal("submit_for_signature")
  }),
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

/* ── Shared: fetch and parse existing record ── */

async function fetchExistingRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestId: string,
  orgId: string
) {
  const { data: existing, error: fetchError } = await supabase
    .from("travel_support_requests")
    .select(selectColumns)
    .eq("id", requestId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return { record: null, error: "FETCH_FAILED" as const };
  }

  if (!existing) {
    return { record: null, error: "NOT_FOUND" as const };
  }

  const parsed = travelSupportRowSchema.safeParse(existing);

  if (!parsed.success) {
    return { record: null, error: "PARSE_FAILED" as const };
  }

  return { record: parsed.data, error: null };
}

/* ── Shared: resolve profiles ── */

async function resolveProfiles(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orgId: string,
  ids: (string | null)[]
) {
  const profileIds = ids.filter((id): id is string => id !== null);
  const profileById = new Map<string, { full_name: string }>();

  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", [...new Set(profileIds)]);

    if (profiles) {
      for (const p of profiles) {
        profileById.set(p.id, { full_name: p.full_name });
      }
    }
  }

  return profileById;
}

/* ── Shared: update, parse, and return ── */

async function updateAndRespond(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  recordId: string,
  orgId: string,
  updatePayload: Record<string, unknown>,
  extraProfileIds: (string | null)[]
) {
  const { data: updated, error: updateError } = await supabase
    .from("travel_support_requests")
    .update(updatePayload)
    .eq("id", recordId)
    .eq("org_id", orgId)
    .select(selectColumns)
    .single();

  if (updateError || !updated) {
    return { request: null, error: "UPDATE_FAILED" as const };
  }

  const parsedUpdated = travelSupportRowSchema.safeParse(updated);

  if (!parsedUpdated.success) {
    return { request: null, error: "PARSE_FAILED" as const };
  }

  const profileById = await resolveProfiles(
    supabase,
    orgId,
    [parsedUpdated.data.employee_id, parsedUpdated.data.approved_by, ...extraProfileIds]
  );

  return {
    request: toTravelSupportRequest(parsedUpdated.data, profileById),
    error: null
  };
}

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

  const { record, error: fetchErr } = await fetchExistingRecord(
    supabase,
    parsedParams.data.id,
    session.profile.org_id
  );

  if (fetchErr === "FETCH_FAILED") {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "TRAVEL_SUPPORT_FETCH_FAILED", message: "Unable to load travel support request." },
      meta: buildMeta()
    });
  }

  if (fetchErr === "NOT_FOUND" || !record) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Travel support request not found." },
      meta: buildMeta()
    });
  }

  if (fetchErr === "PARSE_FAILED") {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "TRAVEL_SUPPORT_PARSE_FAILED", message: "Record is not in the expected shape." },
      meta: buildMeta()
    });
  }

  // Only the employee, HR_ADMIN, or SUPER_ADMIN can view
  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");
  const isHrAdmin = session.profile.roles.includes("HR_ADMIN");
  const isOwner = record.employee_id === session.profile.id;

  if (!isOwner && !isSuperAdmin && !isHrAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You do not have permission to view this request." },
      meta: buildMeta()
    });
  }

  const profileById = await resolveProfiles(
    supabase,
    session.profile.org_id,
    [record.employee_id, record.approved_by]
  );

  const travelRequest = toTravelSupportRequest(record, profileById);

  return jsonResponse<TravelSupportUpdateResponseData>(200, {
    data: { request: travelRequest },
    error: null,
    meta: buildMeta()
  });
}

/* ── PATCH: Workflow actions ── */

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
  const isHrAdmin = session.profile.roles.includes("HR_ADMIN");
  const isAdmin = isSuperAdmin || isHrAdmin;

  if (!isAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR admins and co-founders can manage travel support requests."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request id must be a valid UUID." },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
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

  const { record: existingRecord, error: fetchErr } = await fetchExistingRecord(
    supabase,
    parsedParams.data.id,
    session.profile.org_id
  );

  if (fetchErr === "FETCH_FAILED") {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "TRAVEL_SUPPORT_FETCH_FAILED", message: "Unable to load travel support request." },
      meta: buildMeta()
    });
  }

  if (fetchErr === "NOT_FOUND" || !existingRecord) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Travel support request not found." },
      meta: buildMeta()
    });
  }

  if (fetchErr === "PARSE_FAILED") {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "TRAVEL_SUPPORT_PARSE_FAILED", message: "Existing record is not in the expected shape." },
      meta: buildMeta()
    });
  }

  const now = new Date().toISOString();
  const countriesLabel = existingRecord.destination_countries.length > 0
    ? existingRecord.destination_countries.join(", ")
    : existingRecord.destination_country;

  /* ── Action: reject (HR_ADMIN or SUPER_ADMIN, from pending/hr_draft/pending_signature) ── */

  if (parsed.data.action === "reject") {
    if (!["pending", "hr_draft", "pending_signature"].includes(existingRecord.status)) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: `This request has already been ${existingRecord.status}. It cannot be rejected.`
        },
        meta: buildMeta()
      });
    }

    const result = await updateAndRespond(
      supabase,
      existingRecord.id,
      session.profile.org_id,
      {
        status: "rejected",
        rejected_by: session.profile.id,
        rejected_at: now,
        rejection_reason: parsed.data.rejectionReason,
        updated_at: now
      },
      [session.profile.id]
    );

    if (result.error || !result.request) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "TRAVEL_SUPPORT_UPDATE_FAILED", message: "Unable to reject travel support request." },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "rejected",
      tableName: "travel_support_requests",
      recordId: existingRecord.id,
      oldValue: { status: existingRecord.status },
      newValue: { status: "rejected", rejection_reason: parsed.data.rejectionReason }
    });

    await createNotification({
      orgId: session.profile.org_id,
      userId: existingRecord.employee_id,
      type: "travel_letter_rejected",
      title: "Travel support request rejected",
      body: `Your travel support letter request for ${countriesLabel} was rejected. Reason: ${parsed.data.rejectionReason}`,
      link: "/me/documents"
    });

    return jsonResponse<TravelSupportUpdateResponseData>(200, {
      data: { request: result.request },
      error: null,
      meta: buildMeta()
    });
  }

  /* ── Action: hr_draft (HR_ADMIN saves letter body) ── */

  if (parsed.data.action === "hr_draft") {
    if (!isHrAdmin && !isSuperAdmin) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "Only HR admins can draft travel support letters." },
        meta: buildMeta()
      });
    }

    if (!["pending", "hr_draft"].includes(existingRecord.status)) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: `This request is in "${existingRecord.status}" status and cannot be drafted.`
        },
        meta: buildMeta()
      });
    }

    const result = await updateAndRespond(
      supabase,
      existingRecord.id,
      session.profile.org_id,
      {
        status: "hr_draft",
        letter_body: parsed.data.letterBody,
        hr_drafted_by: session.profile.id,
        hr_drafted_at: now,
        updated_at: now
      },
      [session.profile.id]
    );

    if (result.error || !result.request) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "TRAVEL_SUPPORT_UPDATE_FAILED", message: "Unable to save letter draft." },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "updated",
      tableName: "travel_support_requests",
      recordId: existingRecord.id,
      oldValue: { status: existingRecord.status },
      newValue: { status: "hr_draft", hr_drafted_by: session.profile.id }
    });

    return jsonResponse<TravelSupportUpdateResponseData>(200, {
      data: { request: result.request },
      error: null,
      meta: buildMeta()
    });
  }

  /* ── Action: submit_for_signature (HR_ADMIN sends to SUPER_ADMIN) ── */

  if (parsed.data.action === "submit_for_signature") {
    if (!isHrAdmin && !isSuperAdmin) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "Only HR admins can submit letters for signature." },
        meta: buildMeta()
      });
    }

    if (existingRecord.status !== "hr_draft") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "The letter must be drafted before it can be submitted for signature."
        },
        meta: buildMeta()
      });
    }

    if (!existingRecord.letter_body || existingRecord.letter_body.trim().length === 0) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "The letter body must be written before submitting for signature."
        },
        meta: buildMeta()
      });
    }

    const result = await updateAndRespond(
      supabase,
      existingRecord.id,
      session.profile.org_id,
      {
        status: "pending_signature",
        updated_at: now
      },
      [session.profile.id]
    );

    if (result.error || !result.request) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "TRAVEL_SUPPORT_UPDATE_FAILED", message: "Unable to submit for signature." },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "submitted",
      tableName: "travel_support_requests",
      recordId: existingRecord.id,
      oldValue: { status: "hr_draft" },
      newValue: { status: "pending_signature" }
    });

    // Notify SUPER_ADMIN users
    const serviceClient = createSupabaseServiceRoleClient();
    const { data: superAdminProfiles } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .contains("roles", ["SUPER_ADMIN"]);

    if (superAdminProfiles && superAdminProfiles.length > 0) {
      const superAdminIds = superAdminProfiles
        .map((p: { id: string }) => p.id)
        .filter((id: string) => id !== session.profile!.id);

      if (superAdminIds.length > 0) {
        await createBulkNotifications({
          orgId: session.profile.org_id,
          userIds: superAdminIds,
          type: "travel_letter_submitted",
          title: "Travel letter ready for signature",
          body: `A travel support letter for ${countriesLabel} is ready for your review and signature.`,
          link: "/me/documents"
        });
      }
    }

    return jsonResponse<TravelSupportUpdateResponseData>(200, {
      data: { request: result.request },
      error: null,
      meta: buildMeta()
    });
  }

  /* ── Action: approve (SUPER_ADMIN signs and generates PDF) ── */

  if (!isSuperAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only co-founders can approve travel support requests." },
      meta: buildMeta()
    });
  }

  if (!["pending", "pending_signature"].includes(existingRecord.status)) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: `This request is in "${existingRecord.status}" status and cannot be approved.`
      },
      meta: buildMeta()
    });
  }

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
    .eq("id", existingRecord.employee_id)
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

  // Resolve destination countries for PDF
  const destinationCountries = existingRecord.destination_countries.length > 0
    ? existingRecord.destination_countries
    : [existingRecord.destination_country];

  let pdfBytes: Uint8Array;

  try {
    pdfBytes = await renderTravelSupportLetterPdf({
      employeeName,
      jobTitle,
      department,
      startDate,
      destinationCountry: existingRecord.destination_country,
      destinationCountries,
      embassyName: existingRecord.embassy_name,
      embassyAddress: existingRecord.embassy_address,
      travelStartDate: existingRecord.travel_start_date,
      travelEndDate: existingRecord.travel_end_date,
      purpose: existingRecord.purpose,
      letterBody: existingRecord.letter_body,
      approverName: session.profile.full_name,
      approverTitle: approverProfile?.title ?? null,
      issueDate,
      entityAddress
    });
  } catch (error) {
    console.error("Travel support letter PDF generation failed.", {
      requestId: existingRecord.id,
      error: error instanceof Error ? error.message : String(error)
    });

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PDF_GENERATION_FAILED", message: "Unable to generate travel support letter PDF." },
      meta: buildMeta()
    });
  }

  // Upload PDF to storage
  const storageClient = createSupabaseServiceRoleClient();
  const safeName = sanitizeFileName(employeeName).replace(/_+/g, "-");
  const filePath = `${session.profile.org_id}/travel-support/${existingRecord.employee_id}/${existingRecord.id}-${safeName}.pdf`;

  const { error: uploadError } = await storageClient.storage
    .from(DOCUMENT_BUCKET_NAME)
    .upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadError) {
    console.error("Travel support letter upload failed.", {
      requestId: existingRecord.id,
      message: uploadError.message
    });

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PDF_UPLOAD_FAILED", message: "Unable to store travel support letter." },
      meta: buildMeta()
    });
  }

  const result = await updateAndRespond(
    supabase,
    existingRecord.id,
    session.profile.org_id,
    {
      status: "approved",
      approved_by: session.profile.id,
      approved_at: now,
      document_path: filePath,
      updated_at: now
    },
    [session.profile.id]
  );

  if (result.error || !result.request) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "TRAVEL_SUPPORT_UPDATE_FAILED", message: "Unable to approve travel support request." },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "approved",
    tableName: "travel_support_requests",
    recordId: existingRecord.id,
    oldValue: { status: existingRecord.status },
    newValue: { status: "approved", approved_by: session.profile.id }
  });

  await createNotification({
    orgId: session.profile.org_id,
    userId: existingRecord.employee_id,
    type: "travel_letter_approved",
    title: "Travel support letter approved",
    body: `Your travel support letter for ${countriesLabel} has been approved and is ready for download.`,
    link: "/me/documents"
  });

  return jsonResponse<TravelSupportUpdateResponseData>(200, {
    data: { request: result.request },
    error: null,
    meta: buildMeta()
  });
}
