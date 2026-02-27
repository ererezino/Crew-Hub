import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { normalizeReviewSections } from "../../../../../../lib/performance/reviews";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  CreateReviewTemplateData,
  CreateReviewTemplatePayload
} from "../../../../../../types/performance";
import {
  buildMeta,
  canManagePerformance,
  jsonResponse,
  mapTemplateRow,
  templateRowSchema
} from "../../_helpers";

const questionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  type: z.enum(["rating", "text"]),
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(4000).optional()
});

const sectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().max(300).default(""),
  questions: z.array(questionSchema).min(1)
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  sections: z.array(sectionSchema).min(1)
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create review templates."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePerformance(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin can create review templates."
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

  const parsedPayload = createTemplateSchema.safeParse(payloadValue);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid template payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data as CreateReviewTemplatePayload;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawInsertedTemplate, error: insertError } = await supabase
      .from("review_templates")
      .insert({
        org_id: session.profile.org_id,
        name: payload.name,
        sections: payload.sections,
        created_by: session.profile.id
      })
      .select("id, org_id, name, sections, created_by, created_at, updated_at")
      .single();

    if (insertError || !rawInsertedTemplate) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_TEMPLATE_CREATE_FAILED",
          message: "Unable to create review template."
        },
        meta: buildMeta()
      });
    }

    const parsedTemplate = templateRowSchema.safeParse(rawInsertedTemplate);

    if (!parsedTemplate.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_TEMPLATE_PARSE_FAILED",
          message: "Created template data is invalid."
        },
        meta: buildMeta()
      });
    }

    const normalizedSections = normalizeReviewSections(parsedTemplate.data.sections);

    if (normalizedSections.length === 0) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REVIEW_TEMPLATE_PARSE_FAILED",
          message: "Created template has no valid sections."
        },
        meta: buildMeta()
      });
    }

    const responseData: CreateReviewTemplateData = {
      template: mapTemplateRow(parsedTemplate.data)
    };

    return jsonResponse<CreateReviewTemplateData>(201, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REVIEW_TEMPLATE_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to create review template."
      },
      meta: buildMeta()
    });
  }
}
