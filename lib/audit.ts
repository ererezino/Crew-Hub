import "server-only";

import { headers } from "next/headers";

import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseServiceRoleClient } from "./supabase/service-role";

export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "approved",
  "rejected",
  "submitted",
  "cancelled",
  "login",
  "logout"
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
