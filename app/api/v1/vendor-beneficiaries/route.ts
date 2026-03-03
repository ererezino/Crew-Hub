import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import type {
  VendorBeneficiariesListResponseData,
  VendorBeneficiary,
  VendorBeneficiaryCreateResponseData
} from "../../../../types/vendor-beneficiaries";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

const vendorRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  vendor_name: z.string(),
  bank_account_name: z.string(),
  bank_account_number: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

function toVendorBeneficiary(row: z.infer<typeof vendorRowSchema>): VendorBeneficiary {
  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    vendorName: row.vendor_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const createVendorSchema = z.object({
  vendorName: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
  bankAccountName: z.string().trim().min(1, "Bank account name is required.").max(200, "Bank account name is too long."),
  bankAccountNumber: z.string().trim().min(1, "Bank account number is required.").max(50, "Bank account number is too long.")
});

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view vendors."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawVendors, error: vendorsError } = await supabase
    .from("vendor_beneficiaries")
    .select("id, org_id, employee_id, vendor_name, bank_account_name, bank_account_number, created_at, updated_at")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .is("deleted_at", null)
    .order("vendor_name", { ascending: true });

  if (vendorsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "VENDORS_FETCH_FAILED",
        message: "Unable to load saved vendors."
      },
      meta: buildMeta()
    });
  }

  const parsed = z.array(vendorRowSchema).safeParse(rawVendors ?? []);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "VENDORS_PARSE_FAILED",
        message: "Vendor data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<VendorBeneficiariesListResponseData>(200, {
    data: {
      vendors: parsed.data.map(toVendorBeneficiary)
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
        message: "You must be logged in to save vendors."
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

  const parsedBody = createVendorSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid vendor payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const payload = parsedBody.data;

  const { data: insertedVendor, error: insertError } = await supabase
    .from("vendor_beneficiaries")
    .insert({
      org_id: session.profile.org_id,
      employee_id: session.profile.id,
      vendor_name: payload.vendorName.trim(),
      bank_account_name: payload.bankAccountName.trim(),
      bank_account_number: payload.bankAccountNumber.trim()
    })
    .select("id, org_id, employee_id, vendor_name, bank_account_name, bank_account_number, created_at, updated_at")
    .single();

  if (insertError || !insertedVendor) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "VENDOR_CREATE_FAILED",
        message: "Unable to save vendor."
      },
      meta: buildMeta()
    });
  }

  const parsed = vendorRowSchema.safeParse(insertedVendor);

  if (!parsed.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "VENDOR_PARSE_FAILED",
        message: "Created vendor data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<VendorBeneficiaryCreateResponseData>(201, {
    data: {
      vendor: toVendorBeneficiary(parsed.data)
    },
    error: null,
    meta: buildMeta()
  });
}
