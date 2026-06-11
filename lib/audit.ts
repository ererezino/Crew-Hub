import "server-only";

import { headers } from "next/headers";

import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseServiceRoleClient } from "./supabase/service-role";

/**
 * Builds field-level audit payloads: compares two camelCase records and
 * returns only the fields that changed, paired as oldValue/newValue. This is
 * the standard shape for `logAudit` on mutations — auditors need
 * "baseSalaryAmount: 5000000 → 5500000", not a snapshot of the new row.
 *
 * Values are compared structurally (JSON), so arrays/objects work. Fields
 * absent from one side diff against null.
 */
export function diffAuditValues(
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>
): {
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  changedFields: string[];
} {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const keys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);

  for (const key of keys) {
    const before = oldRecord[key] === undefined ? null : oldRecord[key];
    const after = newRecord[key] === undefined ? null : newRecord[key];

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      oldValue[key] = before;
      newValue[key] = after;
      changedFields.push(key);
    }
  }

  return { oldValue, newValue, changedFields };
}

/**
 * Marker for sensitive values whose CHANGE must be auditable but whose
 * CONTENT must not be persisted in the audit log (document URLs, government
 * IDs). Use `value ? AUDIT_REDACTED : null` on both sides of a diff.
 */
export const AUDIT_REDACTED = "[redacted]";

export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "approved",
  "rejected",
  "submitted",
  "cancelled",
  "login",
  "logout",
  "failed_login"
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

type LogAuditParams = {
  action: AuditAction;
  tableName: string;
  recordId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
};

type AuditContext = {
  actorUserId: string | null;
  orgId: string | null;
  ipAddress: string | null;
};

function extractFirstIp(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const firstValue = rawValue.split(",")[0]?.trim();
  if (!firstValue) {
    return null;
  }

  if (firstValue.includes(".") && firstValue.includes(":")) {
    return firstValue.split(":")[0] ?? null;
  }

  return firstValue.replace(/^\[/, "").replace(/\]$/, "") || null;
}

async function resolveIpAddress(): Promise<string | null> {
  const headerStore = await headers();

  const possibleValues = [
    headerStore.get("x-forwarded-for"),
    headerStore.get("x-real-ip"),
    headerStore.get("cf-connecting-ip"),
    headerStore.get("x-vercel-forwarded-for")
  ];

  for (const value of possibleValues) {
    const ipAddress = extractFirstIp(value);
    if (ipAddress) {
      return ipAddress;
    }
  }

  return null;
}

async function resolveAuditContext(): Promise<AuditContext> {
  const ipAddress = await resolveIpAddress();

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      actorUserId: null,
      orgId: null,
      ipAddress
    };
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .is("deleted_at", null)
    .single();

  if (profileError || !profileData?.org_id) {
    return {
      actorUserId: user.id,
      orgId: null,
      ipAddress
    };
  }

  return {
    actorUserId: user.id,
    orgId: profileData.org_id,
    ipAddress
  };
}

export async function logAudit({
  action,
  tableName,
  recordId = null,
  oldValue = null,
  newValue = null
}: LogAuditParams): Promise<void> {
  try {
    const { actorUserId, orgId, ipAddress } = await resolveAuditContext();

    if (!actorUserId || !orgId) {
      console.error("Audit context is missing actor or org.", {
        action,
        tableName,
        recordId,
        actorUserId,
        orgId
      });
      return;
    }

    const serviceRoleClient = createSupabaseServiceRoleClient();

    const { error } = await serviceRoleClient.from("audit_log").insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action,
      table_name: tableName,
      record_id: recordId,
      old_value: oldValue,
      new_value: newValue,
      ip_address: ipAddress,
      created_at: new Date().toISOString()
    });

    if (error) {
      console.error("Failed to write audit log entry.", {
        action,
        tableName,
        recordId,
        message: error.message
      });
    }
  } catch (error) {
    console.error("Unexpected audit logging error.", {
      action,
      tableName,
      recordId,
      error
    });
  }
}

/**
 * Write many audit entries in one call. Resolves the actor context once and
 * performs a single multi-row insert — use for bulk operations where calling
 * logAudit per record would repeat the auth + profile lookups N times.
 */
export async function logAuditBatch(records: LogAuditParams[]): Promise<void> {
  if (records.length === 0) {
    return;
  }

  try {
    const { actorUserId, orgId, ipAddress } = await resolveAuditContext();

    if (!actorUserId || !orgId) {
      console.error("Audit context is missing actor or org for batch.", {
        count: records.length,
        actorUserId,
        orgId
      });
      return;
    }

    const serviceRoleClient = createSupabaseServiceRoleClient();
    const createdAt = new Date().toISOString();

    const { error } = await serviceRoleClient.from("audit_log").insert(
      records.map((record) => ({
        org_id: orgId,
        actor_user_id: actorUserId,
        action: record.action,
        table_name: record.tableName,
        record_id: record.recordId ?? null,
        old_value: record.oldValue ?? null,
        new_value: record.newValue ?? null,
        ip_address: ipAddress,
        created_at: createdAt
      }))
    );

    if (error) {
      console.error("Failed to write audit log batch.", {
        count: records.length,
        message: error.message
      });
    }
  } catch (error) {
    console.error("Unexpected audit batch logging error.", {
      count: records.length,
      error
    });
  }
}
