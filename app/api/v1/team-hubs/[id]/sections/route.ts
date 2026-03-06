import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { UserRole } from "../../../../../../lib/navigation";
import type { ApiResponse } from "../../../../../../types/auth";
import type {
  TeamHubSection,
  TeamHubSectionListResponseData,
  TeamHubSectionDetailResponseData
} from "../../../../../../types/team-hub";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const createSectionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  description: z.string().trim().max(2000, "Description is too long").nullable().default(null),
  icon: z.string().trim().max(50, "Icon is too long").nullable().default(null),
  coverImageUrl: z.string().trim().url("Cover image must be a valid URL").nullable().default(null),
  sortOrder: z.number().int().min(0).default(0)
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

const WRITE_ROLES: readonly UserRole[] = [
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "SUPER_ADMIN"
];

function mapSectionRow(
  row: z.infer<typeof sectionRowSchema>,
  pageCount?: number
): TeamHubSection {
  return {
    id: row.id,
    hubId: row.hub_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    coverImageUrl: row.cover_image_url,
    sortOrder: row.sort_order,
    pageCount
  };
}

type RouteContext = {
  params: Promise<{ id: string }>;
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
      error: { code: "BAD_REQUEST", message: "Hub id must be a valid UUID." },
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

  const { data: rawSections, error: sectionsError } = await supabase
    .from("team_hub_sections")
    .select("id, hub_id, name, description, icon, cover_image_url, sort_order")
    .eq("hub_id", parsedParams.data.id)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (sectionsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTIONS_FETCH_FAILED", message: "Unable to load sections." },
      meta: buildMeta()
    });
  }

  const parsed = z.array(sectionRowSchema).safeParse(rawSections ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTIONS_PARSE_FAILED", message: "Sections data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  // Get page counts per section
  const sectionIds = parsed.data.map((s) => s.id);
  const pageCountMap = new Map<string, number>();

  if (sectionIds.length > 0) {
    const { data: pageRows } = await supabase
      .from("team_hub_pages")
      .select("section_id")
      .in("section_id", sectionIds)
      .is("deleted_at", null);

    if (pageRows) {
      for (const row of pageRows) {
        const sid = row.section_id as string;
        pageCountMap.set(sid, (pageCountMap.get(sid) ?? 0) + 1);
      }
    }
  }

  const sections = parsed.data.map((row) =>
    mapSectionRow(row, pageCountMap.get(row.id) ?? 0)
  );

  return jsonResponse<TeamHubSectionListResponseData>(200, {
    data: { sections },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to create sections." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can create sections." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Hub id must be a valid UUID." },
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

  const parsedBody = createSectionSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid section payload."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);

  // Verify hub exists and check department access
  const supabase = await createSupabaseServerClient();
  const { data: hubRow } = await supabase
    .from("team_hubs")
    .select("id, department")
    .eq("id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!hubRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  if (!isAdmin && hubRow.department && hubRow.department !== profile.department) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You can only create sections in your department hub." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const payload = parsedBody.data;

  const { data: inserted, error: insertError } = await serviceClient
    .from("team_hub_sections")
    .insert({
      hub_id: parsedParams.data.id,
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      cover_image_url: payload.coverImageUrl,
      sort_order: payload.sortOrder
    })
    .select("id, hub_id, name, description, icon, cover_image_url, sort_order")
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTION_CREATE_FAILED", message: "Unable to create section." },
      meta: buildMeta()
    });
  }

  const parsedInserted = sectionRowSchema.safeParse(inserted);

  if (!parsedInserted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SECTION_PARSE_FAILED", message: "Created section data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubSectionDetailResponseData>(201, {
    data: { section: mapSectionRow(parsedInserted.data, 0) },
    error: null,
    meta: buildMeta()
  });
}
