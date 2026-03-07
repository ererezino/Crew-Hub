import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { UserRole } from "../../../../../lib/navigation";
import type { ApiResponse } from "../../../../../types/auth";
import {
  TEAM_HUB_VISIBILITIES,
  type TeamHub,
  type TeamHubDetailResponseData
} from "../../../../../types/team-hub";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const updateHubSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long").optional(),
  department: z.string().trim().max(100, "Department is too long").nullable().optional(),
  description: z.string().trim().max(2000, "Description is too long").nullable().optional(),
  coverImageUrl: z.string().trim().url("Cover image must be a valid URL").nullable().optional(),
  icon: z.string().trim().max(50, "Icon is too long").nullable().optional(),
  visibility: z.enum(TEAM_HUB_VISIBILITIES).optional()
});

const hubRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  department: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  icon: z.string().nullable(),
  visibility: z.enum(TEAM_HUB_VISIBILITIES),
  created_by: z.string().uuid().nullable()
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

function mapHubRow(row: z.infer<typeof hubRowSchema>): TeamHub {
  return {
    id: row.id,
    orgId: row.org_id,
    department: row.department,
    name: row.name,
    description: row.description,
    coverImageUrl: row.cover_image_url,
    icon: row.icon,
    visibility: row.visibility,
    createdBy: row.created_by
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
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view team hubs." },
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

  const { data: rawHub, error: hubError } = await supabase
    .from("team_hubs")
    .select("id, org_id, department, name, description, cover_image_url, icon, visibility, created_by")
    .eq("id", parsedParams.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (hubError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_FETCH_FAILED", message: "Unable to load team hub." },
      meta: buildMeta()
    });
  }

  if (!rawHub) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  const parsed = hubRowSchema.safeParse(rawHub);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_PARSE_FAILED", message: "Hub data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubDetailResponseData>(200, {
    data: { hub: mapHubRow(parsed.data) },
    error: null,
    meta: buildMeta()
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to update team hubs." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can update hubs." },
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

  const parsedBody = updateHubSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid hub payload."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const payload = parsedBody.data;

  // Verify hub exists and belongs to user's org (fail-closed: null = 404)
  const supabase = await createSupabaseServerClient();
  const { data: existingHub } = await supabase
    .from("team_hubs")
    .select("department")
    .eq("id", parsedParams.data.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existingHub) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  // Check department-scoped access for non-admins
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);
  if (!isAdmin && existingHub.department && existingHub.department !== profile.department) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You can only update hubs for your own department." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) updateData.name = payload.name;
  if (payload.department !== undefined) updateData.department = payload.department;
  if (payload.description !== undefined) updateData.description = payload.description;
  if (payload.coverImageUrl !== undefined) updateData.cover_image_url = payload.coverImageUrl;
  if (payload.icon !== undefined) updateData.icon = payload.icon;
  if (payload.visibility !== undefined) updateData.visibility = payload.visibility;

  const { data: updated, error: updateError } = await serviceClient
    .from("team_hubs")
    .update(updateData)
    .eq("id", parsedParams.data.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .select("id, org_id, department, name, description, cover_image_url, icon, visibility, created_by")
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_UPDATE_FAILED", message: "Unable to update team hub." },
      meta: buildMeta()
    });
  }

  const parsed = hubRowSchema.safeParse(updated);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_PARSE_FAILED", message: "Updated hub data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubDetailResponseData>(200, {
    data: { hub: mapHubRow(parsed.data) },
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to delete team hubs." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile.roles, WRITE_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can delete hubs." },
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

  const profile = session.profile;

  // Verify hub exists and belongs to user's org (fail-closed: null = 404)
  const supabase = await createSupabaseServerClient();
  const { data: existingHub } = await supabase
    .from("team_hubs")
    .select("department")
    .eq("id", parsedParams.data.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existingHub) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Team hub not found." },
      meta: buildMeta()
    });
  }

  // Check department-scoped access for non-admins
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);
  if (!isAdmin && existingHub.department && existingHub.department !== profile.department) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You can only delete hubs for your own department." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const now = new Date().toISOString();

  const { error: deleteError } = await serviceClient
    .from("team_hubs")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", parsedParams.data.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_DELETE_FAILED", message: "Unable to delete team hub." },
      meta: buildMeta()
    });
  }

  return jsonResponse<null>(200, {
    data: null,
    error: null,
    meta: buildMeta()
  });
}
