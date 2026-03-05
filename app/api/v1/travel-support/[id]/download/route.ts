import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME } from "../../../../../../lib/documents";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type { TravelSupportDownloadResponseData } from "../../../../../../types/travel-support";

/* ── Helpers ── */

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/* ── Validation ── */

const paramsSchema = z.object({
  id: z.string().uuid()
});

const querySchema = z.object({
  expiresIn: z.coerce.number().int().min(30).max(900).default(180),
  usage: z.enum(["view", "download"]).default("download")
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

/* ── GET: Download travel support letter ── */

export async function GET(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to download this document."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request id must be a valid UUID."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid query parameters."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isSuperAdmin = session.profile.roles.includes("SUPER_ADMIN");

  let fetchQuery = supabase
    .from("travel_support_requests")
    .select("id, employee_id, destination_country, document_path, status")
    .eq("id", parsedParams.data.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (!isSuperAdmin) {
    fetchQuery = fetchQuery.eq("employee_id", session.profile.id);
  }

  const { data: row, error: fetchError } = await fetchQuery.maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TRAVEL_SUPPORT_FETCH_FAILED",
        message: "Unable to load travel support request."
      },
      meta: buildMeta()
    });
  }

  if (!row) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Travel support request not found."
      },
      meta: buildMeta()
    });
  }

  if (row.status !== "approved" || !row.document_path) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "This travel support letter has not been approved yet."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const downloadName = `travel-support-letter-${row.destination_country.toLowerCase().replace(/\s+/g, "-")}.pdf`;
  const signedUrlOptions =
    query.usage === "download" ? { download: downloadName } : undefined;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(DOCUMENT_BUCKET_NAME)
    .createSignedUrl(row.document_path, query.expiresIn, signedUrlOptions);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNED_URL_FAILED",
        message: "Unable to generate download URL for travel support letter."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<TravelSupportDownloadResponseData>(200, {
    data: {
      url: signedUrlData.signedUrl,
      expiresIn: query.expiresIn
    },
    error: null,
    meta: buildMeta()
  });
}
