import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";

/* ---- Types ---- */

type LeaveOverview = {
  days_used: number;
  days_remaining: number;
  pending_requests: number;
};

type PerformanceOverview = {
  latest_cycle: string | null;
  self_rating: number | null;
  manager_rating: number | null;
  status: string | null;
};

type OnboardingOverview = {
  status: string | null;
  progress_percent: number;
  days_since_start: number | null;
} | null;

type ExpensesOverview = {
  pending_amount: number;
  approved_amount: number;
  total_submitted: number;
};

type DocumentsOverview = {
  total: number;
  pending_signature: number;
  expiring_soon: number;
};

type Employee360Data = {
  leave: LeaveOverview;
  performance: PerformanceOverview;
  onboarding: OnboardingOverview;
  expenses: ExpensesOverview;
  documents: DocumentsOverview;
};

/* ---- Helpers ---- */

const paramsSchema = z.object({
  employeeId: z.string().uuid("Employee id must be a valid UUID.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateString(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/* ---- Per-section query functions ---- */

type SupabaseClient = ReturnType<typeof createSupabaseServiceRoleClient>;

async function queryLeave(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<LeaveOverview> {
  try {
    const currentYear = new Date().getFullYear();

    const [balancesResult, pendingResult] = await Promise.all([
      supabase
        .from("leave_balances")
        .select("total_days, used_days, pending_days, carried_days")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("year", currentYear)
        .is("deleted_at", null),
      supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("status", "pending")
        .is("deleted_at", null)
    ]);

    const balances = balancesResult.data ?? [];

    let totalAllocated = 0;
    let totalUsed = 0;

    for (const row of balances) {
      totalAllocated += toNumber(row.total_days) + toNumber(row.carried_days);
      totalUsed += toNumber(row.used_days) + toNumber(row.pending_days);
    }

    return {
      days_used: Math.round(totalUsed),
      days_remaining: Math.max(0, Math.round(totalAllocated - totalUsed)),
      pending_requests: pendingResult.count ?? 0
    };
  } catch {
    return { days_used: 0, days_remaining: 0, pending_requests: 0 };
  }
}

async function queryPerformance(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<PerformanceOverview> {
  try {
    // Get latest active or completed cycle
    const { data: cycles } = await supabase
      .from("review_cycles")
      .select("id, name, status")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("status", ["active", "in_review", "completed"])
      .order("start_date", { ascending: false })
      .limit(1);

    const latestCycle = cycles?.[0] ?? null;

    if (!latestCycle) {
      return {
        latest_cycle: null,
        self_rating: null,
        manager_rating: null,
        status: null
      };
    }

    // Get assignment for this employee in the latest cycle
    const { data: assignments } = await supabase
      .from("review_assignments")
      .select("id, status, template_id")
      .eq("org_id", orgId)
      .eq("cycle_id", latestCycle.id)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .limit(1);

    const assignment = assignments?.[0] ?? null;

    if (!assignment) {
      return {
        latest_cycle: latestCycle.name ?? null,
        self_rating: null,
        manager_rating: null,
        status: latestCycle.status ?? null
      };
    }

    // Get self and manager responses
    const { data: responses } = await supabase
      .from("review_responses")
      .select("response_type, answers")
      .eq("assignment_id", assignment.id)
      .is("deleted_at", null)
      .not("submitted_at", "is", null);

    // Get template sections to identify rating questions
    const { data: templates } = await supabase
      .from("review_templates")
      .select("sections")
      .eq("id", assignment.template_id)
      .is("deleted_at", null)
      .limit(1);

    const templateSections = templates?.[0]?.sections;
    const sections = Array.isArray(templateSections) ? templateSections : [];

    // Build set of rating question IDs
    const ratingQuestionIds = new Set<string>();
    for (const section of sections) {
      const sectionObj = section as Record<string, unknown>;
      const questions = Array.isArray(sectionObj.questions) ? sectionObj.questions : [];
      for (const q of questions) {
        const questionObj = q as Record<string, unknown>;
        if (questionObj.type === "rating" && typeof questionObj.id === "string") {
          ratingQuestionIds.add(questionObj.id);
        }
      }
    }

    let selfRating: number | null = null;
    let managerRating: number | null = null;

    for (const resp of responses ?? []) {
      const respType = resp.response_type as string;
      const answers = resp.answers as Record<string, { rating?: number | null; text?: string | null }> | null;

      if (!answers || typeof answers !== "object") continue;

      // Compute average rating
      let total = 0;
      let count = 0;

      for (const [qId, answer] of Object.entries(answers)) {
        if (ratingQuestionIds.size > 0 && !ratingQuestionIds.has(qId)) continue;
        if (answer && typeof answer.rating === "number" && Number.isFinite(answer.rating)) {
          total += answer.rating;
          count += 1;
        }
      }

      const avgRating = count > 0 ? Math.round((total / count) * 10) / 10 : null;

      if (respType === "self") {
        selfRating = avgRating;
      } else if (respType === "manager") {
        managerRating = avgRating;
      }
    }

    return {
      latest_cycle: latestCycle.name ?? null,
      self_rating: selfRating,
      manager_rating: managerRating,
      status: (assignment.status as string) ?? null
    };
  } catch {
    return {
      latest_cycle: null,
      self_rating: null,
      manager_rating: null,
      status: null
    };
  }
}

async function queryOnboarding(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<OnboardingOverview> {
  try {
    const { data: instances } = await supabase
      .from("onboarding_instances")
      .select("id, status, started_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("type", "onboarding")
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);

    const instance = instances?.[0] ?? null;

    if (!instance) {
      return null;
    }

    // Get tasks to compute progress
    const { data: tasks } = await supabase
      .from("onboarding_tasks")
      .select("id, status")
      .eq("instance_id", instance.id)
      .is("deleted_at", null);

    const taskList = tasks ?? [];
    const total = taskList.length;
    const completed = taskList.filter((t) => t.status === "completed").length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    let daysSinceStart: number | null = null;
    if (instance.started_at) {
      const started = new Date(instance.started_at as string);
      const now = new Date();
      daysSinceStart = Math.max(
        0,
        Math.floor((now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    return {
      status: (instance.status as string) ?? null,
      progress_percent: progressPercent,
      days_since_start: daysSinceStart
    };
  } catch {
    return null;
  }
}

async function queryExpenses(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<ExpensesOverview> {
  try {
    const { data: expenses } = await supabase
      .from("expenses")
      .select("amount, status")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null);

    const rows = expenses ?? [];

    let pendingAmount = 0;
    let approvedAmount = 0;
    let totalSubmitted = 0;

    for (const row of rows) {
      const amount = toNumber(row.amount);
      const status = row.status as string;
      totalSubmitted += 1;

      if (status === "pending" || status === "manager_approved") {
        pendingAmount += amount;
      } else if (status === "approved" || status === "reimbursed") {
        approvedAmount += amount;
      }
    }

    return {
      pending_amount: Math.trunc(pendingAmount),
      approved_amount: Math.trunc(approvedAmount),
      total_submitted: totalSubmitted
    };
  } catch {
    return { pending_amount: 0, approved_amount: 0, total_submitted: 0 };
  }
}

async function queryDocuments(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<DocumentsOverview> {
  try {
    const today = toDateString(new Date());
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    const thirtyDaysLaterStr = toDateString(thirtyDaysLater);

    const [docsResult, signaturesResult, expiringResult] = await Promise.all([
      // Total documents owned by this employee
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("owner_user_id", employeeId)
        .is("deleted_at", null),
      // Pending signatures for this employee
      supabase
        .from("signature_signers")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("signer_user_id", employeeId)
        .eq("status", "pending")
        .is("deleted_at", null),
      // Documents expiring within 30 days
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("owner_user_id", employeeId)
        .gte("expiry_date", today)
        .lte("expiry_date", thirtyDaysLaterStr)
        .is("deleted_at", null)
    ]);

    return {
      total: docsResult.count ?? 0,
      pending_signature: signaturesResult.count ?? 0,
      expiring_soon: expiringResult.count ?? 0
    };
  } catch {
    return { total: 0, pending_signature: 0, expiring_soon: 0 };
  }
}

/* ---- Main handler ---- */

export async function GET(
  _request: Request,
  context: { params: Promise<{ employeeId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view the employee overview."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedParams.error.issues[0]?.message ?? "Invalid employee id."
      },
      meta: buildMeta()
    });
  }

  const employeeId = parsedParams.data.employeeId;

  // Authorization: must be HR_ADMIN, SUPER_ADMIN, MANAGER, or the employee themselves
  const isSelf = employeeId === session.profile.id;
  const isHrAdmin = hasRole(session.profile.roles, "HR_ADMIN");
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isManager = hasRole(session.profile.roles, "MANAGER");

  if (!isSelf && !isHrAdmin && !isSuperAdmin && !isManager) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to view this employee overview."
      },
      meta: buildMeta()
    });
  }

  // For managers, verify they manage this employee (unless they're also an admin)
  if (isManager && !isSelf && !isHrAdmin && !isSuperAdmin) {
    const supabaseCheck = createSupabaseServiceRoleClient();
    const { data: targetProfile } = await supabaseCheck
      .from("profiles")
      .select("manager_id")
      .eq("id", employeeId)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!targetProfile || targetProfile.manager_id !== session.profile.id) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You can only view the overview for your direct reports."
        },
        meta: buildMeta()
      });
    }
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const orgId = session.profile.org_id;

    // Run all 5 queries in parallel
    const [leave, performance, onboarding, expenses, documents] = await Promise.all([
      queryLeave(supabase, orgId, employeeId),
      queryPerformance(supabase, orgId, employeeId),
      queryOnboarding(supabase, orgId, employeeId),
      queryExpenses(supabase, orgId, employeeId),
      queryDocuments(supabase, orgId, employeeId)
    ]);

    const data: Employee360Data = {
      leave,
      performance,
      onboarding,
      expenses,
      documents
    };

    return jsonResponse<Employee360Data>(200, {
      data,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OVERVIEW_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load employee overview."
      },
      meta: buildMeta()
    });
  }
}
