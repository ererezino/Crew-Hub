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

const vendorSelectColumns =
  "id, org_id, employee_id, vendor_name, payment_method, bank_account_name, bank_account_number, mobile_money_provider, mobile_money_number, crew_tag, wire_bank_name, wire_account_number, wire_swift_bic, wire_iban, wire_bank_country, wire_currency, created_at, updated_at";

const vendorRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  vendor_name: z.string(),
  payment_method: z.string().nullable().default("bank_transfer"),
  bank_account_name: z.string().nullable().default(null),
  bank_account_number: z.string().nullable().default(null),
  mobile_money_provider: z.string().nullable().default(null),
  mobile_money_number: z.string().nullable().default(null),
  crew_tag: z.string().nullable().default(null),
  wire_bank_name: z.string().nullable().default(null),
  wire_account_number: z.string().nullable().default(null),
  wire_swift_bic: z.string().nullable().default(null),
  wire_iban: z.string().nullable().default(null),
  wire_bank_country: z.string().nullable().default(null),
  wire_currency: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

function toVendorBeneficiary(row: z.infer<typeof vendorRowSchema>): VendorBeneficiary {
  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    vendorName: row.vendor_name,
    paymentMethod: (row.payment_method ?? "bank_transfer") as VendorBeneficiary["paymentMethod"],
    bankAccountName: row.bank_account_name ?? "",
    bankAccountNumber: row.bank_account_number ?? "",
    mobileMoneyProvider: row.mobile_money_provider ?? null,
    mobileMoneyNumber: row.mobile_money_number ?? null,
    crewTag: row.crew_tag ?? null,
    wireBankName: row.wire_bank_name ?? null,
    wireAccountNumber: row.wire_account_number ?? null,
    wireSwiftBic: row.wire_swift_bic ?? null,
    wireIban: row.wire_iban ?? null,
    wireBankCountry: row.wire_bank_country ?? null,
    wireCurrency: row.wire_currency ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const createVendorSchema = z.object({
  vendorName: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
  paymentMethod: z.enum(["bank_transfer", "mobile_money", "crew_tag", "international_wire"]).default("bank_transfer"),
  bankAccountName: z.string().trim().max(200, "Bank account name is too long.").optional(),
  bankAccountNumber: z.string().trim().max(50, "Bank account number is too long.").optional(),
  mobileMoneyProvider: z.string().trim().max(200, "Mobile money provider is too long.").optional(),
  mobileMoneyNumber: z.string().trim().max(30, "Mobile money number is too long.").optional(),
  crewTag: z.string().trim().max(100, "Crew Tag is too long.").optional(),
  wireBankName: z.string().trim().max(200, "Wire bank name is too long.").optional(),
  wireAccountNumber: z.string().trim().max(50, "Wire account number is too long.").optional(),
  wireSwiftBic: z.string().trim().max(20, "SWIFT/BIC code is too long.").optional(),
  wireIban: z.string().trim().max(50, "IBAN is too long.").optional(),
  wireBankCountry: z.string().trim().max(100, "Bank country is too long.").optional(),
  wireCurrency: z.string().trim().length(3, "Wire currency must be a 3-letter code.").optional()
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
    .select(vendorSelectColumns)
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
      payment_method: payload.paymentMethod,
      bank_account_name: payload.bankAccountName?.trim() || null,
      bank_account_number: payload.bankAccountNumber?.trim() || null,
      mobile_money_provider: payload.mobileMoneyProvider?.trim() || null,
      mobile_money_number: payload.mobileMoneyNumber?.trim() || null,
      crew_tag: payload.crewTag?.trim() || null,
      wire_bank_name: payload.wireBankName?.trim() || null,
      wire_account_number: payload.wireAccountNumber?.trim() || null,
      wire_swift_bic: payload.wireSwiftBic?.trim() || null,
      wire_iban: payload.wireIban?.trim() || null,
      wire_bank_country: payload.wireBankCountry?.trim() || null,
      wire_currency: payload.wireCurrency?.trim() || null
    })
    .select(vendorSelectColumns)
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
