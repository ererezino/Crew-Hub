import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { isIsoDate, getBirthdayLeaveOptions } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import type { BirthdayChoiceResponseData } from "../../../../../types/time-off";

const choiceSchema = z.object({
  chosenDate: z
    .string()
    .refine((value) => isIsoDate(value), "Date must be in YYYY-MM-DD format")
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to choose a birthday leave date."
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

  const parsedBody = choiceSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid birthday choice payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch employee profile with DOB
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, full_name, country_code, date_of_birth, status")
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (profileError || !profileRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to load your profile."
      },
      meta: buildMeta()
    });
  }

  if (!profileRow.date_of_birth) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "NO_DOB",
        message: "Your date of birth is not set. Please update your profile first."
      },
      meta: buildMeta()
    });
  }

  const currentYear = new Date().getUTCFullYear();

  // Check if birthday leave already exists for this year
  const { data: existingRequest } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .eq("leave_type", "birthday_leave")
    .gte("start_date", `${currentYear}-01-01`)
    .lte("start_date", `${currentYear}-12-31`)
    .is("deleted_at", null)
    .limit(1);

  if (existingRequest && existingRequest.length > 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "ALREADY_CHOSEN",
        message: "You have already used your birthday leave for this year."
      },
      meta: buildMeta()
    });
  }

  // Fetch holidays for validation
  const { data: holidays } = await serviceClient
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", session.profile.org_id)
    .eq("country_code", profileRow.country_code ?? "NG")
    .gte("date", `${currentYear}-01-01`)
    .lte("date", `${currentYear}-12-31`)
    .is("deleted_at", null);

  const holidayDateKeys = new Set((holidays ?? []).map((h) => h.date));
  const birthdayOptions = getBirthdayLeaveOptions(
    profileRow.date_of_birth,
    currentYear,
    holidayDateKeys
  );

  // Validate the chosen date is one of the allowed options
  if (!birthdayOptions.options.includes(parsedBody.data.chosenDate)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_DATE",
        message: "The chosen date is not a valid birthday leave option."
      },
      meta: buildMeta()
    });
  }

  // Create the approved birthday leave request
  const { data: insertedRequest, error: insertError } = await supabase
    .from("leave_requests")
    .insert({
      org_id: session.profile.org_id,
      employee_id: session.profile.id,
      leave_type: "birthday_leave",
      start_date: parsedBody.data.chosenDate,
      end_date: parsedBody.data.chosenDate,
      total_days: 1,
      status: "approved",
      reason: "Birthday leave (employee choice)"
    })
    .select("id, start_date")
    .single();

  if (insertError || !insertedRequest) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_CREATE_FAILED",
        message: "Unable to create birthday leave request."
      },
      meta: buildMeta()
    });
  }

  const responseData: BirthdayChoiceResponseData = {
    requestId: insertedRequest.id,
    chosenDate: insertedRequest.start_date
  };

  return jsonResponse<BirthdayChoiceResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
