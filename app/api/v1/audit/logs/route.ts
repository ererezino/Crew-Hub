import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  AUDIT_LOG_ACTIONS,
  type AuditLogAction,
  type AuditLogActor,
  type AuditLogEntry,
  type AuditLogsResponseData
} from "../../../../../types/settings";

const pageSizeLimit = 50;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(pageSizeLimit).default(pageSizeLimit),
  actorId: z.string().uuid().optional(),
  action: z.enum(AUDIT_LOG_ACTIONS).optional(),
  table: z.string().trim().min(1).max(100).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  sort: z.enum(["asc", "desc"]).default("desc")
});

const defaultTableOptions = [
  "profiles",
  "orgs",
  "audit_log",
  "auth.users"
] as const;

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function actorNameFor(
  actorId: string | null,
  actorMap: ReadonlyMap<string, string>
): string {
  if (!actorId) {
    return "System";
  }

  return actorMap.get(actorId) ?? "Unknown user";
}

function hasAuditAccess(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view the audit log."
      },
      meta: buildMeta()
    });
  }

  if (!hasAuditAccess(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view the audit log."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const queryParams = Object.fromEntries(requestUrl.searchParams.entries());

  const parsedQuery = querySchema.safeParse(queryParams);

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid audit query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;

  const supabase = await createSupabaseServerClient();

  let auditQuery = supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_user_id, action, table_name, record_id, old_value, new_value",
      { count: "exact" }
    )
    .eq("org_id", session.profile.org_id);

  if (query.actorId) {
    auditQuery = auditQuery.eq("actor_user_id", query.actorId);
  }

  if (query.action) {
    auditQuery = auditQuery.eq("action", query.action);
  }

  if (query.table) {
    auditQuery = auditQuery.eq("table_name", query.table);
  }

  if (query.dateFrom) {
    auditQuery = auditQuery.gte("created_at", `${query.dateFrom}T00:00:00.000Z`);
  }

  if (query.dateTo) {
    auditQuery = auditQuery.lte("created_at", `${query.dateTo}T23:59:59.999Z`);
  }

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const { data: logsData, error: logsError, count } = await auditQuery
    .order("created_at", { ascending: query.sort === "asc" })
    .range(from, to);

  if (logsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "AUDIT_FETCH_FAILED",
        message: "Unable to fetch audit log entries."
      },
      meta: buildMeta()
    });
  }

  const { data: actorData } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  const actors: AuditLogActor[] = (actorData ?? []).map((actor) => ({
    id: actor.id,
    fullName: actor.full_name
  }));

  const actorMap = new Map<string, string>(actors.map((actor) => [actor.id, actor.fullName]));

  const entries: AuditLogEntry[] = (logsData ?? []).map((entry) => ({
    id: entry.id,
    timestamp: entry.created_at,
    actorId: entry.actor_user_id,
    actorName: actorNameFor(entry.actor_user_id, actorMap),
    action: entry.action as AuditLogAction,
    tableName: entry.table_name,
    recordId: entry.record_id,
    oldValue: toPlainObject(entry.old_value),
    newValue: toPlainObject(entry.new_value)
  }));

  const tableOptions = [...defaultTableOptions, ...entries.map((entry) => entry.tableName)].filter(
    (value, index, source) => value.length > 0 && source.indexOf(value) === index
  );

  const response: AuditLogsResponseData = {
    entries,
    actors,
    actionOptions: [...AUDIT_LOG_ACTIONS],
    tableOptions,
    total: count ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };

  return jsonResponse<AuditLogsResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
