import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasAnyRole, hasRole } from "../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import type { UserRole } from "../../../../lib/navigation";

type SearchResultType = "person" | "document" | "policy" | "expense" | "leave";

type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  url: string;
};

type SearchResponseData = {
  results: SearchResult[];
};

type ApiMeta = {
  timestamp: string;
};

function buildMeta(): ApiMeta {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

const PER_CATEGORY_LIMIT = 3;
const searchQuerySchema = z.object({
  q: z.string().trim().max(200, "Search query is too long.").default("")
});

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to search."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = searchQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? ""
  });

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid search query."
      },
      meta: buildMeta()
    });
  }

  const q = parsedQuery.data.q;

  if (q.length < 2) {
    return jsonResponse<SearchResponseData>(200, {
      data: { results: [] },
      error: null,
      meta: buildMeta()
    });
  }

  const searchTerm = `%${q}%`;
  const profile = session.profile;
  const roles: readonly UserRole[] = profile.roles;
  const isAdmin = hasAnyRole(roles, ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"]);
  const isManager = hasRole(roles, "MANAGER");

  const supabase = await createSupabaseServerClient();
  const orgId = profile.org_id;

  const [people, documents, policies, expenses, leaves] = await Promise.all([
    // People search - all authenticated users can search profiles
    supabase
      .from("profiles")
      .select("id, full_name, email, job_title")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .or(
        `full_name.ilike.${searchTerm},email.ilike.${searchTerm},job_title.ilike.${searchTerm}`
      )
      .limit(PER_CATEGORY_LIMIT)
      .then(({ data, error }) => {
        if (error || !data) return [];
        return data.map(
          (p: {
            id: string;
            full_name: string | null;
            email: string | null;
            job_title: string | null;
          }): SearchResult => ({
            id: p.id,
            type: "person",
            title: p.full_name || p.email || "Unknown",
            subtitle: p.job_title || p.email || "",
            url: `/people/${p.id}`
          })
        );
      }),

    // Documents search - all users can see shared docs
    supabase
      .from("documents")
      .select("id, title, category")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .ilike("title", searchTerm)
      .limit(PER_CATEGORY_LIMIT)
      .then(({ data, error }) => {
        if (error || !data) return [];
        return data.map(
          (d: {
            id: string;
            title: string;
            category: string | null;
          }): SearchResult => ({
            id: d.id,
            type: "document",
            title: d.title,
            subtitle: d.category || "Document",
            url: "/documents"
          })
        );
      }),

    // Compliance policies search - all users
    supabase
      .from("compliance_policies")
      .select("id, name, category")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .ilike("name", searchTerm)
      .limit(PER_CATEGORY_LIMIT)
      .then(({ data, error }) => {
        if (error || !data) return [];
        return data.map(
          (p: {
            id: string;
            name: string;
            category: string | null;
          }): SearchResult => ({
            id: p.id,
            type: "policy",
            title: p.name,
            subtitle: p.category || "Policy",
            url: "/compliance"
          })
        );
      }),

    // Expenses search - own expenses unless admin
    supabase
      .from("expenses")
      .select("id, employee_id, description, amount, currency, status")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .ilike("description", searchTerm)
      .limit(isAdmin ? PER_CATEGORY_LIMIT : 20)
      .then(({ data, error }) => {
        if (error || !data) return [];
        let filtered = data as Array<{
          id: string;
          employee_id: string;
          description: string | null;
          amount: number | string | null;
          currency: string | null;
          status: string | null;
        }>;
        if (!isAdmin) {
          filtered = filtered.filter((e) => e.employee_id === profile.id);
        }
        return filtered.slice(0, PER_CATEGORY_LIMIT).map(
          (e): SearchResult => {
            const amountValue =
              typeof e.amount === "number"
                ? e.amount
                : typeof e.amount === "string"
                  ? Number.parseInt(e.amount, 10)
                  : 0;
            const currency = e.currency || "USD";
            const formatted = `${currency} ${(amountValue / 100).toFixed(2)}`;
            return {
              id: e.id,
              type: "expense",
              title: e.description || "Expense",
              subtitle: `${formatted} - ${e.status || "unknown"}`,
              url: "/expenses"
            };
          }
        );
      }),

    // Leave requests search - own unless admin/manager
    supabase
      .from("leave_requests")
      .select("id, employee_id, leave_type, start_date, end_date, status")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .ilike("leave_type", searchTerm)
      .limit(isAdmin || isManager ? PER_CATEGORY_LIMIT : 20)
      .then(({ data, error }) => {
        if (error || !data) return [];
        let filtered = data as Array<{
          id: string;
          employee_id: string;
          leave_type: string | null;
          start_date: string | null;
          end_date: string | null;
          status: string | null;
        }>;
        if (!isAdmin && !isManager) {
          filtered = filtered.filter((l) => l.employee_id === profile.id);
        }
        return filtered.slice(0, PER_CATEGORY_LIMIT).map(
          (l): SearchResult => ({
            id: l.id,
            type: "leave",
            title: `${l.leave_type || "Leave"} Request`,
            subtitle: `${l.start_date || ""} to ${l.end_date || ""} - ${l.status || "unknown"}`,
            url: "/time-off"
          })
        );
      })
  ]);

  const results: SearchResult[] = [
    ...people,
    ...documents,
    ...policies,
    ...expenses,
    ...leaves
  ];

  return jsonResponse<SearchResponseData>(200, {
    data: { results },
    error: null,
    meta: buildMeta()
  });
}
