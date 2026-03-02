import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { logAudit } from "../../../../lib/audit";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import { sendSignatureRequestEmail } from "../../../../lib/notifications/email";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import {
  SIGNATURE_REQUEST_STATUSES,
  SIGNATURE_SIGNER_STATUSES,
  type CreateSignatureRequestResponseData,
  type SignatureRequestRecord,
  type SignaturesResponseData
} from "../../../../types/esignatures";

const querySchema = z.object({
  scope: z.enum(["all", "mine"]).default("mine"),
  status: z.enum(SIGNATURE_REQUEST_STATUSES).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const createPayloadSchema = z.object({
  documentId: z.string().uuid("Document must be a valid id."),
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  message: z
    .string()
    .trim()
    .max(1000, "Message must be 1000 characters or fewer.")
    .optional(),
  signerUserIds: z
    .array(z.string().uuid("Signer must be a valid user id."))
    .min(1, "Select at least one signer.")
    .max(20, "You can request at most 20 signers.")
});

const requestRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  document_id: z.string().uuid(),
  title: z.string(),
  message: z.string().nullable(),
  status: z.enum(SIGNATURE_REQUEST_STATUSES),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable()
});

const signerRowSchema = z.object({
  id: z.string().uuid(),
  signature_request_id: z.string().uuid(),
  signer_user_id: z.string().uuid(),
  signer_order: z.union([z.number(), z.string()]),
  status: z.enum(SIGNATURE_SIGNER_STATUSES),
  viewed_at: z.string().nullable(),
  signed_at: z.string().nullable()
});

const documentRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const signerProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  status: z.enum(["active", "inactive", "onboarding", "offboarding"])
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function isSignatureAdmin(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

function parseInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRequests({
  currentUserId,
  requestRows,
  signerRows,
  profileNameById,
  documentTitleById
}: {
  currentUserId: string;
  requestRows: z.infer<typeof requestRowSchema>[];
  signerRows: z.infer<typeof signerRowSchema>[];
  profileNameById: ReadonlyMap<string, string>;
  documentTitleById: ReadonlyMap<string, string>;
}): SignatureRequestRecord[] {
  const signersByRequestId = new Map<string, z.infer<typeof signerRowSchema>[]>();

  for (const signerRow of signerRows) {
    const currentRows = signersByRequestId.get(signerRow.signature_request_id) ?? [];
    currentRows.push(signerRow);
    signersByRequestId.set(signerRow.signature_request_id, currentRows);
  }

  const mappedRequests: SignatureRequestRecord[] = requestRows.map((requestRow) => {
    const requestSigners = (signersByRequestId.get(requestRow.id) ?? [])
      .sort((leftRow, rightRow) => parseInteger(leftRow.signer_order) - parseInteger(rightRow.signer_order))
      .map((signerRow) => ({
        id: signerRow.id,
        requestId: signerRow.signature_request_id,
        signerUserId: signerRow.signer_user_id,
        signerName: profileNameById.get(signerRow.signer_user_id) ?? "Unknown signer",
        signerOrder: parseInteger(signerRow.signer_order),
        status: signerRow.status,
        viewedAt: signerRow.viewed_at,
        signedAt: signerRow.signed_at
      }));

    const currentUserSigner = requestSigners.find(
      (signer) => signer.signerUserId === currentUserId
    );

    return {
      id: requestRow.id,
      orgId: requestRow.org_id,
      documentId: requestRow.document_id,
      documentTitle: documentTitleById.get(requestRow.document_id) ?? "Document",
      title: requestRow.title,
      message: requestRow.message,
      status: requestRow.status,
      createdBy: requestRow.created_by,
      createdByName: profileNameById.get(requestRow.created_by) ?? "Unknown user",
      createdAt: requestRow.created_at,
      updatedAt: requestRow.updated_at,
      completedAt: requestRow.completed_at,
      signers: requestSigners,
      pendingSignerCount: requestSigners.filter((signer) => signer.status !== "signed").length,
      isCurrentUserSigner: Boolean(currentUserSigner),
      currentUserSignerStatus: currentUserSigner?.status ?? null
    };
  });

  return mappedRequests;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view signatures."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid signatures query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const profile = session.profile;
  const supabase = await createSupabaseServerClient();
  const canViewAll = isSignatureAdmin(profile.roles);
  const scope = query.scope === "all" && canViewAll ? "all" : "mine";

  let requestQuery = supabase
    .from("signature_requests")
    .select(
      "id, org_id, document_id, title, message, status, created_by, created_at, updated_at, completed_at"
    )
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .limit(query.limit)
    .order("created_at", { ascending: query.sortDir === "asc" });

  if (query.status) {
    requestQuery = requestQuery.eq("status", query.status);
  }

  const { data: rawRequestRows, error: requestError } = await requestQuery;

  if (requestError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_REQUESTS_FETCH_FAILED",
        message: "Unable to load signature requests."
      },
      meta: buildMeta()
    });
  }

  const parsedRequestRows = z.array(requestRowSchema).safeParse(rawRequestRows ?? []);

  if (!parsedRequestRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_REQUESTS_PARSE_FAILED",
        message: "Signature request data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const requestRows = parsedRequestRows.data;
  const requestIds = requestRows.map((row) => row.id);

  if (requestIds.length === 0) {
    return jsonResponse<SignaturesResponseData>(200, {
      data: {
        requests: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const [signerResult, profileResult, documentResult] = await Promise.all([
    supabase
      .from("signature_signers")
      .select("id, signature_request_id, signer_user_id, signer_order, status, viewed_at, signed_at")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("signature_request_id", requestIds),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in(
        "id",
        [...new Set(requestRows.flatMap((row) => [row.created_by]))]
      ),
    supabase
      .from("documents")
      .select("id, title")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", [...new Set(requestRows.map((row) => row.document_id))])
  ]);

  if (signerResult.error || profileResult.error || documentResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_METADATA_FETCH_FAILED",
        message: "Unable to resolve signature request metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedSignerRows = z.array(signerRowSchema).safeParse(signerResult.data ?? []);
  const parsedProfileRows = z.array(profileRowSchema).safeParse(profileResult.data ?? []);
  const parsedDocumentRows = z.array(documentRowSchema).safeParse(documentResult.data ?? []);

  if (!parsedSignerRows.success || !parsedProfileRows.success || !parsedDocumentRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_METADATA_PARSE_FAILED",
        message: "Signature metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const signerUserIds = [
    ...new Set(parsedSignerRows.data.map((row) => row.signer_user_id))
  ];
  let profileNameById = new Map(parsedProfileRows.data.map((row) => [row.id, row.full_name]));

  if (signerUserIds.length > 0) {
    const { data: signerProfiles, error: signerProfilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", signerUserIds);

    if (signerProfilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SIGNERS_FETCH_FAILED",
          message: "Unable to resolve signer names."
        },
        meta: buildMeta()
      });
    }

    const parsedSignerProfiles = z.array(profileRowSchema).safeParse(signerProfiles ?? []);

    if (!parsedSignerProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SIGNERS_PARSE_FAILED",
          message: "Signer metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const nextProfileMap = new Map(profileNameById);

    for (const row of parsedSignerProfiles.data) {
      nextProfileMap.set(row.id, row.full_name);
    }

    profileNameById = nextProfileMap;
  }

  const documentTitleById = new Map(parsedDocumentRows.data.map((row) => [row.id, row.title]));

  const mappedRequests = mapRequests({
    currentUserId: session.profile.id,
    requestRows,
    signerRows: parsedSignerRows.data,
    profileNameById,
    documentTitleById
  });

  const visibleRequests =
    scope === "all"
      ? mappedRequests
      : mappedRequests.filter(
          (requestRow) =>
            requestRow.createdBy === profile.id || requestRow.isCurrentUserSigner
        );

  return jsonResponse<SignaturesResponseData>(200, {
    data: {
      requests: visibleRequests
    },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create signature requests."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!isSignatureAdmin(profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can create signature requests."
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

  const parsedBody = createPayloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid signature request payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const signerUserIds = [...new Set(payload.signerUserIds)];

  if (signerUserIds.length !== payload.signerUserIds.length) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Duplicate signers are not allowed."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select("id, title")
    .eq("id", payload.documentId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENT_FETCH_FAILED",
        message: "Unable to validate selected document."
      },
      meta: buildMeta()
    });
  }

  const parsedDocumentRow = documentRowSchema.safeParse(documentRow);

  if (!parsedDocumentRow.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Selected document is unavailable."
      },
      meta: buildMeta()
    });
  }

  const { data: signerRows, error: signerError } = await supabase
    .from("profiles")
    .select("id, full_name, status")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .in("id", signerUserIds);

  if (signerError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNERS_FETCH_FAILED",
        message: "Unable to validate signers."
      },
      meta: buildMeta()
    });
  }

  const parsedSignerRows = z.array(signerProfileRowSchema).safeParse(signerRows ?? []);

  if (!parsedSignerRows.success || parsedSignerRows.data.length !== signerUserIds.length) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more selected signers are invalid."
      },
      meta: buildMeta()
    });
  }

  const inactiveSigner = parsedSignerRows.data.find(
    (signerRow) => signerRow.status === "inactive" || signerRow.status === "offboarding"
  );

  if (inactiveSigner) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Inactive or offboarding team members cannot be assigned as signers."
      },
      meta: buildMeta()
    });
  }

  const { data: insertedRequest, error: insertRequestError } = await supabase
    .from("signature_requests")
    .insert({
      org_id: profile.org_id,
      document_id: parsedDocumentRow.data.id,
      title: payload.title,
      message: payload.message?.trim() || null,
      status: "pending",
      created_by: profile.id,
      sent_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (insertRequestError || !insertedRequest?.id) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNATURE_REQUEST_CREATE_FAILED",
        message: "Unable to create signature request."
      },
      meta: buildMeta()
    });
  }

  const signerPayload = signerUserIds.map((signerUserId, index) => ({
    org_id: profile.org_id,
    signature_request_id: insertedRequest.id,
    signer_user_id: signerUserId,
    signer_order: index + 1,
    status: "pending"
  }));

  const { error: insertSignerError } = await supabase
    .from("signature_signers")
    .insert(signerPayload);

  if (insertSignerError) {
    await supabase
      .from("signature_requests")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", insertedRequest.id)
      .eq("org_id", profile.org_id);

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNERS_CREATE_FAILED",
        message: "Unable to create signature signer rows."
      },
      meta: buildMeta()
    });
  }

  await supabase.from("signature_events").insert({
    org_id: session.profile.org_id,
    signature_request_id: insertedRequest.id,
    actor_user_id: profile.id,
    event_type: "created",
    event_payload: {
      signerCount: signerUserIds.length
    }
  });

  await logAudit({
    action: "submitted",
    tableName: "signature_requests",
    recordId: insertedRequest.id,
    newValue: {
      documentId: parsedDocumentRow.data.id,
      title: payload.title,
      signerUserIds
    }
  });

  await createBulkNotifications({
    orgId: session.profile.org_id,
    userIds: signerUserIds,
    type: "signature_requested",
    title: "Signature request received",
    body: `${profile.full_name} requested your signature on "${payload.title}".`,
    link: "/signatures"
  });

  await Promise.all(
    signerUserIds.map((userId) =>
      sendSignatureRequestEmail({
        orgId: profile.org_id,
        userId,
        requestTitle: payload.title,
        requestedByName: profile.full_name
      })
    )
  );

  return jsonResponse<CreateSignatureRequestResponseData>(201, {
    data: {
      requestId: insertedRequest.id
    },
    error: null,
    meta: buildMeta()
  });
}
