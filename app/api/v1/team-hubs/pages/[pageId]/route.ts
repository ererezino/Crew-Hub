import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { UserRole } from "../../../../../../lib/navigation";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  TEAM_HUB_PAGE_TYPES,
  type TeamHubPage,
  type TeamHubPageDetailResponseData
} from "../../../../../../types/team-hub";

const paramsSchema = z.object({
  pageId: z.string().uuid()
});

const updatePageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Title is too long").optional(),
  content: z.string().max(100000, "Content is too long").nullable().optional(),
  pageType: z.enum(TEAM_HUB_PAGE_TYPES).optional(),
  structuredData: z.unknown().optional(),
  coverImageUrl: z.string().trim().url("Cover image must be a valid URL").nullable().optional(),
  icon: z.string().trim().max(50, "Icon is too long").nullable().optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
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
  params: Promise<{ pageId: string }>;
};

async function getPageHubDepartment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  pageId: string
): Promise<{ department: string | null; found: boolean }> {
  const { data: pageRow } = await supabase
    .from("team_hub_pages")
    .select("section_id")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!pageRow) {
    return { department: null, found: false };
  }

  const { data: sectionRow } = await supabase
    .from("team_hub_sections")
    .select("hub_id")
    .eq("id", pageRow.section_id as string)
    .is("deleted_at", null)
    .maybeSingle();

  if (!sectionRow) {
    return { department: null, found: false };
  }

  const { data: hubRow } = await supabase
    .from("team_hubs")
    .select("department")
    .eq("id", sectionRow.hub_id as string)
    .is("deleted_at", null)
    .maybeSingle();

  if (!hubRow) {
    return { department: null, found: false };
  }

  return { department: hubRow.department as string | null, found: true };
}

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
      error: { code: "BAD_REQUEST", message: "Page id must be a valid UUID." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // RLS handles access control
  const { data: rawPage, error: pageError } = await supabase
    .from("team_hub_pages")
    .select("id, section_id, title, content, page_type, structured_data, cover_image_url, icon, pinned, created_by, sort_order, created_at, updated_at")
    .eq("id", parsedParams.data.pageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pageError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_FETCH_FAILED", message: "Unable to load page." },
      meta: buildMeta()
    });
  }

  if (!rawPage) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Page not found." },
      meta: buildMeta()
    });
  }

  const parsed = pageRowSchema.safeParse(rawPage);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_PARSE_FAILED", message: "Page data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubPageDetailResponseData>(200, {
    data: { page: mapPageRow(parsed.data) },
    error: null,
    meta: buildMeta()
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to update pages." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can update pages." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Page id must be a valid UUID." },
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

  const parsedBody = updatePageSchema.safeParse(body);

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

  if (!isAdmin) {
    const supabase = await createSupabaseServerClient();
    const { department, found } = await getPageHubDepartment(supabase, parsedParams.data.pageId);

    if (!found) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Page not found." },
        meta: buildMeta()
      });
    }

    if (department && department !== profile.department) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "You can only update pages in your department hub." },
        meta: buildMeta()
      });
    }
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const payload = parsedBody.data;

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.title !== undefined) updateData.title = payload.title;
  if (payload.content !== undefined) updateData.content = payload.content;
  if (payload.pageType !== undefined) updateData.page_type = payload.pageType;
  if (payload.structuredData !== undefined) updateData.structured_data = payload.structuredData;
  if (payload.coverImageUrl !== undefined) updateData.cover_image_url = payload.coverImageUrl;
  if (payload.icon !== undefined) updateData.icon = payload.icon;
  if (payload.pinned !== undefined) updateData.pinned = payload.pinned;
  if (payload.sortOrder !== undefined) updateData.sort_order = payload.sortOrder;

  const { data: updated, error: updateError } = await serviceClient
    .from("team_hub_pages")
    .update(updateData)
    .eq("id", parsedParams.data.pageId)
    .is("deleted_at", null)
    .select("id, section_id, title, content, page_type, structured_data, cover_image_url, icon, pinned, created_by, sort_order, created_at, updated_at")
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_UPDATE_FAILED", message: "Unable to update page." },
      meta: buildMeta()
    });
  }

  const parsed = pageRowSchema.safeParse(updated);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_PARSE_FAILED", message: "Updated page data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubPageDetailResponseData>(200, {
    data: { page: mapPageRow(parsed.data) },
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to delete pages." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can delete pages." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Page id must be a valid UUID." },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);

  if (!isAdmin) {
    const supabase = await createSupabaseServerClient();
    const { department, found } = await getPageHubDepartment(supabase, parsedParams.data.pageId);

    if (!found) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Page not found." },
        meta: buildMeta()
      });
    }

    if (department && department !== profile.department) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "You can only delete pages in your department hub." },
        meta: buildMeta()
      });
    }
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const now = new Date().toISOString();

  const { error: deleteError } = await serviceClient
    .from("team_hub_pages")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", parsedParams.data.pageId)
    .is("deleted_at", null);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAGE_DELETE_FAILED", message: "Unable to delete page." },
      meta: buildMeta()
    });
  }

  return jsonResponse<null>(200, {
    data: null,
    error: null,
    meta: buildMeta()
  });
}
