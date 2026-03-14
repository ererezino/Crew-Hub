import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Types ── */

export interface HealthAlert {
  key: string;
  label: string;
  count: number;
  severity: "error" | "warning" | "info";
  href: string;
  icon: string;
}

/* ── Helpers ── */

function toDateString(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Return a check-failure alert when a health check cannot complete.
 * The admin sees this as an error-severity alert, making it impossible
 * to confuse "no issues found" with "the system couldn't check."
 */
function checkFailedAlert(checkKey: string, description: string): HealthAlert {
  return {
    key: `check_failed_${checkKey}`,
    label: `Unable to check: ${description}`,
    count: 0,
    severity: "error",
    href: "#",
    icon: "AlertTriangle"
  };
}

/* ── Individual checks ── */

async function checkContractorsMissingPayout(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert | null> {
  try {
    // Get active contractors
    const { data: contractors, error: contractorsError } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "active")
      .eq("employment_type", "contractor")
      .is("deleted_at", null);

    if (contractorsError) {
      return checkFailedAlert("contractors_missing_payout", "contractors missing payout method");
    }

    if (!contractors || contractors.length === 0) return null;

    const contractorIds = contractors.map((c) => c.id);

    // Get contractors that have a primary payment detail
    const { data: withPayment, error: paymentError } = await supabase
      .from("employee_payment_details")
      .select("employee_id")
      .in("employee_id", contractorIds)
      .eq("is_primary", true)
      .is("deleted_at", null);

    if (paymentError) {
      return checkFailedAlert("contractors_missing_payout", "contractors missing payout method");
    }

    const paidIds = new Set((withPayment ?? []).map((p) => p.employee_id));
    const missingCount = contractorIds.filter((id) => !paidIds.has(id)).length;

    if (missingCount === 0) return null;

    return {
      key: "contractors_missing_payout",
      label: `Contractor${missingCount !== 1 ? "s" : ""} missing payout method`,
      count: missingCount,
      severity: "error",
      href: "/people?filter=missing_payout",
      icon: "AlertTriangle"
    };
  } catch {
    return checkFailedAlert("contractors_missing_payout", "contractors missing payout method");
  }
}

async function checkStaleOnboarding(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert | null> {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = toDateString(threeDaysAgo);

    const { data, error } = await supabase
      .from("onboarding_instances")
      .select("id, updated_at")
      .eq("org_id", orgId)
      .eq("status", "in_progress")
      .is("deleted_at", null)
      .lte("updated_at", threeDaysAgoStr);

    if (error || !data) {
      return checkFailedAlert("stale_onboarding", "stale onboarding instances");
    }

    const staleCount = data.length;
    if (staleCount === 0) return null;

    return {
      key: "stale_onboarding",
      label: `Stale onboarding (3+ days inactive)`,
      count: staleCount,
      severity: "warning",
      href: "/onboarding",
      icon: "UserX"
    };
  } catch {
    return checkFailedAlert("stale_onboarding", "stale onboarding instances");
  }
}

async function checkComplianceDeadlines(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert | null> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const fourteenDaysLater = new Date(now);
    fourteenDaysLater.setDate(fourteenDaysLater.getDate() + 14);
    const fourteenDaysLaterStr = toDateString(fourteenDaysLater);

    const { count, error } = await supabase
      .from("compliance_deadlines")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .neq("status", "completed")
      .gte("due_date", today)
      .lte("due_date", fourteenDaysLaterStr)
      .is("deleted_at", null);

    if (error) {
      return checkFailedAlert("compliance_due_soon", "compliance deadlines");
    }

    if (!count || count === 0) return null;

    return {
      key: "compliance_due_soon",
      label: `Compliance deadline${count !== 1 ? "s" : ""} due within 14 days`,
      count,
      severity: "warning",
      href: "/compliance",
      icon: "ShieldAlert"
    };
  } catch {
    return checkFailedAlert("compliance_due_soon", "compliance deadlines");
  }
}

async function checkStuckExpenses(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert | null> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = toDateString(sevenDaysAgo);

    const { count, error } = await supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "manager_approved")
      .lte("updated_at", sevenDaysAgoStr)
      .is("deleted_at", null);

    if (error) {
      return checkFailedAlert("expenses_stuck", "stuck expenses");
    }

    if (!count || count === 0) return null;

    return {
      key: "expenses_stuck",
      label: `Expense${count !== 1 ? "s" : ""} stuck 7+ days after manager approval`,
      count,
      severity: "warning",
      href: "/expenses/approvals",
      icon: "Receipt"
    };
  } catch {
    return checkFailedAlert("expenses_stuck", "stuck expenses");
  }
}

async function checkExpiringDocuments(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert | null> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    const thirtyDaysLaterStr = toDateString(thirtyDaysLater);

    const { count, error } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("expiry_date", today)
      .lte("expiry_date", thirtyDaysLaterStr)
      .is("deleted_at", null);

    if (error) {
      return checkFailedAlert("documents_expiring", "expiring documents");
    }

    if (!count || count === 0) return null;

    return {
      key: "documents_expiring",
      label: `Document${count !== 1 ? "s" : ""} expiring within 30 days`,
      count,
      severity: "info",
      href: "/documents?tab=expiring_soon",
      icon: "FileWarning"
    };
  } catch {
    return checkFailedAlert("documents_expiring", "expiring documents");
  }
}

/* ── Main function ── */

const SEVERITY_ORDER: Record<HealthAlert["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2
};

export async function getOrgHealthAlerts(
  supabase: SupabaseClient,
  orgId: string
): Promise<HealthAlert[]> {
  const results = await Promise.all([
    checkContractorsMissingPayout(supabase, orgId),
    checkStaleOnboarding(supabase, orgId),
    checkComplianceDeadlines(supabase, orgId),
    checkStuckExpenses(supabase, orgId),
    checkExpiringDocuments(supabase, orgId)
  ]);

  return results
    .filter((alert): alert is HealthAlert => alert !== null)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
