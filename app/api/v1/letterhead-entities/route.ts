import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import type {
  LetterheadEntity,
  LetterheadEntityListResponseData,
  LetterheadEntityUpsertResponseData
} from "../../../../types/travel-support";

/* ── Helpers ── */

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/* ── Row Schema ── */

const entityRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  country: z.string(),
  address: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

type EntityRow = z.infer<typeof entityRowSchema>;

function toLetterheadEntity(row: EntityRow): LetterheadEntity {
  return {
    id: row.id,
    orgId: row.org_id,
    country: row.country,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/* ── Validation ── */

const upsertPayloadSchema = z.object({
  country: z.string().trim().min(1, "Country is required.").max(200),
  address: z.string().trim().min(1, "Address is required.").max(1000)
});

/* ── GET: List letterhead entities for the org ── */

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawRows, error: fetchError } = await supabase
    .from("org_letterhead_entities")
    .select("id, org_id, country, address, created_at, updated_at")
    .eq("org_id", session.profile.org_id)
    .order("country", { ascending: true });

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTITY_FETCH_FAILED",
        message: "Unable to load letterhead entities."
      },
      meta: buildMeta()
    });
  }

  const parsed = z.array(entityRowSchema).safeParse(rawRows ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTITY_PARSE_FAILED",
        message: "Entity records are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const entities = parsed.data.map(toLetterheadEntity);

  return jsonResponse<LetterheadEntityListResponseData>(200, {
    data: { entities },
    error: null,
    meta: buildMeta()
  });
}

/* ── POST: Upsert a letterhead entity (SUPER_ADMIN only) ── */

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");

  if (!isSuperAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only co-founders can manage letterhead entities."
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
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = upsertPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();

  const { data: upserted, error: upsertError } = await supabase
    .from("org_letterhead_entities")
    .upsert(
      {
        org_id: session.profile.org_id,
        country: parsed.data.country.trim(),
        address: parsed.data.address.trim(),
        updated_at: now
      },
      { onConflict: "org_id,country" }
    )
    .select("id, org_id, country, address, created_at, updated_at")
    .single();

  if (upsertError || !upserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTITY_UPSERT_FAILED",
        message: "Unable to save letterhead entity."
      },
      meta: buildMeta()
    });
  }

  const parsedRow = entityRowSchema.safeParse(upserted);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTITY_PARSE_FAILED",
        message: "Saved entity is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<LetterheadEntityUpsertResponseData>(200, {
    data: { entity: toLetterheadEntity(parsedRow.data) },
    error: null,
    meta: buildMeta()
  });
}
