import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { canManageCompliance } from "../../../../../lib/compliance";
import { normalizeUserRoles } from "../../../../../lib/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { GenerateDeadlinesData } from "../../../../../types/compliance";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

const bodySchema = z.object({
  year: z
    .number()
    .int()
    .min(2020)
    .max(2100)
});

type ComplianceItemRow = {
  id: string;
  country_code: string;
  cadence: string;
  description: string | null;
};

/**
 * Parses a compliance item's description to find a specific due date pattern.
 * Looks for patterns like "Due by March 31", "Due by the 10th", "Due by May 31",
 * "Due by June 30", "Due by January 15", "Due by end of February", etc.
 */
function parseDueDateFromDescription(
  description: string | null,
  year: number
): { month: number; day: number } | null {
  if (!description) return null;

  const monthNames: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11
  };

  // "Due by end of February" → last day of Feb
  const endOfMatch = description.match(
    /due\s+(?:by\s+)?(?:the\s+)?end\s+of\s+(\w+)/i
  );
  if (endOfMatch) {
    const monthName = endOfMatch[1].toLowerCase();
    const monthNum = monthNames[monthName];
    if (monthNum !== undefined) {
      // Day 0 of next month = last day of this month
      const lastDay = new Date(year, monthNum + 1, 0).getDate();
      return { month: monthNum, day: lastDay };
    }
  }

  // "Due by March 31", "Due by the 15th of the following month"
  const monthDayMatch = description.match(
    /due\s+(?:by\s+)?(?:the\s+)?(\w+)\s+(\d{1,2})/i
  );
  if (monthDayMatch) {
    const monthName = monthDayMatch[1].toLowerCase();
    const dayNum = parseInt(monthDayMatch[2], 10);
    const monthNum = monthNames[monthName];
    if (monthNum !== undefined && dayNum >= 1 && dayNum <= 31) {
      return { month: monthNum, day: dayNum };
    }
  }

  // "Due by January 15" — alternate order
  const altMatch = description.match(
    /due\s+(?:by\s+)?(\w+)\s+(\d{1,2})\b/i
  );
  if (altMatch) {
    const monthName = altMatch[1].toLowerCase();
    const dayNum = parseInt(altMatch[2], 10);
    const monthNum = monthNames[monthName];
    if (monthNum !== undefined && dayNum >= 1 && dayNum <= 31) {
      return { month: monthNum, day: dayNum };
    }
  }

  return null;
}

/**
 * Extract the monthly "due by the Nth" day from the description.
 * Returns the day of month, e.g., 10, 15, 9, 14, etc.
 */
function parseMonthlyDueDay(description: string | null): number {
  if (!description) return 10;

  // "Due by the 10th of the following month"
  const nthMatch = description.match(/due\s+(?:by\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)/i);
  if (nthMatch) {
    const day = parseInt(nthMatch[1], 10);
    if (day >= 1 && day <= 28) return day;
  }

  // "Due by the 15th"
  const simpleMatch = description.match(/due\s+(?:by\s+)?(\d{1,2})(?:st|nd|rd|th)/i);
  if (simpleMatch) {
    const day = parseInt(simpleMatch[1], 10);
    if (day >= 1 && day <= 28) return day;
  }

  return 10; // default
}

function toIsoDate(year: number, month: number, day: number): string {
  // Clamp day to valid range for the month
  const maxDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(day, maxDay);
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(safeDay).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function generateDueDates(
  item: ComplianceItemRow,
  year: number
): string[] {
  const cadence = item.cadence;

  switch (cadence) {
    case "monthly": {
      const dueDay = parseMonthlyDueDay(item.description);
      const dates: string[] = [];
      for (let month = 0; month < 12; month++) {
        // Monthly items are due in the following month
        // e.g., January period → due by Feb 10th
        const dueMonth = month + 1;
        if (dueMonth <= 11) {
          dates.push(toIsoDate(year, dueMonth, dueDay));
        } else {
          // December period → January next year
          dates.push(toIsoDate(year + 1, 0, dueDay));
        }
      }
      return dates;
    }

    case "quarterly": {
      // End of each quarter + standard offset (months are 0-indexed)
      return [
        toIsoDate(year, 2, 31),  // Q1: March 31
        toIsoDate(year, 5, 30),  // Q2: June 30
        toIsoDate(year, 8, 30),  // Q3: September 30
        toIsoDate(year, 11, 31)  // Q4: December 31
      ];
    }

    case "annual": {
      const parsed = parseDueDateFromDescription(item.description, year);
      if (parsed) {
        return [toIsoDate(year, parsed.month, parsed.day)];
      }
      // Fallback: December 31
      return [toIsoDate(year, 11, 31)];
    }

    case "ongoing": {
      // One record per year
      return [toIsoDate(year, 11, 31)];
    }

    case "one_time": {
      return [toIsoDate(year, 11, 31)];
    }

    default:
      return [];
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const roles = normalizeUserRoles(profile.roles);

  if (!canManageCompliance(roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can generate deadlines."
      },
      meta: buildMeta()
    });
  }

  let payloadValue: unknown;

  try {
    payloadValue = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsed = bodySchema.safeParse(payloadValue);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid payload."
      },
      meta: buildMeta()
    });
  }

  const { year } = parsed.data;

  try {
    const supabase = await createSupabaseServerClient();

    // 1. Get the countries represented in the org
    const { data: profileCountries, error: countriesError } = await supabase
      .from("profiles")
      .select("country_code")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .not("country_code", "is", null);

    if (countriesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "GENERATE_DEADLINES_FAILED",
          message: "Unable to determine org countries."
        },
        meta: buildMeta()
      });
    }

    const countryCodes = [
      ...new Set(
        (profileCountries ?? [])
          .map((row) => row.country_code)
          .filter((code): code is string => typeof code === "string" && code.length === 2)
      )
    ];

    if (countryCodes.length === 0) {
      return jsonResponse<GenerateDeadlinesData>(200, {
        data: { created: 0, skipped: 0 },
        error: null,
        meta: buildMeta()
      });
    }

    // 2. Fetch compliance items for those countries
    const { data: items, error: itemsError } = await supabase
      .from("compliance_items")
      .select("id, country_code, cadence, description")
      .eq("org_id", profile.org_id)
      .in("country_code", countryCodes)
      .is("deleted_at", null);

    if (itemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "GENERATE_DEADLINES_FAILED",
          message: "Unable to fetch compliance items."
        },
        meta: buildMeta()
      });
    }

    if (!items || items.length === 0) {
      return jsonResponse<GenerateDeadlinesData>(200, {
        data: { created: 0, skipped: 0 },
        error: null,
        meta: buildMeta()
      });
    }

    // 3. Generate deadline records for each item
    const deadlineRows: Array<{
      item_id: string;
      org_id: string;
      due_date: string;
      status: string;
    }> = [];

    for (const item of items) {
      const typedItem: ComplianceItemRow = {
        id: item.id as string,
        country_code: item.country_code as string,
        cadence: item.cadence as string,
        description: (item.description as string | null) ?? null
      };

      const dueDates = generateDueDates(typedItem, year);

      for (const dueDate of dueDates) {
        deadlineRows.push({
          item_id: typedItem.id,
          org_id: profile.org_id,
          due_date: dueDate,
          status: "pending"
        });
      }
    }

    if (deadlineRows.length === 0) {
      return jsonResponse<GenerateDeadlinesData>(200, {
        data: { created: 0, skipped: 0 },
        error: null,
        meta: buildMeta()
      });
    }

    // 4. Insert with ON CONFLICT DO NOTHING (batch in chunks of 500)
    let totalCreated = 0;
    const chunkSize = 500;

    for (let i = 0; i < deadlineRows.length; i += chunkSize) {
      const chunk = deadlineRows.slice(i, i + chunkSize);

      const { data: insertedRows, error: insertError } = await supabase
        .from("compliance_deadlines")
        .upsert(chunk, {
          onConflict: "item_id,due_date",
          ignoreDuplicates: true
        })
        .select("id");

      if (insertError) {
        console.error("Deadline insert error:", insertError.message);
        // Continue with remaining chunks
        continue;
      }

      totalCreated += insertedRows?.length ?? 0;
    }

    const skipped = deadlineRows.length - totalCreated;

    return jsonResponse<GenerateDeadlinesData>(201, {
      data: {
        created: totalCreated,
        skipped: skipped > 0 ? skipped : 0
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "GENERATE_DEADLINES_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to generate deadlines."
      },
      meta: buildMeta()
    });
  }
}
