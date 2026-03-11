"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { ErrorState } from "../../../../../components/shared/error-state";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../../components/ui/currency-display";
import { MoneyInput } from "../../../../../components/ui/money-input";
import {
  calculateNigeriaPayrollBreakdown,
  validateNigeriaRuleConfig,
  type NigeriaRuleConfig
} from "../../../../../lib/payroll/engines/nigeria-calculation";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import type { AppLocale } from "../../../../../i18n/locales";
import { todayIsoDate } from "../../../../../lib/datetime";

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

type TranslatorFn = (key: string) => string;

function todayAsDateString(): string {
  return todayIsoDate();
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
  values: NigeriaConfigFormValues,
  t: TranslatorFn
): {
  errors: NigeriaConfigFormErrors;
  config: NigeriaRuleConfig | null;
} {
  const errors: NigeriaConfigFormErrors = {};

  if (!dateStringRegex.test(values.effectiveFrom)) {
    errors.effectiveFrom = t("effectiveDateRequired");
  }

  const payeBrackets = values.payeBrackets.map((bracket, index) => {
    const parsedRate = parsePercentToRate(bracket.ratePercent);

    if (parsedRate === null) {
      errors[`payeBrackets.${index}.ratePercent`] = t("rateValidation");
    }

    return {
      ...bracket,
      rate: parsedRate
    };
  });

  const craFixedAmount = parseInteger(values.craFixedAmount);

  if (craFixedAmount === null) {
    errors.craFixedAmount = t("craFixedError");
  }

  const craPercentRate = parsePercentToRate(values.craPercentRate);
  const craAdditionalRate = parsePercentToRate(values.craAdditionalRate);
  const pensionEmployeeRate = parsePercentToRate(values.pensionEmployeeRate);
  const pensionEmployerRate = parsePercentToRate(values.pensionEmployerRate);
  const nhfRate = parsePercentToRate(values.nhfRate);
  const nsitfEmployeeRate = parsePercentToRate(values.nsitfEmployeeRate);
  const nsitfEmployerRate = parsePercentToRate(values.nsitfEmployerRate);

  if (craPercentRate === null) {
    errors.craPercentRate = t("craOneError");
  }

  if (craAdditionalRate === null) {
    errors.craAdditionalRate = t("craTwentyError");
  }

  if (pensionEmployeeRate === null) {
    errors.pensionEmployeeRate = t("pensionEmployeeError");
  }

  if (pensionEmployerRate === null) {
    errors.pensionEmployerRate = t("pensionEmployerError");
  }

  if (nhfRate === null) {
    errors.nhfRate = t("nhfError");
  }

  if (nsitfEmployeeRate === null) {
    errors.nsitfEmployeeRate = t("nsitfEmployeeError");
  }

  if (nsitfEmployerRate === null) {
    errors.nsitfEmployerRate = t("nsitfEmployerError");
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
  const t = useTranslations('payrollSettings');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

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

    return parseConfigFormValues(formValues, t as TranslatorFn);
  }, [formValues, t]);

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

    const parsed = parseConfigFormValues(formValues, t as TranslatorFn);
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
        setSaveMessage(payload.error?.message ?? t("saveError"));
        return;
      }

      setFormValues(toFormValues(payload.data.config, payload.data.effectiveFrom));
      setSaveMessage(t("saveSuccess"));
      setFormErrors({});
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : t("saveError")
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="settings-layout" aria-label={t("sectionAriaLabel")}>
      <article className="settings-card payroll-withholding-note">
        <h2 className="section-title">{t("withholdingTitle")}</h2>
        <p className="settings-card-description">
          {t("withholdingDescription")}
        </p>
      </article>

      <article className="settings-card payroll-country-item payroll-country-item-active">
        <div className="payroll-country-copy">
          <p className="country-chip">
            <span>{countryFlagFromCode("NG")}</span>
            <span>{countryNameFromCode("NG", locale)}</span>
          </p>
          <p className="settings-card-description">
            {t("nigeriaActive")}
          </p>
        </div>
        <div className="payroll-country-actions">
          <StatusBadge tone="success">{tCommon("status.active")}</StatusBadge>
        </div>
      </article>

      <section className="settings-card payroll-country-list" aria-label={t("countryListAria")}>
        {COMING_SOON_COUNTRIES.map((countryCode) => {
          const countryName = countryNameFromCode(countryCode, locale);
          const lockLabel = t("comingSoonLabel", { country: countryName });

          return (
            <article key={countryCode} className="payroll-country-item">
              <div className="payroll-country-copy">
                <p className="country-chip">
                  <span>{countryFlagFromCode(countryCode)}</span>
                  <span>{countryName}</span>
                </p>
                <p className="settings-card-description">
                  {t("withholdingNotEnabled")}
                </p>
              </div>

              <div className="payroll-country-actions">
                <div className="payroll-coming-soon">
                  <StatusBadge tone="draft">{t("comingSoon")}</StatusBadge>
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

      <section className="settings-card" aria-label={t("nigeriaConfigAria")}>
        <h2 className="section-title">{t("nigeriaRulesTitle")}</h2>
        <p className="settings-card-description">
          {t("nigeriaRulesDescription")}{" "}
          <code>employee_local_withholding</code>.
        </p>

        {initialNigeriaConfigError ? (
          <ErrorState
            title={t("nigeriaUnavailable")}
            message={initialNigeriaConfigError}
          />
        ) : null}

        {!initialNigeriaConfigError && formValues ? (
          <>
            <label className="form-field" htmlFor="nigeria-effective-date">
              <span className="form-label">{t("effectiveFrom")}</span>
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
                    <th>{t("thBracket")}</th>
                    <th>{t("thAnnualTaxableRange")}</th>
                    <th>{t("thRate")}</th>
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
                            t("noUpperCap")
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
                <span className="form-label">{t("craFixedAmount")}</span>
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
                <span className="form-label">{t("craOneRate")}</span>
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
                <span className="form-label">{t("craTwentyRate")}</span>
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
                <span className="form-label">{t("pensionEmployeeRate")}</span>
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
                <span className="form-label">{t("pensionEmployerRate")}</span>
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
                <span className="form-label">{t("nhfRate")}</span>
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
                <span className="form-label">{t("nsitfEmployeeRate")}</span>
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
                <span className="form-label">{t("nsitfEmployerRate")}</span>
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
                {isSaving ? t("saving") : t("saveNigeriaRules")}
              </button>
            </div>

            {saveMessage ? (
              <p className="settings-feedback" role="status">
                {saveMessage}
              </p>
            ) : null}

            {!canEditNigeria ? (
              <p className="settings-card-description">
                {t("editPermission")}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="settings-card" aria-label={t("previewAriaLabel")}>
        <h2 className="section-title">{t("previewTitle")}</h2>
        <p className="settings-card-description">
          {t("previewDescription")}
        </p>

        <div className="payroll-preview-input-grid">
          <label className="form-field" htmlFor="nigeria-preview-monthly-gross">
            <span className="form-label">{t("monthlyGross")}</span>
            <MoneyInput
              id="nigeria-preview-monthly-gross"
              currency="NGN"
              value={monthlyGrossInput}
              onChange={setMonthlyGrossInput}
              placeholder="150000"
            />
          </label>

          <label className="form-field" htmlFor="nigeria-preview-monthly-basic">
            <span className="form-label">{t("monthlyBasic")}</span>
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
            title={t("previewUnavailable")}
            description={t("previewFixErrors")}
            ctaLabel={t("backToPayroll")}
            ctaHref="/payroll"
          />
        ) : (
          <>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("thMetric")}</th>
                    <th>{t("thValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: t("annualGross"),
                      value: previewBreakdown.annualGrossAmount
                    },
                    {
                      label: t("craFixedOrPercent"),
                      value: previewBreakdown.craFixedOrPercentAmount
                    },
                    {
                      label: t("craTwentyPercent"),
                      value: previewBreakdown.craTwentyPercentAmount
                    },
                    {
                      label: t("craTotal"),
                      value: previewBreakdown.craTotalAmount
                    },
                    {
                      label: t("annualPensionEmployee"),
                      value: previewBreakdown.annualPensionAmount
                    },
                    {
                      label: t("taxableIncome"),
                      value: previewBreakdown.taxableIncomeAmount
                    },
                    {
                      label: t("annualPaye"),
                      value: previewBreakdown.annualPayeAmount
                    },
                    {
                      label: t("monthlyPaye"),
                      value: previewBreakdown.monthlyPayeAmount
                    },
                    {
                      label: t("monthlyPension"),
                      value: previewBreakdown.monthlyPensionAmount
                    },
                    {
                      label: t("monthlyNhf"),
                      value: previewBreakdown.monthlyNhfAmount
                    },
                    {
                      label: t("monthlyNsitf"),
                      value: previewBreakdown.monthlyNsitfAmount
                    },
                    {
                      label: t("totalDeductions"),
                      value: previewBreakdown.totalDeductions
                    },
                    {
                      label: t("netPay"),
                      value: previewBreakdown.netAmount
                    },
                    {
                      label: t("employerPension"),
                      value: previewBreakdown.monthlyEmployerPensionAmount
                    },
                    {
                      label: t("employerNsitf"),
                      value: previewBreakdown.monthlyEmployerNsitfAmount
                    },
                    {
                      label: t("totalEmployerContributions"),
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
                    <th>{t("thPayeBracket")}</th>
                    <th>{t("thPayeRate")}</th>
                    <th>{t("thAnnualTaxablePortion")}</th>
                    <th>{t("thAnnualPaye")}</th>
                    <th>{t("thMonthlyPaye")}</th>
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
