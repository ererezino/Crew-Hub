import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const organizationSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(200, "Name is too long"),
  logoUrl: z
    .string()
    .trim()
    .max(500, "Logo URL is too long")
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: "Logo URL must start with http:// or https://"
    })
});

type OrganizationResponseData = {
  name: string;
  logoUrl: string | null;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile || !session.org) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update organization settings."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only SUPER_ADMIN can update organization settings."
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
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsed = organizationSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid organization payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data, error } = await serviceClient
    .from("orgs")
    .update({
      name: parsed.data.name,
      logo_url: parsed.data.logoUrl || null
    })
    .eq("id", session.org.id)
    .select("name, logo_url")
    .single();

  if (error || !data) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ORGANIZATION_UPDATE_FAILED",
        message: "Unable to update organization settings."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<OrganizationResponseData>(200, {
    data: {
      name: data.name,
      logoUrl: data.logo_url
    },
    error: null,
    meta: buildMeta()
  });
}
