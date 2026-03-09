import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/**
 * Supabase Auth callback handler.
 *
 * When a user clicks an invite / recovery / magic link, Supabase verifies the
 * token and redirects here with a `code` query parameter (PKCE flow). This
 * route exchanges the code for a session cookie, then sends the user to the
 * page specified by the `next` parameter (defaults to /mfa-setup).
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/mfa-setup";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  /* If code exchange fails, send to login with an error hint */
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "invite_expired");
  return NextResponse.redirect(loginUrl);
}
