import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME } from "../../../../../../lib/documents";
import { canManageLearningAssignments } from "../../../../../../lib/learning";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { LearningCertificateResponseData } from "../../../../../../types/learning";
import { buildMeta, jsonResponse } from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const querySchema = z.object({
  expiresIn: z.coerce.number().int().min(30).max(900).default(180),
  usage: z.enum(["view", "download"]).default("view")
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to access learning certificates."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Certificate id must be a valid UUID."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid certificate query parameters."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const assignmentId = parsedParams.data.id;

  const { data: assignmentRow, error: assignmentError } = await supabase
    .from("course_assignments")
    .select("id, org_id, employee_id, certificate_url")
    .eq("org_id", session.profile.org_id)
    .eq("id", assignmentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (assignmentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "CERTIFICATE_FETCH_FAILED",
        message: "Unable to load certificate metadata."
      },
      meta: buildMeta()
    });
  }

  if (!assignmentRow?.certificate_url) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Certificate is not available yet."
      },
      meta: buildMeta()
    });
  }

  const canManage = canManageLearningAssignments(session.profile.roles);

  if (assignmentRow.employee_id !== session.profile.id && !canManage) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to access this certificate."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const signedUrlOptions =
    query.usage === "download"
      ? {
          download: `learning-certificate-${assignmentId}.pdf`
        }
      : undefined;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(DOCUMENT_BUCKET_NAME)
    .createSignedUrl(assignmentRow.certificate_url, query.expiresIn, signedUrlOptions);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNED_URL_FAILED",
        message: "Unable to generate certificate URL."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<LearningCertificateResponseData>(200, {
    data: {
      url: signedUrlData.signedUrl,
      expiresInSeconds: query.expiresIn
    },
    error: null,
    meta: buildMeta()
  });
}
