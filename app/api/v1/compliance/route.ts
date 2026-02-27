import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import {
  canManageCompliance,
  complianceUrgency,
  isComplianceCadence,
  isComplianceStatus
} from "../../../../lib/compliance";
import { normalizeUserRoles } from "../../../../lib/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import type {
  ComplianceDeadlineRecord,
  ComplianceResponseData
} from "../../../../types/compliance";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  startDate: z.string().regex(isoDateRegex).optional(),
  endDate: z.string().regex(isoDateRegex).optional()
});

const deadlineRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  due_date: z.string(),
  status: z.string(),
  assigned_to: z.string().uuid().nullable(),
  proof_document_id: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const itemRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string(),
  authority: z.string(),
  requirement: z.string(),
  description: z.string().nullable(),
  cadence: z.string(),
  category: z.string(),
  notes: z.string().nullable()
});

const assigneeRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const proofDocumentRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function isoDateFromNowOffset(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function compareDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function mapDeadlineRows({
  deadlines,
  itemsById,
  assigneesById,
  proofById
}: {
  deadlines: z.infer<typeof deadlineRowSchema>[];
  itemsById: ReadonlyMap<string, z.infer<typeof itemRowSchema>>;
  assigneesById: ReadonlyMap<string, z.infer<typeof assigneeRowSchema>>;
  proofById: ReadonlyMap<string, z.infer<typeof proofDocumentRowSchema>>;
}): ComplianceDeadlineRecord[] {
  const mapped: ComplianceDeadlineRecord[] = [];

  for (const deadline of deadlines) {
    const item = itemsById.get(deadline.item_id);

    if (!item) {
      continue;
    }

    const status = isComplianceStatus(deadline.status) ? deadline.status : "pending";
    const cadence = isComplianceCadence(item.cadence) ? item.cadence : "monthly";
    const urgency = complianceUrgency({
      status,
      dueDate: deadline.due_date
    });

    mapped.push({
      id: deadline.id,
      itemId: deadline.item_id,
      countryCode: item.country_code,
      authority: item.authority,
      requirement: item.requirement,
      description: item.description,
      cadence,
      category: item.category,
      itemNotes: item.notes,
      dueDate: deadline.due_date,
      status,
      urgency,
      assignedTo: deadline.assigned_to,
      assignedToName: deadline.assigned_to ? assigneesById.get(deadline.assigned_to)?.full_name ?? null : null,
      proofDocumentId: deadline.proof_document_id,
      proofDocumentTitle:
        deadline.proof_document_id
          ? proofById.get(deadline.proof_document_id)?.title ?? null
          : null,
      completedAt: deadline.completed_at,
      notes: deadline.notes,
      createdAt: deadline.created_at,
      updatedAt: deadline.updated_at
    });
  }

  return mapped.sort((left, right) => {
    const dueComparison = compareDate(left.dueDate, right.dueDate);

    if (dueComparison !== 0) {
      return dueComparison;
    }

    return left.requirement.localeCompare(right.requirement);
  });
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view compliance deadlines."
      },
      meta: buildMeta()
    });
  }

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!canManageCompliance(userRoles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin, Finance Admin, and Super Admin can access compliance."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid compliance query."
      },
      meta: buildMeta()
    });
  }

  const startDate = parsedQuery.data.startDate ?? isoDateFromNowOffset(-30);
  const endDate = parsedQuery.data.endDate ?? isoDateFromNowOffset(95);

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "startDate must be before or equal to endDate."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  const [
    { data: rawDeadlines, error: deadlinesError },
    { data: rawAssignees, error: assigneesError },
    { data: rawProofDocuments, error: proofDocumentsError }
  ] = await Promise.all([
    supabase
      .from("compliance_deadlines")
      .select(
        "id, item_id, due_date, status, assigned_to, proof_document_id, completed_at, notes, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .gte("due_date", startDate)
      .lte("due_date", endDate)
      .order("due_date", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true }),
    supabase
      .from("documents")
      .select("id, title")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200)
  ]);

  if (deadlinesError || assigneesError || proofDocumentsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_FETCH_FAILED",
        message: "Unable to load compliance data."
      },
      meta: buildMeta()
    });
  }

  const parsedDeadlines = z.array(deadlineRowSchema).safeParse(rawDeadlines ?? []);
  const parsedAssignees = z.array(assigneeRowSchema).safeParse(rawAssignees ?? []);
  const parsedProofDocuments = z.array(proofDocumentRowSchema).safeParse(rawProofDocuments ?? []);

  if (!parsedDeadlines.success || !parsedAssignees.success || !parsedProofDocuments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_PARSE_FAILED",
        message: "Compliance data is not in the expected format."
      },
      meta: buildMeta()
    });
  }

  const itemIds = [...new Set(parsedDeadlines.data.map((row) => row.item_id))];
  const { data: rawItems, error: itemsError } = itemIds.length
    ? await supabase
        .from("compliance_items")
        .select("id, country_code, authority, requirement, description, cadence, category, notes")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .in("id", itemIds)
    : { data: [], error: null };

  if (itemsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_FETCH_FAILED",
        message: "Unable to load compliance items."
      },
      meta: buildMeta()
    });
  }

  const parsedItems = z.array(itemRowSchema).safeParse(rawItems ?? []);

  if (!parsedItems.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPLIANCE_PARSE_FAILED",
        message: "Compliance item data is not in the expected format."
      },
      meta: buildMeta()
    });
  }

  const itemsById = new Map(parsedItems.data.map((item) => [item.id, item]));
  const assigneesById = new Map(parsedAssignees.data.map((row) => [row.id, row]));
  const proofById = new Map(parsedProofDocuments.data.map((row) => [row.id, row]));
  const deadlines = mapDeadlineRows({
    deadlines: parsedDeadlines.data,
    itemsById,
    assigneesById,
    proofById
  });

  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    overdueCount: deadlines.filter((row) => row.urgency === "overdue").length,
    dueSoonCount: deadlines.filter((row) => row.urgency === "due_soon").length,
    upcomingCount: deadlines.filter((row) => row.urgency === "upcoming").length,
    completedCount: deadlines.filter((row) => row.urgency === "completed").length,
    nextDeadline:
      deadlines.find((row) => row.status !== "completed" && row.dueDate >= today) ?? null
  };

  const responseData: ComplianceResponseData = {
    dateRange: {
      startDate,
      endDate
    },
    summary,
    deadlines,
    assignees: parsedAssignees.data.map((row) => ({
      id: row.id,
      fullName: row.full_name
    })),
    proofDocuments: parsedProofDocuments.data.map((row) => ({
      id: row.id,
      title: row.title
    }))
  };

  return jsonResponse<ComplianceResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
