import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { todayIsoDate } from "../../../../../lib/datetime";
import {
  getBirthdayLeaveOptions,
  hasBirthdayConfigured,
  isIsoDate
} from "../../../../../lib/time-off";
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
    .select("id, org_id, full_name, country_code, date_of_birth, birthday_month, birthday_day, status")
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

  if (!hasBirthdayConfigured({
    dateOfBirth: profileRow.date_of_birth,
    birthdayMonth: profileRow.birthday_month,
    birthdayDay: profileRow.birthday_day
  })) {
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
  const today = todayIsoDate();

  // Check if birthday leave already exists for this year
  const { data: existingRequestRows, error: existingRequestError } = await supabase
    .from("leave_requests")
    .select("id, start_date, status")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .eq("leave_type", "birthday_leave")
    .gte("start_date", `${currentYear}-01-01`)
    .lte("start_date", `${currentYear}-12-31`)
    .is("deleted_at", null)
    .limit(1);

  if (existingRequestError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_LOOKUP_FAILED",
        message: "Unable to check your existing birthday leave."
      },
      meta: buildMeta()
    });
  }

  const existingRequest = existingRequestRows?.[0] ?? null;

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
    {
      dateOfBirth: profileRow.date_of_birth,
      birthdayMonth: profileRow.birthday_month,
      birthdayDay: profileRow.birthday_day
    },
    currentYear,
    holidayDateKeys
  );

  if (parsedBody.data.chosenDate < today) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "PAST_DATE_NOT_ALLOWED",
        message: "Birthday leave cannot be moved to a past date."
      },
      meta: buildMeta()
    });
  }

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

  if (existingRequest && existingRequest.start_date < today) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "ALREADY_USED",
        message: "You have already used your birthday leave for this year."
      },
      meta: buildMeta()
    });
  }

  let requestRecord: { id: string; start_date: string } | null = null;

  if (existingRequest) {
    const { data: updatedRequest, error: updateError } = await supabase
      .from("leave_requests")
      .update({
        start_date: parsedBody.data.chosenDate,
        end_date: parsedBody.data.chosenDate,
        total_days: 1,
        reason:
          parsedBody.data.chosenDate === birthdayOptions.birthdayDate
            ? "Birthday leave (birthday date confirmed)"
            : "Birthday leave (employee override)"
      })
      .eq("id", existingRequest.id)
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .select("id, start_date")
      .single();

    if (updateError || !updatedRequest) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REQUEST_UPDATE_FAILED",
          message: "Unable to update birthday leave request."
        },
        meta: buildMeta()
      });
    }

    requestRecord = updatedRequest;
  } else {
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
        reason:
          parsedBody.data.chosenDate === birthdayOptions.birthdayDate
            ? "Birthday leave (birthday date confirmed)"
            : "Birthday leave (employee choice)"
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

    requestRecord = insertedRequest;
  }

  const responseData: BirthdayChoiceResponseData = {
    requestId: requestRecord.id,
    chosenDate: requestRecord.start_date
  };

  return jsonResponse<BirthdayChoiceResponseData>(existingRequest ? 200 : 201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
