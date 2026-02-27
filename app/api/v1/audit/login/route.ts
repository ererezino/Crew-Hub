import { NextResponse } from "next/server";

import { logAudit } from "../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

type LoginAuditResponse = {
  logged: boolean;
};

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST() {
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
      event: "login"
    }
  });

  return jsonResponse<LoginAuditResponse>(200, {
    data: {
      logged: true
    },
    error: null,
    meta: buildMeta()
  });
}
