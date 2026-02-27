import "server-only";

import { z } from "zod";

import type { CalculatePayrollItemParams, CountryPayrollEngine } from "../../../types/payroll";
import { createSupabaseServiceRoleClient } from "../../supabase/service-role";
import {
  calculateNigeriaPayrollBreakdown,
  toNigeriaPayrollCalculationResult,
  validateNigeriaRuleConfig,
  type NigeriaPayeBracketRule,
  type NigeriaRuleConfig
} from "./nigeria-calculation";

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

const deductionRuleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  country_code: z.string().length(2),
  rule_type: z.string(),
  rule_name: z.string(),
  bracket_min: z.union([z.number(), z.string()]).nullable(),
  bracket_max: z.union([z.number(), z.string()]).nullable(),
  rate: z.union([z.number(), z.string()]).nullable(),
  flat_amount: z.union([z.number(), z.string()]).nullable(),
  employer_portion_rate: z.union([z.number(), z.string()]).nullable(),
  calculation_order: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable()
});

type DeductionRuleRow = z.infer<typeof deductionRuleRowSchema>;

type UpsertNigeriaRuleConfigParams = {
  orgId: string;
  effectiveFrom: string;
  config: NigeriaRuleConfig;
};

type LoadNigeriaRuleConfigParams = {
  orgId: string;
  effectiveDate?: string | null;
};

type NigeriaRuleRowPayload = {
  rule_type: string;
  rule_name: string;
  bracket_min: number | null;
  bracket_max: number | null;
  rate: number | null;
  flat_amount: number | null;
  employer_portion_rate: number | null;
  calculation_order: number;
  notes: string | null;
};

type NigeriaRuleKeyInput = Pick<
  NigeriaRuleRowPayload,
  "rule_type" | "rule_name" | "bracket_min" | "bracket_max"
>;

function defaultEffectiveDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEffectiveDate(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return defaultEffectiveDate();
  }

  const trimmedValue = value.trim();

  if (!dateStringRegex.test(trimmedValue)) {
    return defaultEffectiveDate();
  }

  return trimmedValue;
}

function parseNumeric(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseInteger(value: string | number | null): number | null {
  const parsed = parseNumeric(value);

  if (parsed === null) {
    return null;
  }

  return Math.trunc(parsed);
}

function toRuleKey(value: NigeriaRuleKeyInput): string {
  return [
    value.rule_type,
    value.rule_name.toLowerCase(),
    value.bracket_min === null ? "null" : String(value.bracket_min),
    value.bracket_max === null ? "null" : String(value.bracket_max)
  ].join("|");
}

function toRuleKeyFromRow(row: DeductionRuleRow): string {
  return toRuleKey({
    rule_type: row.rule_type,
    rule_name: row.rule_name,
    bracket_min: parseInteger(row.bracket_min),
    bracket_max: parseInteger(row.bracket_max)
  });
}

function normalizeRate(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return value;
}

function requireRate(value: number | null, label: string): number {
  const normalized = normalizeRate(value);

  if (normalized === null) {
    throw new Error(`${label} is missing or invalid.`);
  }

  return normalized;
}

function requireAmount(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is missing or invalid.`);
  }

  return Math.trunc(value);
}

function latestRowsByKey(rows: readonly DeductionRuleRow[]): DeductionRuleRow[] {
  const keyedRows = new Map<string, DeductionRuleRow>();

  for (const row of rows) {
    const key = toRuleKeyFromRow(row);
    const existing = keyedRows.get(key);

    if (!existing) {
      keyedRows.set(key, row);
      continue;
    }

    if (row.effective_from > existing.effective_from) {
      keyedRows.set(key, row);
    }
  }

  return [...keyedRows.values()];
}

function mapRowsToNigeriaConfig(rows: readonly DeductionRuleRow[]): NigeriaRuleConfig {
  const selectedRows = latestRowsByKey(rows);
  const payeBrackets: NigeriaPayeBracketRule[] = selectedRows
    .filter((row) => row.rule_type === "income_tax")
    .map((row) => {
      const bracketMin = parseInteger(row.bracket_min);
      const rate = parseNumeric(row.rate);

      if (bracketMin === null) {
        throw new Error(`PAYE bracket minimum is missing for ${row.rule_name}.`);
      }

      return {
        ruleName: row.rule_name,
        bracketMin,
        bracketMax: parseInteger(row.bracket_max),
        rate: requireRate(rate, `PAYE rate for ${row.rule_name}`),
        calculationOrder: row.calculation_order
      };
    })
    .sort((left, right) => {
      if (left.calculationOrder !== right.calculationOrder) {
        return left.calculationOrder - right.calculationOrder;
      }

      return left.bracketMin - right.bracketMin;
    });

  const findRule = (ruleType: string, ruleName: string): DeductionRuleRow | null =>
    selectedRows.find(
      (row) => row.rule_type === ruleType && row.rule_name.toLowerCase() === ruleName.toLowerCase()
    ) ?? null;

  const findRuleByType = (ruleType: string): DeductionRuleRow | null =>
    selectedRows.find((row) => row.rule_type === ruleType) ?? null;

  const craFixed = findRule("relief", "CRA Fixed");
  const craOnePercent = findRule("relief", "CRA 1%");
  const craTwentyPercent = findRule("relief", "CRA 20%");
  const pensionEmployee = findRuleByType("pension_employee");
  const pensionEmployer = findRuleByType("pension_employer");
  const nhf = findRuleByType("housing_fund");
  const nsitf = findRuleByType("social_insurance");

  if (!craFixed || !craOnePercent || !craTwentyPercent) {
    throw new Error("Nigeria CRA rules are not configured.");
  }

  if (!pensionEmployee || !pensionEmployer || !nhf || !nsitf) {
    throw new Error("Nigeria pension/NHF/NSITF rules are not fully configured.");
  }

  const config: NigeriaRuleConfig = {
    payeBrackets,
    craFixedAmount: requireAmount(parseInteger(craFixed.flat_amount), "CRA fixed amount"),
    craPercentRate: requireRate(parseNumeric(craOnePercent.rate), "CRA 1% rate"),
    craAdditionalRate: requireRate(parseNumeric(craTwentyPercent.rate), "CRA 20% rate"),
    pensionEmployeeRate: requireRate(
      parseNumeric(pensionEmployee.rate),
      "Pension employee rate"
    ),
    pensionEmployerRate: requireRate(
      parseNumeric(pensionEmployer.employer_portion_rate) ?? parseNumeric(pensionEmployer.rate),
      "Pension employer rate"
    ),
    nhfRate: requireRate(parseNumeric(nhf.rate), "NHF rate"),
    nsitfEmployeeRate: requireRate(parseNumeric(nsitf.rate), "NSITF employee rate"),
    nsitfEmployerRate: requireRate(
      parseNumeric(nsitf.employer_portion_rate) ?? parseNumeric(nsitf.rate),
      "NSITF employer rate"
    )
  };

  const configError = validateNigeriaRuleConfig(config);

  if (configError) {
    throw new Error(configError);
  }

  return config;
}

function mapConfigToRuleRows(config: NigeriaRuleConfig): NigeriaRuleRowPayload[] {
  const rows: NigeriaRuleRowPayload[] = config.payeBrackets
    .sort((left, right) => {
      if (left.calculationOrder !== right.calculationOrder) {
        return left.calculationOrder - right.calculationOrder;
      }

      return left.bracketMin - right.bracketMin;
    })
    .map((bracket) => ({
      rule_type: "income_tax",
      rule_name: bracket.ruleName,
      bracket_min: bracket.bracketMin,
      bracket_max: bracket.bracketMax,
      rate: bracket.rate,
      flat_amount: null,
      employer_portion_rate: null,
      calculation_order: bracket.calculationOrder,
      notes: "Nigeria PAYE bracket"
    }));

  rows.push(
    {
      rule_type: "relief",
      rule_name: "CRA Fixed",
      bracket_min: null,
      bracket_max: null,
      rate: null,
      flat_amount: config.craFixedAmount,
      employer_portion_rate: null,
      calculation_order: 100,
      notes: "Consolidated Relief Allowance fixed amount"
    },
    {
      rule_type: "relief",
      rule_name: "CRA 1%",
      bracket_min: null,
      bracket_max: null,
      rate: config.craPercentRate,
      flat_amount: null,
      employer_portion_rate: null,
      calculation_order: 101,
      notes: "Consolidated Relief Allowance 1% component"
    },
    {
      rule_type: "relief",
      rule_name: "CRA 20%",
      bracket_min: null,
      bracket_max: null,
      rate: config.craAdditionalRate,
      flat_amount: null,
      employer_portion_rate: null,
      calculation_order: 102,
      notes: "Consolidated Relief Allowance 20% component"
    },
    {
      rule_type: "pension_employee",
      rule_name: "Pension (Employee)",
      bracket_min: null,
      bracket_max: null,
      rate: config.pensionEmployeeRate,
      flat_amount: null,
      employer_portion_rate: null,
      calculation_order: 200,
      notes: "Employee pension contribution"
    },
    {
      rule_type: "pension_employer",
      rule_name: "Pension (Employer)",
      bracket_min: null,
      bracket_max: null,
      rate: null,
      flat_amount: null,
      employer_portion_rate: config.pensionEmployerRate,
      calculation_order: 201,
      notes: "Employer pension contribution"
    },
    {
      rule_type: "housing_fund",
      rule_name: "NHF",
      bracket_min: null,
      bracket_max: null,
      rate: config.nhfRate,
      flat_amount: null,
      employer_portion_rate: null,
      calculation_order: 300,
      notes: "National Housing Fund contribution"
    },
    {
      rule_type: "social_insurance",
      rule_name: "NSITF",
      bracket_min: null,
      bracket_max: null,
      rate: config.nsitfEmployeeRate,
      flat_amount: null,
      employer_portion_rate: config.nsitfEmployerRate,
      calculation_order: 400,
      notes: "National Social Insurance Trust Fund contribution"
    }
  );

  return rows;
}

export function buildDefaultNigeriaRuleConfig(): NigeriaRuleConfig {
  return {
    payeBrackets: [
      {
        ruleName: "PAYE 0 - 300,000 NGN",
        bracketMin: 0,
        bracketMax: 30_000_000,
        rate: 0.07,
        calculationOrder: 0
      },
      {
        ruleName: "PAYE 300,000 - 600,000 NGN",
        bracketMin: 30_000_000,
        bracketMax: 60_000_000,
        rate: 0.11,
        calculationOrder: 1
      },
      {
        ruleName: "PAYE 600,000 - 1,100,000 NGN",
        bracketMin: 60_000_000,
        bracketMax: 110_000_000,
        rate: 0.15,
        calculationOrder: 2
      },
      {
        ruleName: "PAYE 1,100,000 - 1,600,000 NGN",
        bracketMin: 110_000_000,
        bracketMax: 160_000_000,
        rate: 0.19,
        calculationOrder: 3
      },
      {
        ruleName: "PAYE 1,600,000 - 3,200,000 NGN",
        bracketMin: 160_000_000,
        bracketMax: 320_000_000,
        rate: 0.21,
        calculationOrder: 4
      },
      {
        ruleName: "PAYE Above 3,200,000 NGN",
        bracketMin: 320_000_000,
        bracketMax: null,
        rate: 0.24,
        calculationOrder: 5
      }
    ],
    craFixedAmount: 20_000_000,
    craPercentRate: 0.01,
    craAdditionalRate: 0.2,
    pensionEmployeeRate: 0.08,
    pensionEmployerRate: 0.1,
    nhfRate: 0.025,
    nsitfEmployeeRate: 0.01,
    nsitfEmployerRate: 0.01
  };
}

export async function loadNigeriaRuleConfig({
  orgId,
  effectiveDate
}: LoadNigeriaRuleConfigParams): Promise<NigeriaRuleConfig> {
  const serviceClient = createSupabaseServiceRoleClient();
  const normalizedDate = normalizeEffectiveDate(effectiveDate);

  const { data, error } = await serviceClient
    .from("deduction_rules")
    .select(
      "id, org_id, country_code, rule_type, rule_name, bracket_min, bracket_max, rate, flat_amount, employer_portion_rate, calculation_order, effective_from, effective_to"
    )
    .eq("org_id", orgId)
    .eq("country_code", "NG")
    .lte("effective_from", normalizedDate)
    .or(`effective_to.is.null,effective_to.gte.${normalizedDate}`);

  if (error) {
    throw new Error(`Unable to load Nigeria deduction rules: ${error.message}`);
  }

  const parsed = z.array(deductionRuleRowSchema).safeParse(data ?? []);

  if (!parsed.success) {
    throw new Error("Nigeria deduction rules are not in the expected format.");
  }

  if (parsed.data.length === 0) {
    throw new Error("Nigeria deduction rules are not configured for this organization.");
  }

  return mapRowsToNigeriaConfig(parsed.data);
}

export async function upsertNigeriaRuleConfig({
  orgId,
  effectiveFrom,
  config
}: UpsertNigeriaRuleConfigParams): Promise<void> {
  const normalizedEffectiveFrom = normalizeEffectiveDate(effectiveFrom);
  const configError = validateNigeriaRuleConfig(config);

  if (configError) {
    throw new Error(configError);
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const targetRows = mapConfigToRuleRows(config);

  const { data: existingRows, error: existingRowsError } = await serviceClient
    .from("deduction_rules")
    .select("id, rule_type, rule_name, bracket_min, bracket_max")
    .eq("org_id", orgId)
    .eq("country_code", "NG")
    .eq("effective_from", normalizedEffectiveFrom);

  if (existingRowsError) {
    throw new Error(`Unable to load existing Nigeria deduction rules: ${existingRowsError.message}`);
  }

  const existingByKey = new Map<string, string>();

  for (const row of existingRows ?? []) {
    if (typeof row.id !== "string") {
      continue;
    }

    const ruleType = typeof row.rule_type === "string" ? row.rule_type : "";
    const ruleName = typeof row.rule_name === "string" ? row.rule_name : "";
    const bracketMin =
      typeof row.bracket_min === "number"
        ? Math.trunc(row.bracket_min)
        : typeof row.bracket_min === "string"
          ? Math.trunc(Number.parseFloat(row.bracket_min))
          : null;
    const bracketMax =
      typeof row.bracket_max === "number"
        ? Math.trunc(row.bracket_max)
        : typeof row.bracket_max === "string"
          ? Math.trunc(Number.parseFloat(row.bracket_max))
          : null;

    existingByKey.set(
      toRuleKey({
        rule_type: ruleType,
        rule_name: ruleName,
        bracket_min: Number.isFinite(bracketMin) ? bracketMin : null,
        bracket_max: Number.isFinite(bracketMax) ? bracketMax : null
      }),
      row.id
    );
  }

  for (const row of targetRows) {
    const existingRuleId =
      existingByKey.get(
        toRuleKey({
          rule_type: row.rule_type,
          rule_name: row.rule_name,
          bracket_min: row.bracket_min,
          bracket_max: row.bracket_max
        })
      ) ?? null;

    if (existingRuleId) {
      const { error: updateError } = await serviceClient
        .from("deduction_rules")
        .update({
          rate: row.rate,
          flat_amount: row.flat_amount,
          employer_portion_rate: row.employer_portion_rate,
          calculation_order: row.calculation_order,
          notes: row.notes,
          effective_to: null
        })
        .eq("id", existingRuleId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update Nigeria deduction rule: ${updateError.message}`);
      }

      continue;
    }

    const { error: insertError } = await serviceClient
      .from("deduction_rules")
      .insert({
        org_id: orgId,
        country_code: "NG",
        rule_type: row.rule_type,
        rule_name: row.rule_name,
        bracket_min: row.bracket_min,
        bracket_max: row.bracket_max,
        rate: row.rate,
        flat_amount: row.flat_amount,
        employer_portion_rate: row.employer_portion_rate,
        effective_from: normalizedEffectiveFrom,
        effective_to: null,
        calculation_order: row.calculation_order,
        notes: row.notes
      });

    if (insertError) {
      throw new Error(`Unable to insert Nigeria deduction rule: ${insertError.message}`);
    }
  }
}

export const nigeriaEngine: CountryPayrollEngine = {
  async calculate(params: CalculatePayrollItemParams) {
    const orgId = params.employee.org_id;

    if (!orgId) {
      throw new Error("Missing org_id for Nigeria payroll calculation.");
    }

    const ruleConfig = await loadNigeriaRuleConfig({
      orgId,
      effectiveDate: params.effective_date
    });
    const breakdown = calculateNigeriaPayrollBreakdown(params, ruleConfig);

    return toNigeriaPayrollCalculationResult(breakdown, ruleConfig);
  }
};
