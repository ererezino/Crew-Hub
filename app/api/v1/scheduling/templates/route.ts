import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../lib/roles";
import {
  isIsoTime,
  isSchedulingManager,
  parseInteger
} from "../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type {
  SchedulingTemplateMutationResponseData,
  SchedulingTemplatesResponseData,
  ShiftTemplateRecord
} from "../../../../../types/scheduling";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).default(200),
  department: z.string().trim().max(100).optional()
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200),
  department: z.string().trim().max(100).optional(),
  startTime: z
    .string()
    .trim()
    .refine((value) => isIsoTime(value), "Start time must be HH:MM."),
  endTime: z
    .string()
    .trim()
    .refine((value) => isIsoTime(value), "End time must be HH:MM."),
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex value such as #4A0039.")
    .optional()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  department: z.string().nullable(),
  start_time: z.string(),
  end_time: z.string(),
  break_minutes: z.union([z.number(), z.string()]),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapTemplateRow(row: z.infer<typeof templateRowSchema>): ShiftTemplateRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    department: row.department,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    breakMinutes: parseInteger(row.break_minutes),
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view shift templates."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid template query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const query = parsedQuery.data;
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  if (
    isScopedTeamLead &&
    query.department &&
    !areDepartmentsEqual(query.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only view templates for their own department."
      },
      meta: buildMeta()
    });
  }

  let templatesQuery = supabase
    .from("shift_templates")
    .select(
      "id, org_id, name, department, start_time, end_time, break_minutes, color, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(query.limit);

  if (isScopedTeamLead) {
    templatesQuery = templatesQuery.ilike("department", session.profile.department as string);
  } else if (query.department && query.department.length > 0) {
    templatesQuery = templatesQuery.eq("department", query.department);
  }

  const { data: rawRows, error } = await templatesQuery;

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATES_FETCH_FAILED",
        message: "Unable to load shift templates."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(templateRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATES_PARSE_FAILED",
        message: "Shift template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<SchedulingTemplatesResponseData>(200, {
    data: {
      templates: parsedRows.data.map((row) => mapTemplateRow(row))
    },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create shift templates."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can create shift templates."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
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

  const parsedBody = createTemplateSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid shift template payload."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.endTime === parsedBody.data.startTime) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End time must be different from start time."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  if (
    isScopedTeamLead &&
    parsedBody.data.department &&
    !areDepartmentsEqual(parsedBody.data.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only create templates for their own department."
      },
      meta: buildMeta()
    });
  }

  const { data: rawRow, error } = await supabase
    .from("shift_templates")
    .insert({
      org_id: session.profile.org_id,
      name: parsedBody.data.name,
      department: isScopedTeamLead
        ? session.profile.department
        : parsedBody.data.department?.trim() || null,
      start_time: `${parsedBody.data.startTime}:00`,
      end_time: `${parsedBody.data.endTime}:00`,
      break_minutes: parsedBody.data.breakMinutes,
      color: parsedBody.data.color ?? null
    })
    .select(
      "id, org_id, name, department, start_time, end_time, break_minutes, color, created_at, updated_at"
    )
    .single();

  if (error || !rawRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATE_CREATE_FAILED",
        message: "Unable to create shift template."
      },
      meta: buildMeta()
    });
  }

  const parsedRow = templateRowSchema.safeParse(rawRow);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATE_PARSE_FAILED",
        message: "Created template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "created",
    tableName: "shift_templates",
    recordId: parsedRow.data.id,
    oldValue: null,
    newValue: {
      name: parsedRow.data.name,
      department: parsedRow.data.department
    }
  });

  return jsonResponse<SchedulingTemplateMutationResponseData>(201, {
    data: {
      template: mapTemplateRow(parsedRow.data)
    },
    error: null,
    meta: buildMeta()
  });
}
