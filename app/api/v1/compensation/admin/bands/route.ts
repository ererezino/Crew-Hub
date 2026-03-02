import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { fetchCompensationBandsData } from "../../../../../../lib/compensation-bands-store";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  type BenchmarkCreateResponseData,
  type CompensationBandAssignmentCreateResponseData,
  COMPENSATION_BAND_LOCATION_TYPES,
  type CompensationBandCreateResponseData,
  type CompensationBandsResponseData
} from "../../../../../../types/compensation-bands";
import { canManageCompensation, jsonResponse, buildMeta } from "../_helpers";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

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
    z.null(),
    z.undefined()
  ])
  .transform((value) => {
    if (value === null || typeof value === "undefined") {
      return null;
    }

    return typeof value === "number" ? value : Number.parseInt(value, 10);
  });

const createBandSchema = z
  .object({
    type: z.literal("band"),
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
    level: z.string().trim().max(60, "Level is too long.").optional(),
    department: z.string().trim().max(100, "Department is too long.").optional(),
    locationType: z.enum(COMPENSATION_BAND_LOCATION_TYPES),
    locationValue: z.string().trim().max(100, "Location is too long.").optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    minSalaryAmount: nonNegativeIntegerSchema,
    midSalaryAmount: nonNegativeIntegerSchema,
    maxSalaryAmount: nonNegativeIntegerSchema,
    equityMin: nullableNonNegativeIntegerSchema,
    equityMax: nullableNonNegativeIntegerSchema,
    effectiveFrom: z
      .string()
      .trim()
      .regex(isoDatePattern, "Effective from must be in YYYY-MM-DD format."),
    effectiveTo: z
      .union([z.string().trim().regex(isoDatePattern), z.literal(""), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return null;
        }

        const trimmedValue = value.trim();
        return trimmedValue.length === 0 ? null : trimmedValue;
      })
  })
  .superRefine((value, context) => {
    if (value.midSalaryAmount < value.minSalaryAmount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["midSalaryAmount"],
        message: "Mid salary must be greater than or equal to min salary."
      });
    }

    if (value.maxSalaryAmount < value.midSalaryAmount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxSalaryAmount"],
        message: "Max salary must be greater than or equal to mid salary."
      });
    }

    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to must be on or after effective from."
      });
    }

    if (
      value.locationType !== "global" &&
      (!value.locationValue || value.locationValue.trim().length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locationValue"],
        message: "Location value is required when location type is not global."
      });
    }

    if (value.equityMin !== null && value.equityMax !== null && value.equityMin > value.equityMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["equityMax"],
        message: "Equity max must be greater than or equal to equity min."
      });
    }
  });

const createBenchmarkSchema = z
  .object({
    type: z.literal("benchmark"),
    source: z.string().trim().min(1, "Source is required.").max(100, "Source is too long."),
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
    level: z.string().trim().max(60, "Level is too long.").optional(),
    location: z.string().trim().max(100, "Location is too long.").optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    p25: nullableNonNegativeIntegerSchema,
    p50: nullableNonNegativeIntegerSchema,
    p75: nullableNonNegativeIntegerSchema,
    p90: nullableNonNegativeIntegerSchema
  })
  .superRefine((value, context) => {
    if (value.p25 !== null && value.p50 !== null && value.p25 > value.p50) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["p50"],
        message: "P50 must be greater than or equal to P25."
      });
    }

    if (value.p50 !== null && value.p75 !== null && value.p50 > value.p75) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["p75"],
        message: "P75 must be greater than or equal to P50."
      });
    }

    if (value.p75 !== null && value.p90 !== null && value.p75 > value.p90) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["p90"],
        message: "P90 must be greater than or equal to P75."
      });
    }
  });

const createAssignmentSchema = z
  .object({
    type: z.literal("assignment"),
    employeeId: z.string().uuid("Employee must be a valid id."),
    bandId: z.string().uuid("Band must be a valid id."),
    effectiveFrom: z
      .string()
      .trim()
      .regex(isoDatePattern, "Effective from must be in YYYY-MM-DD format."),
    effectiveTo: z
      .union([z.string().trim().regex(isoDatePattern), z.literal(""), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || typeof value === "undefined") {
          return null;
        }

        const trimmedValue = value.trim();
        return trimmedValue.length === 0 ? null : trimmedValue;
      })
  })
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to must be on or after effective from."
      });
    }
  });

const createPayloadSchema = z.discriminatedUnion("type", [
  createBandSchema,
  createBenchmarkSchema,
  createAssignmentSchema
]);

const idSchema = z.object({
  id: z.string().uuid()
});

function normalizeOptionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function oneDayBefore(isoDate: string): string {
  const parsedDate = new Date(`${isoDate}T00:00:00.000Z`);
  parsedDate.setUTCDate(parsedDate.getUTCDate() - 1);
  return parsedDate.toISOString().slice(0, 10);
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view compensation bands."
      },
      meta: buildMeta()
    });
  }

  if (!canManageCompensation(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view compensation bands."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  try {
    const data = await fetchCompensationBandsData({
      supabase,
      orgId: session.profile.org_id
    });

    return jsonResponse<CompensationBandsResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "COMPENSATION_BANDS_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load compensation bands data."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
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

  let parsedPayload: z.infer<typeof createPayloadSchema>;

  try {
    const json = (await request.json()) as unknown;
    const parseResult = createPayloadSchema.safeParse(json);

    if (!parseResult.success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.issues[0]?.message ?? "Invalid request payload."
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

  if (parsedPayload.type === "band") {
    const { data: insertedBandIdRow, error: insertError } = await supabase
      .from("compensation_bands")
      .insert({
        org_id: session.profile.org_id,
        title: parsedPayload.title.trim(),
        level: normalizeOptionalText(parsedPayload.level),
        department: normalizeOptionalText(parsedPayload.department),
        location_type: parsedPayload.locationType,
        location_value:
          parsedPayload.locationType === "global"
            ? null
            : normalizeOptionalText(parsedPayload.locationValue),
        currency: normalizeCurrency(parsedPayload.currency),
        min_salary_amount: parsedPayload.minSalaryAmount,
        mid_salary_amount: parsedPayload.midSalaryAmount,
        max_salary_amount: parsedPayload.maxSalaryAmount,
        equity_min: parsedPayload.equityMin,
        equity_max: parsedPayload.equityMax,
        effective_from: parsedPayload.effectiveFrom,
        effective_to: parsedPayload.effectiveTo,
        created_by: session.profile.id,
        updated_by: session.profile.id,
        deleted_at: null
      })
      .select("id")
      .single();

    if (insertError || !insertedBandIdRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "COMPENSATION_BAND_CREATE_FAILED",
          message: "Unable to create compensation band."
        },
        meta: buildMeta()
      });
    }

    const parsedId = idSchema.safeParse(insertedBandIdRow);

    if (!parsedId.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "COMPENSATION_BAND_CREATE_FAILED",
          message: "Created compensation band id is invalid."
        },
        meta: buildMeta()
      });
    }

    const snapshot = await fetchCompensationBandsData({
      supabase,
      orgId: session.profile.org_id
    });

    const createdBand = snapshot.bands.find((row) => row.id === parsedId.data.id);

    if (!createdBand) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "COMPENSATION_BAND_CREATE_FAILED",
          message: "Unable to load created compensation band."
        },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "created",
      tableName: "compensation_bands",
      recordId: createdBand.id,
      newValue: {
        title: createdBand.title,
        level: createdBand.level,
        locationType: createdBand.locationType,
        locationValue: createdBand.locationValue,
        currency: createdBand.currency,
        minSalaryAmount: createdBand.minSalaryAmount,
        midSalaryAmount: createdBand.midSalaryAmount,
        maxSalaryAmount: createdBand.maxSalaryAmount
      }
    });

    return jsonResponse<CompensationBandCreateResponseData>(201, {
      data: {
        band: createdBand
      },
      error: null,
      meta: buildMeta()
    });
  }

  if (parsedPayload.type === "benchmark") {
    const { data: insertedBenchmarkIdRow, error: insertError } = await supabase
      .from("benchmark_data")
      .insert({
        org_id: session.profile.org_id,
        source: parsedPayload.source.trim(),
        title: parsedPayload.title.trim(),
        level: normalizeOptionalText(parsedPayload.level),
        location: normalizeOptionalText(parsedPayload.location),
        currency: normalizeCurrency(parsedPayload.currency),
        p25: parsedPayload.p25,
        p50: parsedPayload.p50,
        p75: parsedPayload.p75,
        p90: parsedPayload.p90,
        imported_by: session.profile.id,
        deleted_at: null
      })
      .select("id")
      .single();

    if (insertError || !insertedBenchmarkIdRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "BENCHMARK_CREATE_FAILED",
          message: "Unable to create benchmark row."
        },
        meta: buildMeta()
      });
    }

    const parsedId = idSchema.safeParse(insertedBenchmarkIdRow);

    if (!parsedId.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "BENCHMARK_CREATE_FAILED",
          message: "Created benchmark id is invalid."
        },
        meta: buildMeta()
      });
    }

    const snapshot = await fetchCompensationBandsData({
      supabase,
      orgId: session.profile.org_id
    });

    const createdBenchmark = snapshot.benchmarks.find((row) => row.id === parsedId.data.id);

    if (!createdBenchmark) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "BENCHMARK_CREATE_FAILED",
          message: "Unable to load created benchmark row."
        },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "created",
      tableName: "benchmark_data",
      recordId: createdBenchmark.id,
      newValue: {
        source: createdBenchmark.source,
        title: createdBenchmark.title,
        level: createdBenchmark.level,
        location: createdBenchmark.location,
        currency: createdBenchmark.currency,
        p25: createdBenchmark.p25,
        p50: createdBenchmark.p50,
        p75: createdBenchmark.p75,
        p90: createdBenchmark.p90
      }
    });

    return jsonResponse<BenchmarkCreateResponseData>(201, {
      data: {
        benchmark: createdBenchmark
      },
      error: null,
      meta: buildMeta()
    });
  }

  const { data: bandRow, error: bandError } = await supabase
    .from("compensation_bands")
    .select("id")
    .eq("id", parsedPayload.bandId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (bandError || !bandRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "BAND_NOT_FOUND",
        message: "The selected compensation band was not found."
      },
      meta: buildMeta()
    });
  }

  const { data: employeeRow, error: employeeError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", parsedPayload.employeeId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (employeeError || !employeeRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "The selected employee was not found."
      },
      meta: buildMeta()
    });
  }

  const { data: currentActiveAssignmentRows, error: activeAssignmentError } = await supabase
    .from("compensation_band_assignments")
    .select("id, effective_from")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", parsedPayload.employeeId)
    .is("deleted_at", null)
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1);

  if (activeAssignmentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_FETCH_FAILED",
        message: "Unable to load active band assignment."
      },
      meta: buildMeta()
    });
  }

  const currentActiveAssignment = currentActiveAssignmentRows?.[0] ?? null;

  if (
    currentActiveAssignment &&
    typeof currentActiveAssignment.effective_from === "string" &&
    parsedPayload.effectiveFrom <= currentActiveAssignment.effective_from
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "New assignment effective date must be after the current active assignment start date."
      },
      meta: buildMeta()
    });
  }

  if (currentActiveAssignment && typeof currentActiveAssignment.id === "string") {
    const { error: closeAssignmentError } = await supabase
      .from("compensation_band_assignments")
      .update({
        effective_to: oneDayBefore(parsedPayload.effectiveFrom)
      })
      .eq("id", currentActiveAssignment.id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null);

    if (closeAssignmentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ASSIGNMENT_CLOSE_FAILED",
          message: "Unable to close the current active assignment."
        },
        meta: buildMeta()
      });
    }
  }

  const { data: insertedAssignmentIdRow, error: insertError } = await supabase
    .from("compensation_band_assignments")
    .insert({
      org_id: session.profile.org_id,
      band_id: parsedPayload.bandId,
      employee_id: parsedPayload.employeeId,
      assigned_by: session.profile.id,
      effective_from: parsedPayload.effectiveFrom,
      effective_to: parsedPayload.effectiveTo,
      deleted_at: null
    })
    .select("id")
    .single();

  if (insertError || !insertedAssignmentIdRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_CREATE_FAILED",
        message: "Unable to create compensation band assignment."
      },
      meta: buildMeta()
    });
  }

  const parsedId = idSchema.safeParse(insertedAssignmentIdRow);

  if (!parsedId.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_CREATE_FAILED",
        message: "Created assignment id is invalid."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationBandsData({
    supabase,
    orgId: session.profile.org_id
  });

  const createdAssignment = snapshot.assignments.find((row) => row.id === parsedId.data.id);

  if (!createdAssignment) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ASSIGNMENT_CREATE_FAILED",
        message: "Unable to load created assignment."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "compensation_band_assignments",
    recordId: createdAssignment.id,
    newValue: {
      employeeId: createdAssignment.employeeId,
      bandId: createdAssignment.bandId,
      effectiveFrom: createdAssignment.effectiveFrom,
      effectiveTo: createdAssignment.effectiveTo
    }
  });

  return jsonResponse<CompensationBandAssignmentCreateResponseData>(201, {
    data: {
      assignment: createdAssignment
    },
    error: null,
    meta: buildMeta()
  });
}
