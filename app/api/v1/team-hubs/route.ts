import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasAnyRole } from "../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { UserRole } from "../../../../lib/navigation";
import type { ApiResponse } from "../../../../types/auth";
import {
  TEAM_HUB_VISIBILITIES,
  type TeamHub,
  type TeamHubListResponseData,
  type TeamHubDetailResponseData
} from "../../../../types/team-hub";

const createHubSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  department: z.string().trim().max(100, "Department is too long").nullable().default(null),
  description: z.string().trim().max(2000, "Description is too long").nullable().default(null),
  coverImageUrl: z.string().trim().url("Cover image must be a valid URL").nullable().default(null),
  icon: z.string().trim().max(50, "Icon is too long").nullable().default(null),
  visibility: z.enum(TEAM_HUB_VISIBILITIES).default("department")
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

function canWriteHubs(roles: readonly UserRole[]): boolean {
  return hasAnyRole(roles, WRITE_ROLES);
}

function mapHubRow(
  row: z.infer<typeof hubRowSchema>,
  sectionCount?: number,
  pageCount?: number
): TeamHub {
  return {
    id: row.id,
    orgId: row.org_id,
    department: row.department,
    name: row.name,
    description: row.description,
    coverImageUrl: row.cover_image_url,
    icon: row.icon,
    visibility: row.visibility,
    createdBy: row.created_by,
    sectionCount,
    pageCount
  };
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view team hubs." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // RLS handles visibility filtering
  const { data: rawHubs, error: hubsError } = await supabase
    .from("team_hubs")
    .select("id, org_id, department, name, description, cover_image_url, icon, visibility, created_by")
    .is("deleted_at", null)
    .eq("org_id", session.profile.org_id)
    .order("name", { ascending: true });

  if (hubsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUBS_FETCH_FAILED", message: "Unable to load team hubs." },
      meta: buildMeta()
    });
  }

  const parsed = z.array(hubRowSchema).safeParse(rawHubs ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUBS_PARSE_FAILED", message: "Team hubs data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  // Get section and page counts
  const hubIds = parsed.data.map((h) => h.id);
  const sectionCountMap = new Map<string, number>();
  const pageCountMap = new Map<string, number>();

  if (hubIds.length > 0) {
    const { data: sectionRows } = await supabase
      .from("team_hub_sections")
      .select("hub_id")
      .in("hub_id", hubIds)
      .is("deleted_at", null);

    if (sectionRows) {
      for (const row of sectionRows) {
        const hubId = row.hub_id as string;
        sectionCountMap.set(hubId, (sectionCountMap.get(hubId) ?? 0) + 1);
      }
    }

    const { data: sectionIdRows } = await supabase
      .from("team_hub_sections")
      .select("id, hub_id")
      .in("hub_id", hubIds)
      .is("deleted_at", null);

    if (sectionIdRows && sectionIdRows.length > 0) {
      const sectionIds = sectionIdRows.map((s) => s.id as string);
      const sectionToHub = new Map(sectionIdRows.map((s) => [s.id as string, s.hub_id as string]));

      const { data: pageRows } = await supabase
        .from("team_hub_pages")
        .select("section_id")
        .in("section_id", sectionIds)
        .is("deleted_at", null);

      if (pageRows) {
        for (const row of pageRows) {
          const sectionId = row.section_id as string;
          const hubId = sectionToHub.get(sectionId);
          if (hubId) {
            pageCountMap.set(hubId, (pageCountMap.get(hubId) ?? 0) + 1);
          }
        }
      }
    }
  }

  const hubs = parsed.data.map((row) =>
    mapHubRow(row, sectionCountMap.get(row.id) ?? 0, pageCountMap.get(row.id) ?? 0)
  );

  return jsonResponse<TeamHubListResponseData>(200, {
    data: { hubs },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to create team hubs." },
      meta: buildMeta()
    });
  }

  if (!canWriteHubs(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only team leads, managers, and admins can create hubs." },
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

  const parsedBody = createHubSchema.safeParse(body);

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

  const payload = parsedBody.data;
  const profile = session.profile;

  // Department-scoped leads can only create hubs for their own department
  const isAdmin = hasAnyRole(profile.roles, ["HR_ADMIN", "SUPER_ADMIN"]);
  if (!isAdmin && payload.department && payload.department !== profile.department) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You can only create hubs for your own department." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data: inserted, error: insertError } = await serviceClient
    .from("team_hubs")
    .insert({
      org_id: profile.org_id,
      department: payload.department,
      name: payload.name,
      description: payload.description,
      cover_image_url: payload.coverImageUrl,
      icon: payload.icon,
      visibility: payload.visibility,
      created_by: profile.id
    })
    .select("id, org_id, department, name, description, cover_image_url, icon, visibility, created_by")
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_CREATE_FAILED", message: "Unable to create team hub." },
      meta: buildMeta()
    });
  }

  const parsedInserted = hubRowSchema.safeParse(inserted);

  if (!parsedInserted.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "HUB_PARSE_FAILED", message: "Created hub data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  return jsonResponse<TeamHubDetailResponseData>(201, {
    data: { hub: mapHubRow(parsedInserted.data, 0, 0) },
    error: null,
    meta: buildMeta()
  });
}
