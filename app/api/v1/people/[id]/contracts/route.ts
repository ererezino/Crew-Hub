import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import {
  buildMeta,
  jsonResponse
} from "../../../../../../lib/people/shared";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ContractStatus, PreStartContract } from "../../../../../../types/people";

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

function mapContractRow(row: Record<string, unknown>): PreStartContract {
  const sentAt = (row.sent_at as string) ?? null;
  const signedAt = (row.signed_at as string) ?? null;
  const voidedAt = (row.voided_at as string) ?? null;

  return {
    id: row.id as string,
    personId: row.person_id as string,
    title: row.title as string,
    notes: (row.notes as string) ?? null,
    status: deriveContractStatus({ sent_at: sentAt, signed_at: signedAt, voided_at: voidedAt }),
    sentAt,
    signedAt,
    voidedAt,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
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

  const mapped: PreStartContract[] = (contracts ?? []).map((c) =>
    mapContractRow(c as Record<string, unknown>)
  );

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid JSON body." },
      meta: buildMeta()
    });
  }

  const parsed = createContractSchema.safeParse(body);
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

  const contract = mapContractRow(inserted as Record<string, unknown>);

  await logAudit({
    action: "created",
    tableName: "pre_start_contracts",
    recordId: contract.id,
    newValue: {
      personId,
      personName: (personRow as Record<string, unknown>).full_name as string,
      title: contract.title,
      status: contract.status
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid JSON body." },
      meta: buildMeta()
    });
  }

  const rawBody = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;

  if (!rawBody || typeof rawBody.contractId !== "string") {
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
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to update contract." },
      meta: buildMeta()
    });
  }

  const oldContract = mapContractRow(existing as Record<string, unknown>);
  const newContract = mapContractRow(updated as Record<string, unknown>);

  await logAudit({
    action: "updated",
    tableName: "pre_start_contracts",
    recordId: contractId,
    oldValue: {
      title: oldContract.title,
      status: oldContract.status,
      sentAt: oldContract.sentAt,
      signedAt: oldContract.signedAt,
      voidedAt: oldContract.voidedAt
    },
    newValue: {
      title: newContract.title,
      status: newContract.status,
      sentAt: newContract.sentAt,
      signedAt: newContract.signedAt,
      voidedAt: newContract.voidedAt
    }
  });

  return jsonResponse<{ contract: PreStartContract }>(200, {
    data: { contract: newContract },
    error: null,
    meta: buildMeta()
  });
}
