import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const rlsAuditRowSchema = z.object({
  schema_name: z.string(),
  table_name: z.string(),
  rls_enabled: z.boolean(),
  force_rls: z.boolean()
});

type RlsAuditRow = {
  schemaName: string;
  tableName: string;
  rlsEnabled: boolean;
  forceRls: boolean;
};

type RlsAuditResponseData = {
  rows: RlsAuditRow[];
  tablesWithoutRls: string[];
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return Response.json(payload, { status });
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to access RLS audit data."
      },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only SUPER_ADMIN can run the RLS audit."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const { data, error } = await serviceClient.rpc("rls_audit");

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "RLS_AUDIT_FAILED",
        message: `Unable to run RLS audit: ${error.message}`
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(rlsAuditRowSchema).safeParse(data ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "RLS_AUDIT_PARSE_FAILED",
        message: "RLS audit output is not in the expected format."
      },
      meta: buildMeta()
    });
  }

  const rows: RlsAuditRow[] = parsedRows.data.map((row) => ({
    schemaName: row.schema_name,
    tableName: row.table_name,
    rlsEnabled: row.rls_enabled,
    forceRls: row.force_rls
  }));

  const tablesWithoutRls = rows
    .filter((row) => !row.rlsEnabled)
    .map((row) => `${row.schemaName}.${row.tableName}`);

  return jsonResponse<RlsAuditResponseData>(200, {
    data: {
      rows,
      tablesWithoutRls
    },
    error: null,
    meta: buildMeta()
  });
}
