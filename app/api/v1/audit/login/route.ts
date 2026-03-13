import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

type LoginAuditResponse = {
  logged: boolean;
};

const requestHeadersSchema = z.object({
  userAgent: z.string().nullable()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  const parsedHeaders = requestHeadersSchema.safeParse({
    userAgent: request.headers.get("user-agent")
  });

  if (!parsedHeaders.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request headers."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to write login audit logs."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "login",
    tableName: "auth.users",
    recordId: user.id,
    newValue: {
      event: "login",
      userAgent: parsedHeaders.data.userAgent
    }
  });

  /* Mark account as set up and record first Crew Hub sign-in on first real login.
     Both are idempotent (no-op if already set).
     Uses the service role client to bypass RLS so the update always succeeds. */
  try {
    const serviceRole = createSupabaseServiceRoleClient();
    const now = new Date().toISOString();
    await serviceRole
      .from("profiles")
      .update({ account_setup_at: now })
      .eq("id", user.id)
      .is("account_setup_at", null);
    await serviceRole
      .from("profiles")
      .update({ crew_hub_joined_at: now })
      .eq("id", user.id)
      .is("crew_hub_joined_at", null);
  } catch {
    // Non-critical — don't fail the login audit if this update fails.
  }

  return jsonResponse<LoginAuditResponse>(200, {
    data: {
      logged: true
    },
    error: null,
    meta: buildMeta()
  });
}
