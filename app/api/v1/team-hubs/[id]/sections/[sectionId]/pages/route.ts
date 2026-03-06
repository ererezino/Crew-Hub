import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../../lib/supabase/service-role";
import type { UserRole } from "../../../../../../../../lib/navigation";
import type { ApiResponse } from "../../../../../../../../types/auth";
import {
  TEAM_HUB_PAGE_TYPES,
  type TeamHubPage,
  type TeamHubPageListResponseData,
  type TeamHubPageDetailResponseData
} from "../../../../../../../../types/team-hub";

const paramsSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid()
});

const createPageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Title is too long"),
  content: z.string().max(100000, "Content is too long").nullable().default(null),
  pageType: z.enum(TEAM_HUB_PAGE_TYPES).default("document"),
  structuredData: z.unknown().default(null),
  coverImageUrl: z.string().trim().url("Cover image must be a valid URL").nullable().default(null),
  icon: z.string().trim().max(50, "Icon is too long").nullable().default(null),
  pinned: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0)
});

const pageRowSchema = z.object({
  id: z.string().uuid(),
  section_id: z.string().uuid(),
  title: z.string(),
  content: z.string().nullable(),
  page_type: z.enum(TEAM_HUB_PAGE_TYPES),
  structured_data: z.unknown(),
  cover_image_url: z.string().nullable(),
  icon: z.string().nullable(),
  pinned: z.boolean(),
  created_by: z.string().uuid().nullable(),
  sort_order: z.number(),
  created_at: z.string(),
  updated_at: z.string()
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

function mapPageRow(row: z.infer<typeof pageRowSchema>): TeamHubPage {
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    content: row.content,
    pageType: row.page_type,
    structuredData: row.structured_data,
    coverImageUrl: row.cover_image_url,
    icon: row.icon,
    pinned: row.pinned,
    createdBy: row.created_by,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view pages." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Hub id and section id must be valid UUIDs." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Verify hub access via RLS
  const { data: hub } = await supabase
    .from("team_hubs")
    .select("id")
    .eq("id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!hub) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  // Verify section belongs to hub
  const { data: section } = await supabase
    .from("team_hub_sections")
    .select("id")
    .eq("id", parsedParams.data.sectionId)
    .eq("hub_id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!section) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Section not found." },
      meta: buildMeta()
    });
  }

  const { data: rawPages, error: pagesError } = await supabase
    .from("team_hub_pages")
    .select("id, section_id, title, content, page_type, structured_data, cover_image_url, icon, pinned, created_by, sort_order, created_at, updated_at")
    .eq("section_id", parsedParams.data.sectionId)
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("sort_order", { ascending: true });

  if (pagesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGES_FETCH_FAILED", message: "Unable to load pages." },
      meta: buildMeta()
    });
  }

  const parsed = z.array(pageRowSchema).safeParse(rawPages ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGES_PARSE_FAILED", message: "Pages data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  const pages = parsed.data.map(mapPageRow);

  return jsonResponse<TeamHubPageListResponseData>(200, {
    data: { pages },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to create pages." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can create pages." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Hub id and section id must be valid UUIDs." },
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

  const parsedBody = createPageSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid page payload."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);
  const supabase = await createSupabaseServerClient();

  // Verify hub and section exist, check department access
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
      error: { code: "FORBIDDEN", message: "You can only create pages in your department hub." },
      meta: buildMeta()
    });
  }

  const { data: sectionRow } = await supabase
    .from("team_hub_sections")
    .select("id")
    .eq("id", parsedParams.data.sectionId)
    .eq("hub_id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!sectionRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Section not found." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const payload = parsedBody.data;

  const { data: inserted, error: insertError } = await serviceClient
    .from("team_hub_pages")
    .insert({
      section_id: parsedParams.data.sectionId,
      title: payload.title,
      content: payload.content,
      page_type: payload.pageType,
      structured_data: payload.structuredData,
      cover_image_url: payload.coverImageUrl,
      icon: payload.icon,
      pinned: payload.pinned,
      created_by: profile.id,
      sort_order: payload.sortOrder
    })
    .select("id, section_id, title, content, page_type, structured_data, cover_image_url, icon, pinned, created_by, sort_order, created_at, updated_at")
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_CREATE_FAILED", message: "Unable to create page." },
      meta: buildMeta()
    });
  }

  const parsedInserted = pageRowSchema.safeParse(inserted);

  if (!parsedInserted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_PARSE_FAILED", message: "Created page data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubPageDetailResponseData>(201, {
    data: { page: mapPageRow(parsedInserted.data) },
    error: null,
    meta: buildMeta()
  });
}
