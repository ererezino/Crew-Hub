import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import type { ApiResponse } from "../../../../../types/auth";

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canManageCompensation(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function canApproveCompensation(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "SUPER_ADMIN");
}

export async function ensureEmployeeInOrg({
  supabase,
  orgId,
  employeeId
}: {
  supabase: SupabaseClient;
  orgId: string;
  employeeId: string;
}): Promise<{ id: string; fullName: string } | null> {
  const { data: employeeRow, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !employeeRow) {
    return null;
  }

  return {
    id: employeeRow.id,
    fullName: employeeRow.full_name
  };
}

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function parseIntegerValue(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      return null;
    }

    return value;
  }

  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

export function parseDecimalValue(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  if (!/^\d+(\.\d{1,4})?$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function ensureEffectiveWindow(
  effectiveFrom: string,
  effectiveTo: string | null
): boolean {
  if (!effectiveTo) {
    return true;
  }

  return effectiveTo >= effectiveFrom;
}
