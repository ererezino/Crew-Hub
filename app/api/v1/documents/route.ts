import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { DOCUMENT_CATEGORIES } from "../../../../types/documents";
import type { ApiResponse } from "../../../../types/auth";
import type { DocumentRecord, DocumentsResponseData } from "../../../../types/documents";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const querySchema = z.object({
  scope: z.enum(["all", "mine"]).default("all"),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  sortBy: z.enum(["created_at", "updated_at", "expiry_date", "title"]).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(200)
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
  updated_at: z.string(),
  is_policy: z.boolean().optional().nullable(),
  requires_acknowledgment: z.boolean().optional().nullable(),
  policy_version: z.string().optional().nullable()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const versionRowSchema = z.object({
  document_id: z.string().uuid(),
  version: z.union([z.number(), z.string()])
});

const policyAcknowledgmentRowSchema = z.object({
  policy_id: z.string().uuid(),
  acknowledged_at: z.string().nullable()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function parseInteger(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view documents."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid document query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  let documentsQuery = supabase
    .from("documents")
    .select(
      "id, owner_user_id, category, title, description, file_path, file_name, mime_type, size_bytes, expiry_date, country_code, created_by, created_at, updated_at, is_policy, requires_acknowledgment, policy_version"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .limit(query.limit);

  if (query.scope === "mine") {
    documentsQuery = documentsQuery.eq("owner_user_id", session.profile.id);
  }

  if (query.category) {
    documentsQuery = documentsQuery.eq("category", query.category);
  }

  documentsQuery = documentsQuery.order(query.sortBy, {
    ascending: query.sortDir === "asc",
    nullsFirst: false
  });

  const { data: rawDocuments, error: documentsError } = await documentsQuery;

  if (documentsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENTS_FETCH_FAILED",
        message: "Unable to load documents."
      },
      meta: buildMeta()
    });
  }

  const parsedDocuments = z.array(documentRowSchema).safeParse(rawDocuments ?? []);

  if (!parsedDocuments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENTS_PARSE_FAILED",
        message: "Document data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const rows = parsedDocuments.data;
  const ownerIds = new Set<string>();
  const actorIds = new Set<string>();
  const documentIds = rows.map((row) => row.id);

  for (const row of rows) {
    if (row.owner_user_id) {
      ownerIds.add(row.owner_user_id);
    }

    actorIds.add(row.created_by);
  }

  const profileIds = [...new Set([...ownerIds, ...actorIds])];
  let profileNameById = new Map<string, string>();

  if (profileIds.length > 0) {
    const { data: rawProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", profileIds);

    if (profilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENTS_PROFILES_FETCH_FAILED",
          message: "Unable to resolve document owner metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENTS_PROFILES_PARSE_FAILED",
          message: "Document profile metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    profileNameById = new Map(parsedProfiles.data.map((row) => [row.id, row.full_name]));
  }

  let latestVersionByDocumentId = new Map<string, number>();

  if (documentIds.length > 0) {
    const { data: rawVersions, error: versionsError } = await supabase
      .from("document_versions")
      .select("document_id, version")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("document_id", documentIds)
      .order("version", { ascending: false });

    if (versionsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_VERSIONS_FETCH_FAILED",
          message: "Unable to resolve document versions."
        },
        meta: buildMeta()
      });
    }

    const parsedVersions = z.array(versionRowSchema).safeParse(rawVersions ?? []);

    if (!parsedVersions.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DOCUMENT_VERSIONS_PARSE_FAILED",
          message: "Document version metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const nextMap = new Map<string, number>();

    for (const row of parsedVersions.data) {
      const version = parseInteger(row.version);
      const currentMax = nextMap.get(row.document_id) ?? 0;

      if (version > currentMax) {
        nextMap.set(row.document_id, version);
      }
    }

    latestVersionByDocumentId = nextMap;
  }

  let policyAcknowledgmentByPolicyId = new Map<string, string | null>();
  const policyDocumentIds = rows
    .filter((row) => row.is_policy === true && row.requires_acknowledgment === true)
    .map((row) => row.id);

  if (policyDocumentIds.length > 0) {
    const { data: rawPolicyAcknowledgments, error: policyAcknowledgmentsError } = await supabase
      .from("policy_acknowledgments")
      .select("policy_id, acknowledged_at")
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .in("policy_id", policyDocumentIds);

    if (policyAcknowledgmentsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "POLICY_ACKNOWLEDGMENTS_FETCH_FAILED",
          message: "Unable to resolve policy acknowledgment status."
        },
        meta: buildMeta()
      });
    }

    const parsedPolicyAcknowledgments = z
      .array(policyAcknowledgmentRowSchema)
      .safeParse(rawPolicyAcknowledgments ?? []);

    if (!parsedPolicyAcknowledgments.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "POLICY_ACKNOWLEDGMENTS_PARSE_FAILED",
          message: "Policy acknowledgment metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    policyAcknowledgmentByPolicyId = new Map(
      parsedPolicyAcknowledgments.data.map((row) => [row.policy_id, row.acknowledged_at])
    );
  }

  const documents: DocumentRecord[] = rows.map((row) => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_user_id
      ? profileNameById.get(row.owner_user_id) ?? "Unknown user"
      : "Policy (All Employees)",
    category: row.category,
    title: row.title,
    description: row.description,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: parseInteger(row.size_bytes),
    expiryDate: row.expiry_date,
    countryCode: row.country_code,
    createdBy: row.created_by,
    createdByName: profileNameById.get(row.created_by) ?? "Unknown user",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: latestVersionByDocumentId.get(row.id) ?? 1,
    isPolicy: row.is_policy ?? row.category === "policy",
    requiresAcknowledgment: row.requires_acknowledgment ?? false,
    policyVersion: row.policy_version ?? null,
    acknowledgedAt: policyAcknowledgmentByPolicyId.get(row.id) ?? null
  }));

  const responseData: DocumentsResponseData = {
    documents
  };

  return jsonResponse<DocumentsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
