import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  DOCUMENT_BUCKET_NAME,
  MAX_DOCUMENT_FILE_BYTES,
  isAllowedDocumentUpload,
  isSelfServiceDocumentCategory,
  normalizeCountryCode,
  sanitizeFileName
} from "../../../../../lib/documents";
import { hasRole } from "../../../../../lib/roles";
import { validateUploadMagicBytes } from "../../../../../lib/security/upload-signatures";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import { DOCUMENT_CATEGORIES, type DocumentRecord } from "../../../../../types/documents";

const payloadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().trim().max(2000, "Description is too long").optional(),
  category: z.enum(DOCUMENT_CATEGORIES),
  expiryDate: z.union([z.literal(""), z.iso.date()]).optional(),
  countryCode: z
    .union([z.literal(""), z.string().trim().min(2).max(2)])
    .optional(),
  ownerUserId: z.union([z.literal(""), z.string().uuid()]).optional(),
  existingDocumentId: z.union([z.literal(""), z.string().uuid()]).optional()
});

const existingDocumentSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable(),
  category: z.enum(DOCUMENT_CATEGORIES),
  created_by: z.string().uuid()
});

const documentRowSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable(),
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string(),
  description: z.string().nullable(),
  file_path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.union([z.number(), z.string()]),
  expiry_date: z.string().nullable(),
  country_code: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const latestVersionSchema = z.object({
  version: z.union([z.number(), z.string()])
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function parseInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function cleanupUploadedFile(filePath: string): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.storage.from(DOCUMENT_BUCKET_NAME).remove([filePath]);
  } catch {
    // Cleanup failures should not mask the main error path.
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to upload documents."
      },
      meta: buildMeta()
    });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request must be multipart form data."
      },
      meta: buildMeta()
    });
  }

  const rawFile = formData.get("file");

  if (!(rawFile instanceof File)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A file is required."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Uploaded file is empty."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size > MAX_DOCUMENT_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "File exceeds the 25MB upload limit."
      },
      meta: buildMeta()
    });
  }

  if (!isAllowedDocumentUpload(rawFile.name, rawFile.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Unsupported file type. Allowed formats: pdf, docx, doc, xlsx, xls, png, jpg."
      },
      meta: buildMeta()
    });
  }

  const magicBytesResult = await validateUploadMagicBytes({
    file: rawFile,
    fileName: rawFile.name,
    allowedExtensions: ALLOWED_DOCUMENT_EXTENSIONS
  });

  if (!magicBytesResult.valid) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "File signature validation failed. Upload a file whose binary format matches the selected extension."
      },
      meta: buildMeta()
    });
  }

  const parsedPayload = payloadSchema.safeParse({
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    category: getFormString(formData, "category"),
    expiryDate: getFormString(formData, "expiryDate"),
    countryCode: getFormString(formData, "countryCode"),
    ownerUserId: getFormString(formData, "ownerUserId"),
    existingDocumentId: getFormString(formData, "existingDocumentId")
  });

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid upload payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data;
  const supabase = await createSupabaseServerClient();
  const isAdmin =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  let category = payload.category;
  let ownerUserId: string | null = payload.ownerUserId || null;
  const existingDocumentId = payload.existingDocumentId || null;
  let existingDocument: z.infer<typeof existingDocumentSchema> | null = null;

  if (existingDocumentId) {
    const { data: existingDocumentRow, error: existingDocumentError } = await supabase
      .from("documents")
      .select("id, owner_user_id, category, created_by")
      .eq("id", existingDocumentId)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingDocumentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_FETCH_FAILED",
          message: "Unable to load the document before uploading a new version."
        },
        meta: buildMeta()
      });
    }

    const parsedExistingDocument = existingDocumentSchema.safeParse(existingDocumentRow);

    if (!parsedExistingDocument.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Document not found."
        },
        meta: buildMeta()
      });
    }

    existingDocument = parsedExistingDocument.data;

    if (!isAdmin && existingDocument.owner_user_id !== session.profile.id) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You can only upload versions for your own documents."
        },
        meta: buildMeta()
      });
    }

    if (!isAdmin && !isSelfServiceDocumentCategory(existingDocument.category)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to upload versions for this document category."
        },
        meta: buildMeta()
      });
    }

    category = existingDocument.category;
    ownerUserId = existingDocument.owner_user_id;
  } else if (!isAdmin) {
    ownerUserId = session.profile.id;

    if (!isSelfServiceDocumentCategory(category)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You may only upload ID documents and tax forms."
        },
        meta: buildMeta()
      });
    }
  }

  if (category === "policy") {
    ownerUserId = null;
  } else if (!ownerUserId) {
    ownerUserId = session.profile.id;
  }

  const countryCode = normalizeCountryCode(payload.countryCode || null);
  const expiryDate = payload.expiryDate ? payload.expiryDate : null;
  const normalizedDescription = payload.description ? payload.description.trim() : null;
  const documentId = existingDocument?.id ?? crypto.randomUUID();

  let nextVersion = 1;

  if (existingDocument) {
    const { data: latestVersionRow, error: latestVersionError } = await supabase
      .from("document_versions")
      .select("version")
      .eq("document_id", existingDocument.id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVersionError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "VERSION_FETCH_FAILED",
          message: "Unable to calculate the next document version."
        },
        meta: buildMeta()
      });
    }

    const parsedLatestVersion = latestVersionSchema.safeParse(latestVersionRow);
    nextVersion = parsedLatestVersion.success
      ? parseInteger(parsedLatestVersion.data.version) + 1
      : 1;
  }

  const timestamp = Date.now();
  const safeFileName = sanitizeFileName(rawFile.name);
  const filePath = `${session.profile.org_id}/${documentId}/v${nextVersion}/${timestamp}-${safeFileName}`;
  const contentType = rawFile.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET_NAME)
    .upload(filePath, rawFile, {
      upsert: false,
      contentType
    });

  if (uploadError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "FILE_UPLOAD_FAILED",
        message: "Unable to upload the document file."
      },
      meta: buildMeta()
    });
  }

  const mutationValues = {
    org_id: session.profile.org_id,
    owner_user_id: ownerUserId,
    category,
    title: payload.title.trim(),
    description: normalizedDescription,
    file_path: filePath,
    file_name: rawFile.name,
    mime_type: contentType,
    size_bytes: rawFile.size,
    expiry_date: expiryDate,
    country_code: countryCode
  };

  let documentRow: z.infer<typeof documentRowSchema> | null = null;

  if (existingDocument) {
    const { data: updatedDocumentRow, error: updateDocumentError } = await supabase
      .from("documents")
      .update(mutationValues)
      .eq("id", existingDocument.id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .select(
        "id, owner_user_id, category, title, description, file_path, file_name, mime_type, size_bytes, expiry_date, country_code, created_by, created_at, updated_at"
      )
      .single();

    if (updateDocumentError || !updatedDocumentRow) {
      await cleanupUploadedFile(filePath);
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_UPDATE_FAILED",
          message: "Unable to update document metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedUpdatedDocument = documentRowSchema.safeParse(updatedDocumentRow);

    if (!parsedUpdatedDocument.success) {
      await cleanupUploadedFile(filePath);
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_PARSE_FAILED",
          message: "Updated document data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    documentRow = parsedUpdatedDocument.data;
  } else {
    const { data: insertedDocumentRow, error: insertDocumentError } = await supabase
      .from("documents")
      .insert({
        id: documentId,
        ...mutationValues,
        created_by: session.profile.id
      })
      .select(
        "id, owner_user_id, category, title, description, file_path, file_name, mime_type, size_bytes, expiry_date, country_code, created_by, created_at, updated_at"
      )
      .single();

    if (insertDocumentError || !insertedDocumentRow) {
      await cleanupUploadedFile(filePath);
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_INSERT_FAILED",
          message: "Unable to create the document record."
        },
        meta: buildMeta()
      });
    }

    const parsedInsertedDocument = documentRowSchema.safeParse(insertedDocumentRow);

    if (!parsedInsertedDocument.success) {
      await cleanupUploadedFile(filePath);
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_PARSE_FAILED",
          message: "Inserted document data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    documentRow = parsedInsertedDocument.data;
  }

  const { error: versionInsertError } = await supabase.from("document_versions").insert({
    org_id: session.profile.org_id,
    document_id: documentId,
    version: nextVersion,
    file_path: filePath,
    uploaded_by: session.profile.id
  });

  if (versionInsertError) {
    await cleanupUploadedFile(filePath);
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "VERSION_INSERT_FAILED",
        message: "Unable to create document version metadata."
      },
      meta: buildMeta()
    });
  }

  const relatedProfileIds = [
    documentRow.owner_user_id,
    documentRow.created_by
  ].filter((value): value is string => Boolean(value));

  let profileNameById = new Map<string, string>();

  if (relatedProfileIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", relatedProfileIds);

    if (profileError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_FETCH_FAILED",
          message: "Unable to resolve document owner names."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(profileRows ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_PARSE_FAILED",
          message: "Profile data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    profileNameById = new Map(parsedProfiles.data.map((row) => [row.id, row.full_name]));
  }

  await logAudit({
    action: existingDocument ? "updated" : "created",
    tableName: "documents",
    recordId: documentId,
    newValue: {
      title: documentRow.title,
      category: documentRow.category,
      fileName: documentRow.file_name,
      version: nextVersion
    }
  }).catch(() => undefined);

  const responseDocument: DocumentRecord = {
    id: documentRow.id,
    ownerUserId: documentRow.owner_user_id,
    ownerName: documentRow.owner_user_id
      ? profileNameById.get(documentRow.owner_user_id) ?? "Unknown user"
      : "Policy (All Employees)",
    category: documentRow.category,
    title: documentRow.title,
    description: documentRow.description,
    filePath: documentRow.file_path,
    fileName: documentRow.file_name,
    mimeType: documentRow.mime_type,
    sizeBytes: parseInteger(documentRow.size_bytes),
    expiryDate: documentRow.expiry_date,
    countryCode: documentRow.country_code,
    createdBy: documentRow.created_by,
    createdByName: profileNameById.get(documentRow.created_by) ?? "Unknown user",
    createdAt: documentRow.created_at,
    updatedAt: documentRow.updated_at,
    latestVersion: nextVersion
  };

  return jsonResponse<{ document: DocumentRecord }>(201, {
    data: {
      document: responseDocument
    },
    error: null,
    meta: buildMeta()
  });
}
