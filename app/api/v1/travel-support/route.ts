import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import type {
  TravelSupportRequest,
  TravelSupportListResponseData,
  TravelSupportCreateResponseData
} from "../../../../types/travel-support";

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

const createPayloadSchema = z.object({
  destinationCountry: z.string().trim().min(1, "Destination country is required.").max(200),
  embassyName: z.string().trim().min(1, "Embassy/organization name is required.").max(500),
  embassyAddress: z.string().trim().max(1000).optional(),
  travelStartDate: z.iso.date(),
  travelEndDate: z.iso.date(),
  purpose: z.string().trim().min(1, "Purpose of travel is required.").max(2000),
  additionalNotes: z.string().trim().max(2000).optional()
});

/* ── GET: List travel support requests ── */

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view travel support requests."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  let query = supabase
    .from("travel_support_requests")
    .select(selectColumns)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!isSuperAdmin) {
    query = query.eq("employee_id", session.profile.id);
  }

  if (statusFilter && ["pending", "approved", "rejected"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }

  const { data: rawRows, error: fetchError } = await query;

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_FETCH_FAILED",
        message: "Unable to load travel support requests."
      },
      meta: buildMeta()
    });
  }

  const parsed = z.array(travelSupportRowSchema).safeParse(rawRows ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_PARSE_FAILED",
        message: "Travel support records are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Resolve profile names
  const profileIds = [
    ...new Set(
      parsed.data.flatMap((row) =>
        [row.employee_id, row.approved_by].filter((id): id is string => id !== null)
      )
    )
  ];

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

  const requests = parsed.data.map((row) => toTravelSupportRequest(row, profileById));

  return jsonResponse<TravelSupportListResponseData>(200, {
    data: { requests },
    error: null,
    meta: buildMeta()
  });
}

/* ── POST: Create travel support request ── */

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to request a travel support letter."
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

  const parsed = createPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid travel support request."
      },
      meta: buildMeta()
    });
  }

  if (parsed.data.travelEndDate < parsed.data.travelStartDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Travel end date must be on or after the start date."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const insertPayload = {
    id: crypto.randomUUID(),
    org_id: session.profile.org_id,
    employee_id: session.profile.id,
    destination_country: parsed.data.destinationCountry.trim(),
    embassy_name: parsed.data.embassyName.trim(),
    embassy_address: parsed.data.embassyAddress?.trim() || null,
    travel_start_date: parsed.data.travelStartDate,
    travel_end_date: parsed.data.travelEndDate,
    purpose: parsed.data.purpose.trim(),
    additional_notes: parsed.data.additionalNotes?.trim() || null,
    status: "pending" as const
  };

  const { data: inserted, error: insertError } = await supabase
    .from("travel_support_requests")
    .insert(insertPayload)
    .select(selectColumns)
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_CREATE_FAILED",
        message: "Unable to create travel support request."
      },
      meta: buildMeta()
    });
  }

  const parsedRow = travelSupportRowSchema.safeParse(inserted);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_PARSE_FAILED",
        message: "Created record is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map<string, { full_name: string }>();
  profileById.set(session.profile.id, { full_name: session.profile.full_name });

  const travelRequest = toTravelSupportRequest(parsedRow.data, profileById);

  // Notify SUPER_ADMIN users
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: adminProfiles } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .contains("roles", ["SUPER_ADMIN"]);

  if (adminProfiles && adminProfiles.length > 0) {
    const adminIds = adminProfiles
      .map((p: { id: string }) => p.id)
      .filter((id: string) => id !== session.profile!.id);

    if (adminIds.length > 0) {
      await createBulkNotifications({
        orgId: session.profile.org_id,
        userIds: adminIds,
        type: "travel_letter_submitted",
        title: `Travel support request from ${session.profile.full_name}`,
        body: `${session.profile.full_name} has requested a travel support letter for ${parsed.data.destinationCountry}.`,
        link: "/me/documents"
      });
    }
  }

  return jsonResponse<TravelSupportCreateResponseData>(201, {
    data: { request: travelRequest },
    error: null,
    meta: buildMeta()
  });
}
