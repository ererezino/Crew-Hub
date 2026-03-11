import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { maskFromLast4, maskCrewTag, holdSecondsRemaining } from "../../../../../lib/payment-details";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  PAYMENT_METHODS,
  type HrPaymentDetailsResponseData,
  type HrPaymentDetailsRow
} from "../../../../../types/payment-details";

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().email(),
  country_code: z.string().nullable(),
  status: z.enum(["active", "inactive", "onboarding", "offboarding"])
});

const paymentRowSchema = z.object({
  employee_id: z.string().uuid(),
  payment_method: z.enum(PAYMENT_METHODS),
  currency: z.string().length(3),
  bank_account_last4: z.string().nullable(),
  mobile_money_last4: z.string().nullable(),
  crew_tag: z.string().nullable(),
  is_verified: z.boolean(),
  change_effective_at: z.string()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewPaymentDetails(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function maskedDestinationFromRow(row: z.infer<typeof paymentRowSchema>): {
  maskedDestination: string;
  last4: string | null;
  crewTagFull: string | null;
} {
  if (row.payment_method === "bank_transfer") {
    return {
      maskedDestination: maskFromLast4(row.bank_account_last4),
      last4: row.bank_account_last4,
      crewTagFull: null
    };
  }

  if (row.payment_method === "mobile_money") {
    return {
      maskedDestination: maskFromLast4(row.mobile_money_last4),
      last4: row.mobile_money_last4,
      crewTagFull: null
    };
  }

  // CrewTag is a public username, not sensitive — return full value for finance visibility
  return {
    maskedDestination: maskCrewTag(row.crew_tag),
    last4: null,
    crewTagFull: row.crew_tag
  };
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payment details."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPaymentDetails(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view employee payment details."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    const [{ data: profileRows, error: profileError }, { data: paymentRows, error: paymentError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, country_code, status")
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .order("full_name", { ascending: true }),
        supabase
          .from("employee_payment_details")
          .select(
            "employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, crew_tag, is_verified, change_effective_at"
          )
          .eq("org_id", session.profile.org_id)
          .eq("is_primary", true)
          .is("deleted_at", null)
      ]);

    if (profileError || paymentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_FETCH_FAILED",
          message: "Unable to load employee payment details."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(profileRows ?? []);
    const parsedPaymentRows = z.array(paymentRowSchema).safeParse(paymentRows ?? []);

    if (!parsedProfiles.success || !parsedPaymentRows.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_PARSE_FAILED",
          message: "Employee payment details are not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const paymentByEmployeeId = new Map(
      parsedPaymentRows.data.map((row) => [row.employee_id, row] as const)
    );

    const rows: HrPaymentDetailsRow[] = parsedProfiles.data.map((profile) => {
      const paymentRow = paymentByEmployeeId.get(profile.id) ?? null;

      if (!paymentRow) {
        return {
          employeeId: profile.id,
          fullName: profile.full_name,
          email: profile.email,
          countryCode: profile.country_code,
          status: profile.status,
          paymentMethod: null,
          currency: null,
          maskedDestination: null,
          last4: null,
          crewTagFull: null,
          isVerified: null,
          changeEffectiveAt: null,
          holdSecondsRemaining: 0,
          missingDetails: true
        };
      }

      const maskedValue = maskedDestinationFromRow(paymentRow);

      return {
        employeeId: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        countryCode: profile.country_code,
        status: profile.status,
        paymentMethod: paymentRow.payment_method,
        currency: paymentRow.currency,
        maskedDestination: maskedValue.maskedDestination,
        last4: maskedValue.last4,
        crewTagFull: maskedValue.crewTagFull,
        isVerified: paymentRow.is_verified,
        changeEffectiveAt: paymentRow.change_effective_at,
        holdSecondsRemaining: holdSecondsRemaining(paymentRow.change_effective_at),
        missingDetails: false
      };
    });

    return jsonResponse<HrPaymentDetailsResponseData>(200, {
      data: {
        rows
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_DETAILS_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load employee payment details."
      },
      meta: buildMeta()
    });
  }
}
