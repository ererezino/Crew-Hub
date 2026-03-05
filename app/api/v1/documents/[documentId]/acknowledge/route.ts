import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type { PolicyAcknowledgment } from "../../../../../../types/documents";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

const documentRowSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  requires_acknowledgment: z.boolean().optional().default(false)
});

type AcknowledgeResponseData = {
  acknowledgment: PolicyAcknowledgment;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const { documentId } = await params;

  if (!documentId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Document id is required." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Verify document exists and is a policy that requires acknowledgment
  let docRow: Record<string, unknown> | null = null;

  const docResult = await supabase
    .from("documents")
    .select("id, category, requires_acknowledgment")
    .eq("id", documentId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (docResult.error) {
    // Fall back without requires_acknowledgment column
    const fallback = await supabase
      .from("documents")
      .select("id, category")
      .eq("id", documentId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    docRow = fallback.data as Record<string, unknown> | null;

    if (fallback.error || !docRow) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Document was not found." },
        meta: buildMeta()
      });
    }
  } else {
    docRow = docResult.data as Record<string, unknown> | null;
  }

  const parsedDoc = documentRowSchema.safeParse(docRow);

  if (!parsedDoc.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Document was not found." },
      meta: buildMeta()
    });
  }

  if (parsedDoc.data.category !== "policy") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Only policy documents can be acknowledged."
      },
      meta: buildMeta()
    });
  }

  // Check for existing acknowledgment
  const { data: existingAck } = await supabase
    .from("policy_acknowledgments")
    .select("id")
    .eq("document_id", documentId)
    .eq("user_id", session.profile.id)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingAck) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "You have already acknowledged this policy."
      },
      meta: buildMeta()
    });
  }

  // Create acknowledgment
  const { data: rawAck, error: insertError } = await supabase
    .from("policy_acknowledgments")
    .insert({
      document_id: documentId,
      user_id: session.profile.id,
      org_id: orgId,
      acknowledged_at: new Date().toISOString()
    })
    .select("id, document_id, user_id, acknowledged_at")
    .single();

  if (insertError || !rawAck) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ACKNOWLEDGE_FAILED", message: "Unable to acknowledge policy." },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "created",
    tableName: "policy_acknowledgments",
    recordId: rawAck.id as string,
    oldValue: null,
    newValue: {
      document_id: documentId,
      user_id: session.profile.id
    }
  });

  const acknowledgment: PolicyAcknowledgment = {
    id: rawAck.id as string,
    documentId: rawAck.document_id as string,
    userId: rawAck.user_id as string,
    userName: session.profile.full_name,
    acknowledgedAt: rawAck.acknowledged_at as string
  };

  return jsonResponse<AcknowledgeResponseData>(200, {
    data: { acknowledgment },
    error: null,
    meta: buildMeta()
  });
}
