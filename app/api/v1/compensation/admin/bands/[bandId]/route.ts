import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { fetchCompensationBandsData } from "../../../../../../../lib/compensation-bands-store";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import {
  COMPENSATION_BAND_LOCATION_TYPES,
  type CompensationBandCreateResponseData
} from "../../../../../../../types/compensation-bands";
import { buildMeta, canManageCompensation, jsonResponse } from "../../_helpers";

type RouteContext = {
  params: Promise<{
    bandId: string;
  }>;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const paramsSchema = z.object({
  bandId: z.string().uuid("Band id must be a valid UUID.")
});

const nonNegativeIntegerSchema = z
  .union([
    z.number().int().min(0),
    z.string().trim().regex(/^\d+$/, "Value must be a non-negative integer.")
  ])
  .transform((value) => (typeof value === "number" ? value : Number.parseInt(value, 10)));

const nullableNonNegativeIntegerSchema = z
  .union([
    z.number().int().min(0),
    z.string().trim().regex(/^\d+$/, "Value must be a non-negative integer."),
    z.literal(""),
    z.null(),
    z.undefined()
  ])
  .transform((value) => {
    if (value === null || typeof value === "undefined") {
      return null;
    }

    if (value === "") {
      return null;
    }

    return typeof value === "number" ? value : Number.parseInt(value, 10);
  });

const updateBandSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long.").optional(),
    level: z
      .union([z.string().trim().max(60, "Level is too long."), z.literal(""), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return undefined;
        }

        const normalizedValue = value.trim();
        return normalizedValue.length === 0 ? null : normalizedValue;
      }),
    department: z
      .union([
        z.string().trim().max(100, "Department is too long."),
        z.literal(""),
        z.null(),
        z.undefined()
      ])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return undefined;
        }

        const normalizedValue = value.trim();
        return normalizedValue.length === 0 ? null : normalizedValue;
      }),
    locationType: z.enum(COMPENSATION_BAND_LOCATION_TYPES).optional(),
    locationValue: z
      .union([
        z.string().trim().max(100, "Location is too long."),
        z.literal(""),
        z.null(),
        z.undefined()
      ])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return undefined;
        }

        const normalizedValue = value.trim();
        return normalizedValue.length === 0 ? null : normalizedValue;
      }),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code.")
      .optional(),
    minSalaryAmount: nonNegativeIntegerSchema.optional(),
    midSalaryAmount: nonNegativeIntegerSchema.optional(),
    maxSalaryAmount: nonNegativeIntegerSchema.optional(),
    equityMin: nullableNonNegativeIntegerSchema.optional(),
    equityMax: nullableNonNegativeIntegerSchema.optional(),
    effectiveFrom: z
      .string()
      .trim()
      .regex(isoDatePattern, "Effective from must be in YYYY-MM-DD format.")
      .optional(),
    effectiveTo: z
      .union([z.string().trim().regex(isoDatePattern), z.literal(""), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return undefined;
        }

        const normalizedValue = value.trim();
        return normalizedValue.length === 0 ? null : normalizedValue;
      })
  })
  .superRefine((value, context) => {
    const suppliedValues = Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined);

    if (suppliedValues.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to update."
      });
    }
  });

const bandRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  level: z.string().nullable(),
  department: z.string().nullable(),
  location_type: z.enum(COMPENSATION_BAND_LOCATION_TYPES),
  location_value: z.string().nullable(),
  currency: z.string().length(3),
  min_salary_amount: z.union([z.number(), z.string()]),
  mid_salary_amount: z.union([z.number(), z.string()]),
  max_salary_amount: z.union([z.number(), z.string()]),
  equity_min: z.number().nullable(),
  equity_max: z.number().nullable(),
  effective_from: z.string(),
  effective_to: z.string().nullable()
});

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage compensation bands."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to manage compensation bands."
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
        message: parsedParams.error.issues[0]?.message ?? "Invalid compensation band id."
      },
      meta: buildMeta()
    });
  }

  let parsedPayload: z.infer<typeof updateBandSchema>;

  try {
    const json = (await request.json()) as unknown;
    const parseResult = updateBandSchema.safeParse(json);

    if (!parseResult.success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.issues[0]?.message ?? "Invalid update payload."
        },
        meta: buildMeta()
      });
    }

    parsedPayload = parseResult.data;
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "INVALID_JSON",
        message: "Request payload must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingBandRow, error: existingBandError } = await supabase
    .from("compensation_bands")
    .select(
      "id, title, level, department, location_type, location_value, currency, min_salary_amount, mid_salary_amount, max_salary_amount, equity_min, equity_max, effective_from, effective_to"
    )
    .eq("id", parsedParams.data.bandId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingBandError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_BAND_FETCH_FAILED",
        message: "Unable to load compensation band."
      },
      meta: buildMeta()
    });
  }

  const parsedExistingBand = bandRowSchema.safeParse(existingBandRow);

  if (!parsedExistingBand.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Compensation band was not found."
      },
      meta: buildMeta()
    });
  }

  const existingBand = parsedExistingBand.data;

  const nextLocationType = parsedPayload.locationType ?? existingBand.location_type;
  const nextLocationValueInput =
    parsedPayload.locationValue === undefined
      ? existingBand.location_value
      : parsedPayload.locationValue;
  const nextLocationValue = nextLocationType === "global" ? null : nextLocationValueInput;

  if (nextLocationType !== "global" && (!nextLocationValue || nextLocationValue.trim().length === 0)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Location value is required when location type is not global."
      },
      meta: buildMeta()
    });
  }

  const nextMinSalary = parsedPayload.minSalaryAmount ?? Number.parseInt(String(existingBand.min_salary_amount), 10);
  const nextMidSalary = parsedPayload.midSalaryAmount ?? Number.parseInt(String(existingBand.mid_salary_amount), 10);
  const nextMaxSalary = parsedPayload.maxSalaryAmount ?? Number.parseInt(String(existingBand.max_salary_amount), 10);

  if (nextMidSalary < nextMinSalary || nextMaxSalary < nextMidSalary) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Salary ranges must satisfy min <= mid <= max."
      },
      meta: buildMeta()
    });
  }

  const nextEquityMin = parsedPayload.equityMin === undefined ? existingBand.equity_min : parsedPayload.equityMin;
  const nextEquityMax = parsedPayload.equityMax === undefined ? existingBand.equity_max : parsedPayload.equityMax;

  if (nextEquityMin !== null && nextEquityMax !== null && nextEquityMin > nextEquityMax) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Equity max must be greater than or equal to equity min."
      },
      meta: buildMeta()
    });
  }

  const nextEffectiveFrom = parsedPayload.effectiveFrom ?? existingBand.effective_from;
  const nextEffectiveTo = parsedPayload.effectiveTo === undefined ? existingBand.effective_to : parsedPayload.effectiveTo;

  if (nextEffectiveTo && nextEffectiveTo < nextEffectiveFrom) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Effective to must be on or after effective from."
      },
      meta: buildMeta()
    });
  }

  const { error: updateError } = await supabase
    .from("compensation_bands")
    .update({
      title: parsedPayload.title?.trim() ?? existingBand.title,
      level: parsedPayload.level === undefined ? existingBand.level : parsedPayload.level,
      department:
        parsedPayload.department === undefined ? existingBand.department : parsedPayload.department,
      location_type: nextLocationType,
      location_value: nextLocationValue,
      currency: parsedPayload.currency ? normalizeCurrency(parsedPayload.currency) : existingBand.currency,
      min_salary_amount: nextMinSalary,
      mid_salary_amount: nextMidSalary,
      max_salary_amount: nextMaxSalary,
      equity_min: nextEquityMin,
      equity_max: nextEquityMax,
      effective_from: nextEffectiveFrom,
      effective_to: nextEffectiveTo,
      updated_by: session.profile.id
    })
    .eq("id", existingBand.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_BAND_UPDATE_FAILED",
        message: "Unable to update compensation band."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationBandsData({
    supabase,
    orgId: session.profile.org_id
  });

  const updatedBand = snapshot.bands.find((row) => row.id === existingBand.id);

  if (!updatedBand) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_BAND_UPDATE_FAILED",
        message: "Compensation band was updated but could not be reloaded."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "compensation_bands",
    recordId: updatedBand.id,
    oldValue: {
      title: existingBand.title,
      level: existingBand.level,
      locationType: existingBand.location_type,
      locationValue: existingBand.location_value,
      minSalaryAmount: Number.parseInt(String(existingBand.min_salary_amount), 10),
      midSalaryAmount: Number.parseInt(String(existingBand.mid_salary_amount), 10),
      maxSalaryAmount: Number.parseInt(String(existingBand.max_salary_amount), 10)
    },
    newValue: {
      title: updatedBand.title,
      level: updatedBand.level,
      locationType: updatedBand.locationType,
      locationValue: updatedBand.locationValue,
      minSalaryAmount: updatedBand.minSalaryAmount,
      midSalaryAmount: updatedBand.midSalaryAmount,
      maxSalaryAmount: updatedBand.maxSalaryAmount
    }
  });

  return jsonResponse<CompensationBandCreateResponseData>(200, {
    data: {
      band: updatedBand
    },
    error: null,
    meta: buildMeta()
  });
}
