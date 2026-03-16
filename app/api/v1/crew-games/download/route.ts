import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { CREW_NIGHTS_BUCKET } from "../../../../../types/crew-games";
import { buildMeta, jsonResponse } from "../_helpers";

/* ── GET /api/v1/crew-games/download?path=... ── */

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "MISSING_PATH", message: "File path is required." },
      meta: buildMeta()
    });
  }

  // Ensure the path is scoped to the user's org
  const orgPrefix = `${session.profile.org_id}/`;
  if (!filePath.startsWith(orgPrefix)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Access denied." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage
    .from(CREW_NIGHTS_BUCKET)
    .download(filePath);

  if (error || !data) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "File not found." },
      meta: buildMeta()
    });
  }

  // Extract filename from path
  const segments = filePath.split("/");
  const filename = segments[segments.length - 1] ?? "download";

  const headers = new Headers();
  headers.set("Content-Type", data.type || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  return new NextResponse(data, { status: 200, headers });
}
