import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  ONBOARDING_TYPES,
  type OnboardingTemplate,
  type OnboardingTemplateTask,
  type OnboardingTemplatesResponseData
} from "../../../../../types/onboarding";

const querySchema = z.object({
  type: z.enum(ONBOARDING_TYPES).optional()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(ONBOARDING_TYPES),
  country_code: z.string().nullable(),
  department: z.string().nullable(),
  tasks: z.unknown(),
  created_at: z.string(),
  updated_at: z.string()
});

const templateTaskSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function normalizeTemplateTasks(value: unknown): OnboardingTemplateTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedTasks: OnboardingTemplateTask[] = [];

  for (const task of value) {
    const parsedTask = templateTaskSchema.safeParse(task);

    if (!parsedTask.success) {
      continue;
    }

    normalizedTasks.push({
      title: parsedTask.data.title,
      description: parsedTask.data.description,
      category: parsedTask.data.category,
      dueOffsetDays:
        parsedTask.data.dueOffsetDays ??
        parsedTask.data.due_offset_days ??
        null
    });
  }

  return normalizedTasks;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view onboarding templates."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid template query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  let templatesQuery = supabase
    .from("onboarding_templates")
    .select("id, name, type, country_code, department, tasks, created_at, updated_at")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (parsedQuery.data.type) {
    templatesQuery = templatesQuery.eq("type", parsedQuery.data.type);
  }

  const { data: rawTemplates, error: templatesError } = await templatesQuery;

  if (templatesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATES_FETCH_FAILED",
        message: "Unable to load onboarding templates."
      },
      meta: buildMeta()
    });
  }

  const parsedTemplates = z.array(templateRowSchema).safeParse(rawTemplates ?? []);

  if (!parsedTemplates.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATES_PARSE_FAILED",
        message: "Template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const templates: OnboardingTemplate[] = parsedTemplates.data.map((template) => ({
    id: template.id,
    name: template.name,
    type: template.type,
    countryCode: template.country_code,
    department: template.department,
    tasks: normalizeTemplateTasks(template.tasks),
    createdAt: template.created_at,
    updatedAt: template.updated_at
  }));

  const responseData: OnboardingTemplatesResponseData = {
    templates
  };

  return jsonResponse<OnboardingTemplatesResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
