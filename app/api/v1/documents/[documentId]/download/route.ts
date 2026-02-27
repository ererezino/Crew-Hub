import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME } from "../../../../../../lib/documents";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type { DocumentSignedUrlResponseData } from "../../../../../../types/documents";

const paramsSchema = z.object({
  documentId: z.string().uuid()
});

const querySchema = z.object({
  expiresIn: z.coerce.number().int().min(30).max(600).default(120)
});

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to access document files."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Document id must be a valid UUID."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid signed URL query parameters."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const documentId = parsedParams.data.documentId;

  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select("file_path")
    .eq("id", documentId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "DOCUMENT_FETCH_FAILED",
        message: "Unable to load document metadata."
      },
      meta: buildMeta()
    });
  }

  if (!documentRow?.file_path) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Document not found."
      },
      meta: buildMeta()
    });
  }

  const expiresIn = parsedQuery.data.expiresIn;
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(DOCUMENT_BUCKET_NAME)
    .createSignedUrl(documentRow.file_path, expiresIn);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNED_URL_FAILED",
        message: "Unable to generate document access URL."
      },
      meta: buildMeta()
    });
  }

  const responseData: DocumentSignedUrlResponseData = {
    url: signedUrlData.signedUrl,
    expiresInSeconds: expiresIn
  };

  return jsonResponse<DocumentSignedUrlResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
