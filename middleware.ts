import type { NextRequest } from "next/server";

import { applySupabaseAuthMiddleware } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return applySupabaseAuthMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
