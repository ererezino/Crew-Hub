import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const sessionProfileSchema = z.object({
  id: z.string().uuid("Session profile id is invalid."),
  org_id: z.string().uuid("Session organization id is invalid.")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function daysUntilDate(dateStr: string): number | null {
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return null;

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

type EmployeeDocument = {
  id: string;
  title: string;
  category: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
};

type EmployeeComplianceData = {
  documents: EmployeeDocument[];
};

export async function GET() {
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

  const parsedProfile = sessionProfileSchema.safeParse(session.profile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SESSION_INVALID",
        message: parsedProfile.error.issues[0]?.message ?? "Invalid session profile."
      },
      meta: buildMeta()
    });
  }

  const profile = parsedProfile.data;

  try {
    const supabase = await createSupabaseServerClient();

    // Fetch personal documents with expiry dates
    const { data: documents, error: docsError } = await supabase
      .from("documents")
      .select("id, title, category, expiry_date")
      .eq("org_id", profile.org_id)
      .eq("owner_user_id", profile.id)
      .not("expiry_date", "is", null)
      .is("deleted_at", null)
      .order("expiry_date", { ascending: true });

    if (docsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EMPLOYEE_COMPLIANCE_FAILED",
          message: "Unable to fetch documents."
        },
        meta: buildMeta()
      });
    }

    const mappedDocs: EmployeeDocument[] = (documents ?? []).map((doc) => {
      const expiryDate = typeof doc.expiry_date === "string" ? doc.expiry_date : null;

      return {
        id: doc.id as string,
        title: (doc.title as string) ?? "Document",
        category: (doc.category as string) ?? "other",
        expiryDate,
        daysUntilExpiry: expiryDate ? daysUntilDate(expiryDate) : null
      };
    });

    const responseData: EmployeeComplianceData = {
      documents: mappedDocs
    };

    return jsonResponse<EmployeeComplianceData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEE_COMPLIANCE_FAILED",
        message:
          error instanceof Error ? error.message : "Unable to load compliance data."
      },
      meta: buildMeta()
    });
  }
}
