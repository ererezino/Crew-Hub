import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";
import type {
  TeamHubSection,
  TeamHubSectionDetailResponseData
} from "../../../../../../../types/team-hub";

const paramsSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid()
});

const sectionRowSchema = z.object({
  id: z.string().uuid(),
  hub_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  sort_order: z.number()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapSectionRow(row: z.infer<typeof sectionRowSchema>): TeamHubSection {
  return {
    id: row.id,
    hubId: row.hub_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    coverImageUrl: row.cover_image_url,
    sortOrder: row.sort_order
  };
}

type RouteContext = {
  params: Promise<{ id: string; sectionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view sections." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Hub and section IDs must be valid UUIDs." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Verify hub access via RLS
  const { data: hub, error: hubError } = await supabase
    .from("team_hubs")
    .select("id")
    .eq("id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (hubError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_FETCH_FAILED", message: "Unable to verify hub access." },
      meta: buildMeta()
    });
  }

  if (!hub) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  const { data: rawSection, error: sectionError } = await supabase
    .from("team_hub_sections")
    .select("id, hub_id, name, description, icon, cover_image_url, sort_order")
    .eq("id", parsedParams.data.sectionId)
    .eq("hub_id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (sectionError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTION_FETCH_FAILED", message: "Unable to load section." },
      meta: buildMeta()
    });
  }

  if (!rawSection) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Section not found." },
      meta: buildMeta()
    });
  }

  const parsed = sectionRowSchema.safeParse(rawSection);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTION_PARSE_FAILED", message: "Section data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubSectionDetailResponseData>(200, {
    data: { section: mapSectionRow(parsed.data) },
    error: null,
    meta: buildMeta()
  });
}
