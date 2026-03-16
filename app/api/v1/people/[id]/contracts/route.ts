import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import {
  CONTRACT_DOCUMENTS_BUCKET,
  MAX_CONTRACT_FILE_BYTES,
  ALLOWED_CONTRACT_EXTENSIONS,
  isAllowedContractUpload,
  sanitizeFileName
} from "../../../../../../lib/contracts";
import {
  buildMeta,
  jsonResponse
} from "../../../../../../lib/people/shared";
import { hasRole } from "../../../../../../lib/roles";
import { validateUploadMagicBytes } from "../../../../../../lib/security/upload-signatures";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ContractStatus, PreStartContract } from "../../../../../../types/people";

// ── Schemas ─────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  id: z.string().uuid("Person id must be a valid UUID.")
});

const createContractSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer.").nullable().optional()
});

const updateContractSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long.").optional(),
  notes: z.string().trim().max(1000, "Notes must be 1000 characters or fewer.").nullable().optional(),
  sentAt: z.string().datetime("Sent date must be a valid ISO timestamp.").nullable().optional(),
  signedAt: z.string().datetime("Signed date must be a valid ISO timestamp.").nullable().optional(),
  voidedAt: z.string().datetime("Voided date must be a valid ISO timestamp.").nullable().optional()
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function deriveContractStatus(row: {
  sent_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
}): ContractStatus {
  if (row.voided_at) return "voided";
  if (row.signed_at) return "signed";
  if (row.sent_at) return "sent";
  return "draft";
}

function mapContractRow(
  row: Record<string, unknown>,
  signatureRequestStatus?: string | null
): PreStartContract {
  const sentAt = (row.sent_at as string) ?? null;
  const signedAt = (row.signed_at as string) ?? null;
  const voidedAt = (row.voided_at as string) ?? null;

  return {
    id: row.id as string,
    personId: row.person_id as string,
    title: row.title as string,
    notes: (row.notes as string) ?? null,
    status: deriveContractStatus({ sent_at: sentAt, signed_at: signedAt, voided_at: voidedAt }),
    storagePath: (row.storage_path as string) ?? null,
    fileName: (row.file_name as string) ?? null,
    signatureRequestId: (row.signature_request_id as string) ?? null,
    signatureRequestStatus: signatureRequestStatus ?? null,
    sentAt,
    signedAt,
    voidedAt,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

/**
 * Parse the request body. Supports both multipart form data (when a file
 * may be attached) and plain JSON (backward-compatible for callers that
 * do not upload files).
 */
async function parseRequestBody(
  request: Request
): Promise<{ fields: Record<string, string>; file: File | null } | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return null;
    }

    const fields: Record<string, string> = {};
    let file: File | null = null;

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        file = value;
      } else {
        fields[key] = value;
      }
    }

    return { fields, file };
  }

  // Fall back to JSON body (backward-compatible)
  try {
    const json = await request.json();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (value === null) {
          fields[key] = "__null__";
        } else if (value !== undefined) {
          fields[key] = String(value);
        }
      }
      return { fields, file: null };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert flat string fields back to a typed object for Zod validation.
 * Handles the __null__ sentinel for explicit nulls from JSON fallback.
 */
function fieldsToObject(fields: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = value === "__null__" ? null : value;
  }
  return result;
}

/**
 * Validate an uploaded file. Returns an error message string if invalid, null if valid.
 */
async function validateContractFile(file: File): Promise<string | null> {
  if (file.size <= 0) {
    return "Uploaded file is empty.";
  }

  if (file.size > MAX_CONTRACT_FILE_BYTES) {
    return `File exceeds the 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
  }

  if (!isAllowedContractUpload(file.name, file.type)) {
    return "Only PDF files are allowed.";
  }

  const magicBytesResult = await validateUploadMagicBytes({
    file,
    fileName: file.name,
    allowedExtensions: ALLOWED_CONTRACT_EXTENSIONS
  });

  if (!magicBytesResult.valid) {
    return magicBytesResult.message ?? "File failed validation.";
  }

  return null;
}

/**
 * Upload a file to the contract-documents bucket. Returns the storage path.
 */
async function uploadContractFile(
  orgId: string,
  personId: string,
  contractId: string,
  file: File
): Promise<{ storagePath: string; error: string | null }> {
  const svc = createSupabaseServiceRoleClient();
  const timestamp = Date.now();
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${orgId}/${personId}/${contractId}/${timestamp}-${safeName}`;

  const { error } = await svc.storage
    .from(CONTRACT_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });

  if (error) {
    return { storagePath: "", error: `Storage upload failed: ${error.message}` };
  }

  return { storagePath, error: null };
}

/**
 * Delete a file from the contract-documents bucket. Logs but does not throw on failure.
 */
async function deleteContractFile(storagePath: string): Promise<void> {
  try {
    const svc = createSupabaseServiceRoleClient();
    const { error } = await svc.storage
      .from(CONTRACT_DOCUMENTS_BUCKET)
      .remove([storagePath]);

    if (error) {
      console.error("Failed to delete old contract document from storage.", {
        storagePath,
        message: error.message
      });
    }
  } catch (err) {
    console.error("Unexpected error deleting contract document.", { storagePath, err });
  }
}

// ── GET /api/v1/people/[id]/contracts ────────────────────────────────────

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN") && !hasRole(session.profile.roles, "HR_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Super Admin or HR Admin can view contracts." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid person id."
      },
      meta: buildMeta()
    });
  }

  const svc = createSupabaseServiceRoleClient();

  const { data: contracts, error } = await svc
    .from("pre_start_contracts")
    .select("*")
    .eq("org_id", session.profile.org_id)
    .eq("person_id", parsedParams.data.id)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to load contracts." },
      meta: buildMeta()
    });
  }

  // Resolve signature request statuses for linked contracts
  const sigReqIds = (contracts ?? [])
    .map((c) => (c as Record<string, unknown>).signature_request_id as string | null)
    .filter((id): id is string => !!id);

  let sigReqStatusById = new Map<string, string>();

  if (sigReqIds.length > 0) {
    const { data: sigReqs } = await svc
      .from("signature_requests")
      .select("id, status")
      .in("id", sigReqIds);

    if (sigReqs) {
      sigReqStatusById = new Map(
        sigReqs.map((r) => [(r as Record<string, unknown>).id as string, (r as Record<string, unknown>).status as string])
      );
    }
  }

  const mapped: PreStartContract[] = (contracts ?? []).map((c) => {
    const row = c as Record<string, unknown>;
    const sigReqId = row.signature_request_id as string | null;
    return mapContractRow(row, sigReqId ? (sigReqStatusById.get(sigReqId) ?? null) : null);
  });

  return jsonResponse<{ contracts: PreStartContract[] }>(200, {
    data: { contracts: mapped },
    error: null,
    meta: buildMeta()
  });
}

// ── POST /api/v1/people/[id]/contracts ───────────────────────────────────

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Super Admin can create contracts." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid person id."
      },
      meta: buildMeta()
    });
  }

  const parsed_body = await parseRequestBody(request);
  if (!parsed_body) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid request body." },
      meta: buildMeta()
    });
  }

  const { fields, file } = parsed_body;
  const parsed = createContractSchema.safeParse(fieldsToObject(fields));

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid contract data."
      },
      meta: buildMeta()
    });
  }

  // Validate the file if one was provided
  if (file) {
    const fileError = await validateContractFile(file);
    if (fileError) {
      return jsonResponse<null>(422, {
        data: null,
        error: { code: "VALIDATION_ERROR", message: fileError },
        meta: buildMeta()
      });
    }
  }

  const svc = createSupabaseServiceRoleClient();
  const orgId = session.profile.org_id;
  const personId = parsedParams.data.id;

  // Verify person exists
  const { data: personRow } = await svc
    .from("profiles")
    .select("id, full_name, status")
    .eq("id", personId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!personRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Person not found." },
      meta: buildMeta()
    });
  }

  // Insert contract row (without document columns first to get the ID)
  const { data: inserted, error: insertError } = await svc
    .from("pre_start_contracts")
    .insert({
      org_id: orgId,
      person_id: personId,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to create contract." },
      meta: buildMeta()
    });
  }

  const contractId = (inserted as Record<string, unknown>).id as string;

  // Upload file if provided
  if (file) {
    const { storagePath, error: uploadError } = await uploadContractFile(
      orgId,
      personId,
      contractId,
      file
    );

    if (uploadError) {
      // Clean up the inserted contract row since file upload failed
      await svc.from("pre_start_contracts").delete().eq("id", contractId);
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "INTERNAL_ERROR", message: uploadError },
        meta: buildMeta()
      });
    }

    // Update the contract row with document info
    const { error: patchError } = await svc
      .from("pre_start_contracts")
      .update({
        storage_path: storagePath,
        file_name: file.name
      })
      .eq("id", contractId);

    if (patchError) {
      // Clean up orphaned file
      await deleteContractFile(storagePath);
      await svc.from("pre_start_contracts").delete().eq("id", contractId);
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Failed to save document reference." },
        meta: buildMeta()
      });
    }

    // Re-fetch the updated row
    const { data: refreshed } = await svc
      .from("pre_start_contracts")
      .select("*")
      .eq("id", contractId)
      .single();

    if (refreshed) {
      const contract = mapContractRow(refreshed as Record<string, unknown>);

      await logAudit({
        action: "created",
        tableName: "pre_start_contracts",
        recordId: contract.id,
        newValue: {
          personId,
          personName: (personRow as Record<string, unknown>).full_name as string,
          title: contract.title,
          status: contract.status,
          fileName: contract.fileName,
          documentAttached: true
        }
      });

      return jsonResponse<{ contract: PreStartContract }>(201, {
        data: { contract },
        error: null,
        meta: buildMeta()
      });
    }
  }

  const contract = mapContractRow(inserted as Record<string, unknown>);

  await logAudit({
    action: "created",
    tableName: "pre_start_contracts",
    recordId: contract.id,
    newValue: {
      personId,
      personName: (personRow as Record<string, unknown>).full_name as string,
      title: contract.title,
      status: contract.status,
      documentAttached: false
    }
  });

  return jsonResponse<{ contract: PreStartContract }>(201, {
    data: { contract },
    error: null,
    meta: buildMeta()
  });
}

// ── PUT /api/v1/people/[id]/contracts ────────────────────────────────────
//
// Updates a specific contract. The contract ID is passed in the body.
// Supports optional PDF document attachment via multipart form data.

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Super Admin can update contracts." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid person id."
      },
      meta: buildMeta()
    });
  }

  const parsed_body = await parseRequestBody(request);
  if (!parsed_body) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid request body." },
      meta: buildMeta()
    });
  }

  const { fields, file } = parsed_body;
  const rawBody = fieldsToObject(fields);

  if (!rawBody.contractId || typeof rawBody.contractId !== "string") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "contractId is required."
      },
      meta: buildMeta()
    });
  }

  const contractId = rawBody.contractId as string;
  const parsed = updateContractSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid contract update data."
      },
      meta: buildMeta()
    });
  }

  // Validate the file if provided
  if (file) {
    const fileError = await validateContractFile(file);
    if (fileError) {
      return jsonResponse<null>(422, {
        data: null,
        error: { code: "VALIDATION_ERROR", message: fileError },
        meta: buildMeta()
      });
    }
  }

  const svc = createSupabaseServiceRoleClient();
  const orgId = session.profile.org_id;
  const personId = parsedParams.data.id;

  // Fetch existing contract
  const { data: existing } = await svc
    .from("pre_start_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("person_id", personId)
    .maybeSingle();

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Contract not found." },
      meta: buildMeta()
    });
  }

  const existingRow = existing as Record<string, unknown>;

  // ── Linked-contract manual mutation guard ─────────────────────────────
  // When a contract is linked to a signature request, signedAt and sentAt
  // are system-managed. Reject manual edits to those fields.
  if (existingRow.signature_request_id) {
    if (parsed.data.signedAt !== undefined) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "LINKED_CONTRACT_IMMUTABLE",
          message: "Cannot manually change signed date on a contract linked to a signature request."
        },
        meta: buildMeta()
      });
    }
    if (parsed.data.sentAt !== undefined) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "LINKED_CONTRACT_IMMUTABLE",
          message: "Cannot manually change sent date on a contract linked to a signature request."
        },
        meta: buildMeta()
      });
    }
  }

  // ── Signed-contract document replacement guard ────────────────────────
  if (file && existingRow.signed_at && !existingRow.voided_at) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "SIGNED_CONTRACT_IMMUTABLE",
        message: "Cannot replace document on a signed contract. Void this contract and create a new one."
      },
      meta: buildMeta()
    });
  }

  // Build metadata update values
  const updateValues: Record<string, unknown> = {};

  if (parsed.data.title !== undefined) {
    updateValues.title = parsed.data.title;
  }
  if (parsed.data.notes !== undefined) {
    updateValues.notes = parsed.data.notes;
  }
  if (parsed.data.sentAt !== undefined) {
    updateValues.sent_at = parsed.data.sentAt;
  }
  if (parsed.data.signedAt !== undefined) {
    updateValues.signed_at = parsed.data.signedAt;
  }
  if (parsed.data.voidedAt !== undefined) {
    updateValues.voided_at = parsed.data.voidedAt;
  }

  // ── Handle file upload (replacement) ──────────────────────────────────
  let newStoragePath: string | null = null;

  if (file) {
    const { storagePath, error: uploadError } = await uploadContractFile(
      orgId,
      personId,
      contractId,
      file
    );

    if (uploadError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "INTERNAL_ERROR", message: uploadError },
        meta: buildMeta()
      });
    }

    newStoragePath = storagePath;

    // Delete the old file (best-effort, does not block the update)
    const oldPath = existingRow.storage_path as string | null;
    if (oldPath) {
      await deleteContractFile(oldPath);
    }

    updateValues.storage_path = storagePath;
    updateValues.file_name = file.name;
  }

  // If no metadata changes and no file, reject
  if (Object.keys(updateValues).length === 0) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "No fields to update." },
      meta: buildMeta()
    });
  }

  const { data: updated, error: updateError } = await svc
    .from("pre_start_contracts")
    .update(updateValues)
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("person_id", personId)
    .select("*")
    .single();

  if (updateError || !updated) {
    // Clean up newly uploaded file if DB update failed
    if (newStoragePath) {
      await deleteContractFile(newStoragePath);
    }
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to update contract." },
      meta: buildMeta()
    });
  }

  const oldContract = mapContractRow(existingRow);
  const newContract = mapContractRow(updated as Record<string, unknown>);

  const auditNewValue: Record<string, unknown> = {
    title: newContract.title,
    status: newContract.status,
    sentAt: newContract.sentAt,
    signedAt: newContract.signedAt,
    voidedAt: newContract.voidedAt
  };

  if (file) {
    auditNewValue.fileName = newContract.fileName;
    auditNewValue.documentReplaced = !!oldContract.storagePath;
    auditNewValue.documentAttached = !oldContract.storagePath;
  }

  await logAudit({
    action: "updated",
    tableName: "pre_start_contracts",
    recordId: contractId,
    oldValue: {
      title: oldContract.title,
      status: oldContract.status,
      sentAt: oldContract.sentAt,
      signedAt: oldContract.signedAt,
      voidedAt: oldContract.voidedAt,
      fileName: oldContract.fileName
    },
    newValue: auditNewValue
  });

  return jsonResponse<{ contract: PreStartContract }>(200, {
    data: { contract: newContract },
    error: null,
    meta: buildMeta()
  });
}
