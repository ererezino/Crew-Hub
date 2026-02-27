"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../../components/ui/currency-display";
import { MoneyInput } from "../../../../../components/ui/money-input";
import {
  calculateNigeriaPayrollBreakdown,
  validateNigeriaRuleConfig,
  type NigeriaRuleConfig
} from "../../../../../lib/payroll/engines/nigeria-calculation";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";

const COMING_SOON_COUNTRIES = ["GH", "KE", "ZA", "CA"] as const;
const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

type NigeriaBracketFormRow = {
  ruleName: string;
  bracketMin: number;
  bracketMax: number | null;
  calculationOrder: number;
  ratePercent: string;
};

type NigeriaConfigFormValues = {
  effectiveFrom: string;
  payeBrackets: NigeriaBracketFormRow[];
  craFixedAmount: string;
  craPercentRate: string;
  craAdditionalRate: string;
  pensionEmployeeRate: string;
  pensionEmployerRate: string;
  nhfRate: string;
  nsitfEmployeeRate: string;
  nsitfEmployerRate: string;
};

type NigeriaConfigFormErrors = Partial<Record<string, string>>;

type SaveNigeriaConfigResponse = {
  data: {
    effectiveFrom: string;
    config: NigeriaRuleConfig;
  } | null;
  error: {
    message: string;
  } | null;
};

function todayAsDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function rateToPercentString(rate: number): string {
  return (rate * 100).toFixed(4).replace(/\.?0+$/, "");
}

function toFormValues(config: NigeriaRuleConfig, effectiveFrom: string): NigeriaConfigFormValues {
  return {
    effectiveFrom,
    payeBrackets: config.payeBrackets
      .map((bracket) => ({
        ruleName: bracket.ruleName,
        bracketMin: bracket.bracketMin,
        bracketMax: bracket.bracketMax,
        calculationOrder: bracket.calculationOrder,
        ratePercent: rateToPercentString(bracket.rate)
      }))
      .sort((left, right) => left.calculationOrder - right.calculationOrder),
    craFixedAmount: String(config.craFixedAmount),
    craPercentRate: rateToPercentString(config.craPercentRate),
    craAdditionalRate: rateToPercentString(config.craAdditionalRate),
    pensionEmployeeRate: rateToPercentString(config.pensionEmployeeRate),
    pensionEmployerRate: rateToPercentString(config.pensionEmployerRate),
    nhfRate: rateToPercentString(config.nhfRate),
    nsitfEmployeeRate: rateToPercentString(config.nsitfEmployeeRate),
    nsitfEmployerRate: rateToPercentString(config.nsitfEmployerRate)
  };
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePercentToRate(value: string): number | null {
  const trimmedValue = value.trim();

  if (!/^\d+(\.\d{1,6})?$/.test(trimmedValue)) {
    return null;
  }

  const parsed = Number.parseFloat(trimmedValue);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null;
  }

  return parsed / 100;
}

function parseConfigFormValues(
  values: NigeriaConfigFormValues
): {
  errors: NigeriaConfigFormErrors;
  config: NigeriaRuleConfig | null;
} {
  const errors: NigeriaConfigFormErrors = {};

  if (!dateStringRegex.test(values.effectiveFrom)) {
    errors.effectiveFrom = "Effective date is required.";
  }

  const payeBrackets = values.payeBrackets.map((bracket, index) => {
    const parsedRate = parsePercentToRate(bracket.ratePercent);

    if (parsedRate === null) {
      errors[`payeBrackets.${index}.ratePercent`] = "Rate must be between 0 and 100.";
    }

    return {
      ...bracket,
      rate: parsedRate
    };
  });

  const craFixedAmount = parseInteger(values.craFixedAmount);

  if (craFixedAmount === null) {
    errors.craFixedAmount = "CRA fixed amount must be a whole number in kobo.";
  }

  const craPercentRate = parsePercentToRate(values.craPercentRate);
  const craAdditionalRate = parsePercentToRate(values.craAdditionalRate);
  const pensionEmployeeRate = parsePercentToRate(values.pensionEmployeeRate);
  const pensionEmployerRate = parsePercentToRate(values.pensionEmployerRate);
  const nhfRate = parsePercentToRate(values.nhfRate);
  const nsitfEmployeeRate = parsePercentToRate(values.nsitfEmployeeRate);
  const nsitfEmployerRate = parsePercentToRate(values.nsitfEmployerRate);

  if (craPercentRate === null) {
    errors.craPercentRate = "CRA 1% rate must be between 0 and 100.";
  }

  if (craAdditionalRate === null) {
    errors.craAdditionalRate = "CRA 20% rate must be between 0 and 100.";
  }

  if (pensionEmployeeRate === null) {
    errors.pensionEmployeeRate = "Pension employee rate must be between 0 and 100.";
  }

  if (pensionEmployerRate === null) {
    errors.pensionEmployerRate = "Pension employer rate must be between 0 and 100.";
  }

  if (nhfRate === null) {
    errors.nhfRate = "NHF rate must be between 0 and 100.";
  }

  if (nsitfEmployeeRate === null) {
    errors.nsitfEmployeeRate = "NSITF employee rate must be between 0 and 100.";
  }

  if (nsitfEmployerRate === null) {
    errors.nsitfEmployerRate = "NSITF employer rate must be between 0 and 100.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      errors,
      config: null
    };
  }

  const config: NigeriaRuleConfig = {
    payeBrackets: payeBrackets.map((row) => ({
      ruleName: row.ruleName,
      bracketMin: row.bracketMin,
      bracketMax: row.bracketMax,
      calculationOrder: row.calculationOrder,
      rate: row.rate ?? 0
    })),
    craFixedAmount: craFixedAmount ?? 0,
    craPercentRate: craPercentRate ?? 0,
    craAdditionalRate: craAdditionalRate ?? 0,
    pensionEmployeeRate: pensionEmployeeRate ?? 0,
    pensionEmployerRate: pensionEmployerRate ?? 0,
    nhfRate: nhfRate ?? 0,
    nsitfEmployeeRate: nsitfEmployeeRate ?? 0,
    nsitfEmployerRate: nsitfEmployerRate ?? 0
  };

  const configError = validateNigeriaRuleConfig(config);

  if (configError) {
    return {
      errors: {
        form: configError
      },
      config: null
    };
  }

  return {
    errors: {},
    config
  };
}

function parseMajorCurrencyInputToKobo(value: string): number {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number.parseFloat(value.trim());

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.round(parsed * 100);
}

function percentLabel(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function rowClassName(index: number): string {
  return index % 2 === 0
    ? "payroll-breakdown-row payroll-breakdown-row-even"
    : "payroll-breakdown-row";
}

export function DeductionsSettingsClient({
  initialNigeriaConfig,
  initialNigeriaConfigError,
  canEditNigeria
}: {
  initialNigeriaConfig: NigeriaRuleConfig | null;
  initialNigeriaConfigError: string | null;
  canEditNigeria: boolean;
}) {
  const [formValues, setFormValues] = useState<NigeriaConfigFormValues | null>(
    initialNigeriaConfig ? toFormValues(initialNigeriaConfig, todayAsDateString()) : null
  );
  const [formErrors, setFormErrors] = useState<NigeriaConfigFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [monthlyGrossInput, setMonthlyGrossInput] = useState("150000");
  const [monthlyBasicInput, setMonthlyBasicInput] = useState("120000");

  const parsedConfig = useMemo(() => {
    if (!formValues) {
      return null;
    }

    return parseConfigFormValues(formValues);
  }, [formValues]);

  const monthlyGrossAmount = parseMajorCurrencyInputToKobo(monthlyGrossInput);
  const monthlyBasicAmount = parseMajorCurrencyInputToKobo(monthlyBasicInput);

  const previewBreakdown = useMemo(() => {
    if (!parsedConfig?.config) {
      return null;
    }

    return calculateNigeriaPayrollBreakdown(
      {
        monthly_gross_amount: monthlyGrossAmount,
        monthly_base_salary_amount: monthlyBasicAmount
      },
      parsedConfig.config
    );
  }, [monthlyBasicAmount, monthlyGrossAmount, parsedConfig]);

  const onRateChange = (index: number, nextValue: string) => {
    setFormValues((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        payeBrackets: current.payeBrackets.map((bracket, rowIndex) =>
          rowIndex === index ? { ...bracket, ratePercent: nextValue } : bracket
        )
      };
    });
  };

  const onSaveNigeriaSettings = async () => {
    if (!canEditNigeria || !formValues) {
      return;
    }

    const parsed = parseConfigFormValues(formValues);
    setFormErrors(parsed.errors);
    setSaveMessage(null);

    if (!parsed.config) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/v1/payroll/settings/deductions/nigeria", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          effectiveFrom: formValues.effectiveFrom,
          config: parsed.config
        })
      });

      const payload = (await response.json()) as SaveNigeriaConfigResponse;

      if (!response.ok || !payload.data) {
        setSaveMessage(payload.error?.message ?? "Unable to save Nigeria withholding rules.");
        return;
      }

      setFormValues(toFormValues(payload.data.config, payload.data.effectiveFrom));
      setSaveMessage("Nigeria withholding rules saved.");
      setFormErrors({});
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to save Nigeria withholding rules."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="settings-layout" aria-label="Payroll withholding settings">
      <article className="settings-card payroll-withholding-note">
        <h2 className="section-title">Tax Withholding by Country</h2>
        <p className="settings-card-description">
          All team members are currently classified as contractors. Taxes are not withheld.
          When employee withholding is enabled for a country, statutory deductions will be
          calculated automatically.
        </p>
      </article>

      <article className="settings-card payroll-country-item payroll-country-item-active">
        <div className="payroll-country-copy">
          <p className="country-chip">
            <span>{countryFlagFromCode("NG")}</span>
            <span>{countryNameFromCode("NG")}</span>
          </p>
          <p className="settings-card-description">
            Statutory withholding is active for employee mode and fully configured.
          </p>
        </div>
        <div className="payroll-country-actions">
          <StatusBadge tone="success">Active</StatusBadge>
        </div>
      </article>

      <section className="settings-card payroll-country-list" aria-label="Country rollout list">
        {COMING_SOON_COUNTRIES.map((countryCode) => {
          const countryName = countryNameFromCode(countryCode);
          const lockLabel = `${countryName} withholding is coming soon`;

          return (
            <article key={countryCode} className="payroll-country-item">
              <div className="payroll-country-copy">
                <p className="country-chip">
                  <span>{countryFlagFromCode(countryCode)}</span>
                  <span>{countryName}</span>
                </p>
                <p className="settings-card-description">
                  Statutory withholding configuration is not enabled yet.
                </p>
              </div>

              <div className="payroll-country-actions">
                <div className="payroll-coming-soon">
                  <StatusBadge tone="draft">Coming soon</StatusBadge>
                  <svg className="payroll-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="payroll-lock-label">{lockLabel}</span>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="settings-card" aria-label="Nigeria withholding configuration">
        <h2 className="section-title">Nigeria Statutory Rules</h2>
        <p className="settings-card-description">
          Configure PAYE brackets, CRA, pension, NHF, and NSITF for payroll mode{" "}
          <code>employee_local_withholding</code>.
        </p>

        {initialNigeriaConfigError ? (
          <EmptyState
            title="Nigeria rules unavailable"
            description={initialNigeriaConfigError}
            ctaLabel="Back to payroll"
            ctaHref="/payroll"
          />
        ) : null}

        {!initialNigeriaConfigError && formValues ? (
          <>
            <label className="form-field" htmlFor="nigeria-effective-date">
              <span className="form-label">Effective from</span>
              <input
                id="nigeria-effective-date"
                type="date"
                className={
                  formErrors.effectiveFrom ? "form-input form-input-error" : "form-input"
                }
                value={formValues.effectiveFrom}
                onChange={(event) =>
                  setFormValues((current) =>
                    current ? { ...current, effectiveFrom: event.currentTarget.value } : current
                  )
                }
                disabled={!canEditNigeria}
              />
              {formErrors.effectiveFrom ? (
                <p className="form-field-error">{formErrors.effectiveFrom}</p>
              ) : null}
            </label>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bracket</th>
                    <th>Annual Taxable Range</th>
                    <th>Rate (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {formValues.payeBrackets.map((bracket, index) => (
                    <tr key={bracket.ruleName}>
                      <td>{bracket.ruleName}</td>
                      <td>
                        <span className="payroll-rate-range">
                          <CurrencyDisplay amount={bracket.bracketMin} currency="NGN" />
                          <span aria-hidden="true"> - </span>
                          {bracket.bracketMax !== null ? (
                            <CurrencyDisplay amount={bracket.bracketMax} currency="NGN" />
                          ) : (
                            "No upper cap"
                          )}
                        </span>
                      </td>
                      <td>
                        <label className="payroll-rate-input" htmlFor={`paye-rate-${index}`}>
                          <input
                            id={`paye-rate-${index}`}
                            type="number"
                            min={0}
                            max={100}
                            step="0.0001"
                            className={
                              formErrors[`payeBrackets.${index}.ratePercent`]
                                ? "form-input form-input-error"
                                : "form-input"
                            }
                            value={bracket.ratePercent}
                            onChange={(event) => onRateChange(index, event.currentTarget.value)}
                            disabled={!canEditNigeria}
                          />
                        </label>
                        {formErrors[`payeBrackets.${index}.ratePercent`] ? (
                          <p className="form-field-error">
                            {formErrors[`payeBrackets.${index}.ratePercent`]}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="payroll-rules-grid">
              <label className="form-field" htmlFor="cra-fixed-amount">
                <span className="form-label">CRA Fixed Amount (kobo)</span>
                <input
                  id="cra-fixed-amount"
                  type="text"
                  className={
                    formErrors.craFixedAmount ? "form-input form-input-error" : "form-input numeric"
                  }
                  value={formValues.craFixedAmount}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, craFixedAmount: event.currentTarget.value.trim() }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.craFixedAmount ? (
                  <p className="form-field-error">{formErrors.craFixedAmount}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="cra-one-rate">
                <span className="form-label">CRA 1% Rate</span>
                <input
                  id="cra-one-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.craPercentRate ? "form-input form-input-error" : "form-input"
                  }
                  value={formValues.craPercentRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, craPercentRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.craPercentRate ? (
                  <p className="form-field-error">{formErrors.craPercentRate}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="cra-twenty-rate">
                <span className="form-label">CRA 20% Rate</span>
                <input
                  id="cra-twenty-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.craAdditionalRate ? "form-input form-input-error" : "form-input"
                  }
                  value={formValues.craAdditionalRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, craAdditionalRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.craAdditionalRate ? (
                  <p className="form-field-error">{formErrors.craAdditionalRate}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="pension-employee-rate">
                <span className="form-label">Pension Employee Rate</span>
                <input
                  id="pension-employee-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.pensionEmployeeRate
                      ? "form-input form-input-error"
                      : "form-input"
                  }
                  value={formValues.pensionEmployeeRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, pensionEmployeeRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.pensionEmployeeRate ? (
                  <p className="form-field-error">{formErrors.pensionEmployeeRate}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="pension-employer-rate">
                <span className="form-label">Pension Employer Rate</span>
                <input
                  id="pension-employer-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.pensionEmployerRate
                      ? "form-input form-input-error"
                      : "form-input"
                  }
                  value={formValues.pensionEmployerRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, pensionEmployerRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.pensionEmployerRate ? (
                  <p className="form-field-error">{formErrors.pensionEmployerRate}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="nhf-rate">
                <span className="form-label">NHF Rate</span>
                <input
                  id="nhf-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={formErrors.nhfRate ? "form-input form-input-error" : "form-input"}
                  value={formValues.nhfRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current ? { ...current, nhfRate: event.currentTarget.value } : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.nhfRate ? <p className="form-field-error">{formErrors.nhfRate}</p> : null}
              </label>

              <label className="form-field" htmlFor="nsitf-employee-rate">
                <span className="form-label">NSITF Employee Rate</span>
                <input
                  id="nsitf-employee-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.nsitfEmployeeRate
                      ? "form-input form-input-error"
                      : "form-input"
                  }
                  value={formValues.nsitfEmployeeRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, nsitfEmployeeRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.nsitfEmployeeRate ? (
                  <p className="form-field-error">{formErrors.nsitfEmployeeRate}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="nsitf-employer-rate">
                <span className="form-label">NSITF Employer Rate</span>
                <input
                  id="nsitf-employer-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.0001"
                  className={
                    formErrors.nsitfEmployerRate
                      ? "form-input form-input-error"
                      : "form-input"
                  }
                  value={formValues.nsitfEmployerRate}
                  onChange={(event) =>
                    setFormValues((current) =>
                      current
                        ? { ...current, nsitfEmployerRate: event.currentTarget.value }
                        : current
                    )
                  }
                  disabled={!canEditNigeria}
                />
                {formErrors.nsitfEmployerRate ? (
                  <p className="form-field-error">{formErrors.nsitfEmployerRate}</p>
                ) : null}
              </label>
            </div>

            {formErrors.form ? <p className="form-field-error">{formErrors.form}</p> : null}

            <div className="settings-actions">
              <button
                type="button"
                className="button button-accent"
                disabled={!canEditNigeria || isSaving}
                onClick={() => {
                  void onSaveNigeriaSettings();
                }}
              >
                {isSaving ? "Saving..." : "Save Nigeria rules"}
              </button>
            </div>

            {saveMessage ? (
              <p className="settings-feedback" role="status">
                {saveMessage}
              </p>
            ) : null}

            {!canEditNigeria ? (
              <p className="settings-card-description">
                Only Finance Admin and Super Admin can edit Nigeria withholding rules.
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="settings-card" aria-label="Nigeria withholding preview calculator">
        <h2 className="section-title">Nigeria Preview Calculator</h2>
        <p className="settings-card-description">
          Enter monthly gross and monthly basic pay in NGN to preview PAYE, pension, NHF, NSITF,
          net pay, and employer costs.
        </p>

        <div className="payroll-preview-input-grid">
          <label className="form-field" htmlFor="nigeria-preview-monthly-gross">
            <span className="form-label">Monthly Gross (NGN)</span>
            <MoneyInput
              id="nigeria-preview-monthly-gross"
              currency="NGN"
              value={monthlyGrossInput}
              onChange={setMonthlyGrossInput}
              placeholder="150000"
            />
          </label>

          <label className="form-field" htmlFor="nigeria-preview-monthly-basic">
            <span className="form-label">Monthly Basic (NGN)</span>
            <MoneyInput
              id="nigeria-preview-monthly-basic"
              currency="NGN"
              value={monthlyBasicInput}
              onChange={setMonthlyBasicInput}
              placeholder="120000"
            />
          </label>
        </div>

        {!previewBreakdown ? (
          <EmptyState
            title="Preview unavailable"
            description="Fix Nigeria rule validation errors above to generate a preview."
            ctaLabel="Back to payroll"
            ctaHref="/payroll"
          />
        ) : (
          <>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Annual Gross",
                      value: previewBreakdown.annualGrossAmount
                    },
                    {
                      label: "CRA (max of fixed or 1%)",
                      value: previewBreakdown.craFixedOrPercentAmount
                    },
                    {
                      label: "CRA 20%",
                      value: previewBreakdown.craTwentyPercentAmount
                    },
                    {
                      label: "CRA Total",
                      value: previewBreakdown.craTotalAmount
                    },
                    {
                      label: "Annual Pension (Employee)",
                      value: previewBreakdown.annualPensionAmount
                    },
                    {
                      label: "Taxable Income",
                      value: previewBreakdown.taxableIncomeAmount
                    },
                    {
                      label: "Annual PAYE",
                      value: previewBreakdown.annualPayeAmount
                    },
                    {
                      label: "Monthly PAYE",
                      value: previewBreakdown.monthlyPayeAmount
                    },
                    {
                      label: "Monthly Pension",
                      value: previewBreakdown.monthlyPensionAmount
                    },
                    {
                      label: "Monthly NHF",
                      value: previewBreakdown.monthlyNhfAmount
                    },
                    {
                      label: "Monthly NSITF",
                      value: previewBreakdown.monthlyNsitfAmount
                    },
                    {
                      label: "Total Deductions",
                      value: previewBreakdown.totalDeductions
                    },
                    {
                      label: "Net Pay",
                      value: previewBreakdown.netAmount
                    },
                    {
                      label: "Employer Pension",
                      value: previewBreakdown.monthlyEmployerPensionAmount
                    },
                    {
                      label: "Employer NSITF",
                      value: previewBreakdown.monthlyEmployerNsitfAmount
                    },
                    {
                      label: "Total Employer Contributions",
                      value: previewBreakdown.totalEmployerContributions
                    }
                  ].map((row, index) => (
                    <tr key={row.label} className={rowClassName(index)}>
                      <td>{row.label}</td>
                      <td>
                        <CurrencyDisplay amount={row.value} currency="NGN" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PAYE Bracket</th>
                    <th>Rate</th>
                    <th>Annual Taxable Portion</th>
                    <th>Annual PAYE</th>
                    <th>Monthly PAYE</th>
                  </tr>
                </thead>
                <tbody>
                  {previewBreakdown.payeByBracket.map((row, index) => (
                    <tr key={`${row.ruleName}-${row.bracketMin}`} className={rowClassName(index)}>
                      <td>{row.ruleName}</td>
                      <td className="numeric">{percentLabel(row.rate)}</td>
                      <td>
                        <CurrencyDisplay amount={row.taxableAmount} currency="NGN" />
                      </td>
                      <td>
                        <CurrencyDisplay amount={row.annualAmount} currency="NGN" />
                      </td>
                      <td>
                        <CurrencyDisplay amount={row.monthlyAmount} currency="NGN" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
