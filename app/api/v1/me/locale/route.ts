import { NextResponse } from "next/server";
import { z } from "zod";

import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";

const localePayloadSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES)
});

/**
 * PATCH /api/v1/me/locale
 *
 * Persists the authenticated user's locale preference to the database.
 * The cookie is the request-time source of truth; the DB is the canonical
 * persistent source. This endpoint keeps them in sync.
 */
export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return NextResponse.json(
      { data: null, error: { code: "UNAUTHORIZED", message: "Not authenticated." } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "BAD_REQUEST", message: "Invalid JSON." } },
      { status: 400 }
    );
  }

  const parsedPayload = localePayloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Locale must be 'en' or 'fr'." } },
      { status: 422 }
    );
  }
  const locale = parsedPayload.data.locale;

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("profiles")
    .update({ preferred_locale: locale })
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (error) {
    console.error("[LOCALE_UPDATE] Failed:", JSON.stringify(error, null, 2));
    return NextResponse.json(
      { data: null, error: { code: "UPDATE_FAILED", message: "Unable to save locale preference." } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { locale }, error: null });
}
