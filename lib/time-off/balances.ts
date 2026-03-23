import "server-only";

import { z } from "zod";

import { parseNumeric } from "../time-off";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

const leaveBalanceRowSchema = z.object({
  id: z.string().uuid(),
  total_days: z.union([z.number(), z.string()]),
  used_days: z.union([z.number(), z.string()]),
  pending_days: z.union([z.number(), z.string()]),
  carried_days: z.union([z.number(), z.string()])
});

export type LeaveBalanceAvailability = {
  balanceId: string | null;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  carriedDays: number;
  availableDays: number;
};

export async function fetchLeaveBalanceAvailability({
  orgId,
  employeeId,
  leaveType,
  year,
  fallbackTotalDays = 0
}: {
  orgId: string;
  employeeId: string;
  leaveType: string;
  year: number;
  fallbackTotalDays?: number;
}): Promise<LeaveBalanceAvailability> {
  const serviceClient = createSupabaseServiceRoleClient();

  const { data: rawBalance, error: balanceFetchError } = await serviceClient
    .from("leave_balances")
    .select("id, total_days, used_days, pending_days, carried_days")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("leave_type", leaveType)
    .eq("year", year)
    .is("deleted_at", null)
    .maybeSingle();

  if (balanceFetchError) {
    throw new Error(`Unable to load leave balance: ${balanceFetchError.message}`);
  }

  if (!rawBalance) {
    const totalDays = Math.max(0, fallbackTotalDays);

    return {
      balanceId: null,
      totalDays,
      usedDays: 0,
      pendingDays: 0,
      carriedDays: 0,
      availableDays: totalDays
    };
  }

  const parsedBalance = leaveBalanceRowSchema.safeParse(rawBalance);

  if (!parsedBalance.success) {
    throw new Error("Existing leave balance data is not in the expected shape.");
  }

  const totalDays = parseNumeric(parsedBalance.data.total_days);
  const usedDays = parseNumeric(parsedBalance.data.used_days);
  const pendingDays = parseNumeric(parsedBalance.data.pending_days);
  const carriedDays = parseNumeric(parsedBalance.data.carried_days);

  return {
    balanceId: parsedBalance.data.id,
    totalDays,
    usedDays,
    pendingDays,
    carriedDays,
    availableDays: totalDays + carriedDays - usedDays - pendingDays
  };
}

export async function applyPendingBalanceDelta({
  orgId,
  employeeId,
  leaveType,
  year,
  pendingDaysDelta,
  fallbackTotalDays
}: {
  orgId: string;
  employeeId: string;
  leaveType: string;
  year: number;
  pendingDaysDelta: number;
  fallbackTotalDays: number;
}): Promise<void> {
  const serviceClient = createSupabaseServiceRoleClient();

  const availability = await fetchLeaveBalanceAvailability({
    orgId,
    employeeId,
    leaveType,
    year,
    fallbackTotalDays
  });

  if (!availability.balanceId) {
    const nextPendingDays = Math.max(0, pendingDaysDelta);
    const { error: balanceInsertError } = await serviceClient.from("leave_balances").insert({
      org_id: orgId,
      employee_id: employeeId,
      leave_type: leaveType,
      year,
      total_days: Math.max(0, fallbackTotalDays),
      used_days: 0,
      pending_days: nextPendingDays,
      carried_days: 0
    });

    if (balanceInsertError) {
      throw new Error(`Unable to create leave balance: ${balanceInsertError.message}`);
    }

    return;
  }

  const nextPendingDays = Math.max(0, availability.pendingDays + pendingDaysDelta);

  const { error: balanceUpdateError } = await serviceClient
    .from("leave_balances")
    .update({
      pending_days: nextPendingDays
    })
    .eq("id", availability.balanceId)
    .eq("org_id", orgId);

  if (balanceUpdateError) {
    throw new Error(`Unable to update leave balance: ${balanceUpdateError.message}`);
  }
}
