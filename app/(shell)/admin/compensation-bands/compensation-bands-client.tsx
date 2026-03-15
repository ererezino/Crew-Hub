"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useCompensationBands } from "../../../../hooks/use-compensation-bands";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import {
  formatDateTimeTooltip,
  formatRelativeTime,
  todayIsoDate
} from "../../../../lib/datetime";
import { type CompensationBandLocationType } from "../../../../types/compensation-bands";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type BandFormValues = {
  title: string;
  level: string;
  department: string;
  locationType: CompensationBandLocationType;
  locationValue: string;
  currency: string;
  minSalaryAmount: string;
  midSalaryAmount: string;
  maxSalaryAmount: string;
  equityMin: string;
  equityMax: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type BandFormErrors = Partial<Record<keyof BandFormValues, string>>;

type BenchmarkFormValues = {
  source: string;
  title: string;
  level: string;
  location: string;
  currency: string;
  p25: string;
  p50: string;
  p75: string;
  p90: string;
};

type BenchmarkFormErrors = Partial<Record<keyof BenchmarkFormValues, string>>;

type AssignmentFormValues = {
  employeeId: string;
  bandId: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type AssignmentFormErrors = Partial<Record<keyof AssignmentFormValues, string>>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const INITIAL_BAND_FORM: BandFormValues = {
  title: "",
  level: "",
  department: "",
  locationType: "global",
  locationValue: "",
  currency: "USD",
  minSalaryAmount: "",
  midSalaryAmount: "",
  maxSalaryAmount: "",
  equityMin: "",
  equityMax: "",
  effectiveFrom: todayIsoDate(),
  effectiveTo: ""
};

const INITIAL_BENCHMARK_FORM: BenchmarkFormValues = {
  source: "",
  title: "",
  level: "",
  location: "",
  currency: "USD",
  p25: "",
  p50: "",
  p75: "",
  p90: ""
};

const INITIAL_ASSIGNMENT_FORM: AssignmentFormValues = {
  employeeId: "",
  bandId: "",
  effectiveFrom: todayIsoDate(),
  effectiveTo: ""
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateOnlyToDateTime(dateValue: string | null): string | null {
  if (!dateValue) {
    return null;
  }

  return `${dateValue}T00:00:00.000Z`;
}

function isDigits(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function parseInteger(value: string): number {
  return Number.parseInt(value.trim(), 10);
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => typeof value === "string" && value.length > 0);
}

function alertTone(status: "below_band" | "above_band" | "missing_salary") {
  if (status === "below_band") {
    return "warning" as const;
  }

  if (status === "above_band") {
    return "error" as const;
  }

  return "pending" as const;
}

function bandTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`comp-bands-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function CompensationBandsClient() {
  const t = useTranslations('compensationBands');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const _td = t as (key: string, params?: Record<string, unknown>) => string;

  const bandsQuery = useCompensationBands();

  const [isBandPanelOpen, setIsBandPanelOpen] = useState(false);
  const [isBenchmarkPanelOpen, setIsBenchmarkPanelOpen] = useState(false);
  const [isAssignmentPanelOpen, setIsAssignmentPanelOpen] = useState(false);
  const [editingBandId, setEditingBandId] = useState<string | null>(null);

  const [bandFormValues, setBandFormValues] = useState<BandFormValues>(INITIAL_BAND_FORM);
  const [bandFormErrors, setBandFormErrors] = useState<BandFormErrors>({});
  const [isSubmittingBand, setIsSubmittingBand] = useState(false);

  const [benchmarkFormValues, setBenchmarkFormValues] = useState<BenchmarkFormValues>(INITIAL_BENCHMARK_FORM);
  const [benchmarkFormErrors, setBenchmarkFormErrors] = useState<BenchmarkFormErrors>({});
  const [isSubmittingBenchmark, setIsSubmittingBenchmark] = useState(false);

  const [assignmentFormValues, setAssignmentFormValues] = useState<AssignmentFormValues>(INITIAL_ASSIGNMENT_FORM);
  const [assignmentFormErrors, setAssignmentFormErrors] = useState<AssignmentFormErrors>({});
  const [isSubmittingAssignment, setIsSubmittingAssignment] = useState(false);

  const [bandSortDirection, setBandSortDirection] = useState<SortDirection>("asc");
  const [alertSortDirection, setAlertSortDirection] = useState<SortDirection>("asc");

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function validateBandForm(values: BandFormValues): BandFormErrors {
    const errors: BandFormErrors = {};

    if (!values.title.trim()) {
      errors.title = t('bandPanel.validation.titleRequired');
    }

    if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
      errors.currency = t('bandPanel.validation.currencyFormat');
    }

    if (!isDigits(values.minSalaryAmount)) {
      errors.minSalaryAmount = t('bandPanel.validation.minSalaryInteger');
    }

    if (!isDigits(values.midSalaryAmount)) {
      errors.midSalaryAmount = t('bandPanel.validation.midSalaryInteger');
    }

    if (!isDigits(values.maxSalaryAmount)) {
      errors.maxSalaryAmount = t('bandPanel.validation.maxSalaryInteger');
    }

    if (values.equityMin.trim().length > 0 && !isDigits(values.equityMin)) {
      errors.equityMin = t('bandPanel.validation.equityMinInteger');
    }

    if (values.equityMax.trim().length > 0 && !isDigits(values.equityMax)) {
      errors.equityMax = t('bandPanel.validation.equityMaxInteger');
    }

    if (!isoDatePattern.test(values.effectiveFrom)) {
      errors.effectiveFrom = t('bandPanel.validation.effectiveFromFormat');
    }

    if (values.effectiveTo.trim().length > 0 && !isoDatePattern.test(values.effectiveTo)) {
      errors.effectiveTo = t('bandPanel.validation.effectiveToFormat');
    }

    if (values.locationType !== "global" && !values.locationValue.trim()) {
      errors.locationValue = t('bandPanel.validation.locationValueRequired');
    }

    if (
      isDigits(values.minSalaryAmount) &&
      isDigits(values.midSalaryAmount) &&
      parseInteger(values.midSalaryAmount) < parseInteger(values.minSalaryAmount)
    ) {
      errors.midSalaryAmount = t('bandPanel.validation.midSalaryMinComparison');
    }

    if (
      isDigits(values.midSalaryAmount) &&
      isDigits(values.maxSalaryAmount) &&
      parseInteger(values.maxSalaryAmount) < parseInteger(values.midSalaryAmount)
    ) {
      errors.maxSalaryAmount = t('bandPanel.validation.maxSalaryMidComparison');
    }

    if (values.effectiveTo.trim().length > 0 && values.effectiveTo < values.effectiveFrom) {
      errors.effectiveTo = t('bandPanel.validation.effectiveToAfterFrom');
    }

    if (
      values.equityMin.trim().length > 0 &&
      values.equityMax.trim().length > 0 &&
      isDigits(values.equityMin) &&
      isDigits(values.equityMax) &&
      parseInteger(values.equityMax) < parseInteger(values.equityMin)
    ) {
      errors.equityMax = t('bandPanel.validation.equityMaxMinComparison');
    }

    return errors;
  }

  function validateBenchmarkForm(values: BenchmarkFormValues): BenchmarkFormErrors {
    const errors: BenchmarkFormErrors = {};

    if (!values.source.trim()) {
      errors.source = t('benchmarkPanel.validation.sourceRequired');
    }

    if (!values.title.trim()) {
      errors.title = t('benchmarkPanel.validation.titleRequired');
    }

    if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
      errors.currency = t('benchmarkPanel.validation.currencyFormat');
    }

    const percentileFields: Array<keyof BenchmarkFormValues> = ["p25", "p50", "p75", "p90"];

    for (const field of percentileFields) {
      const fieldValue = values[field].trim();

      if (fieldValue.length > 0 && !isDigits(fieldValue)) {
        errors[field] = t('benchmarkPanel.validation.percentileInteger');
      }
    }

    if (isDigits(values.p25) && isDigits(values.p50) && parseInteger(values.p25) > parseInteger(values.p50)) {
      errors.p50 = t('benchmarkPanel.validation.p50GeP25');
    }

    if (isDigits(values.p50) && isDigits(values.p75) && parseInteger(values.p50) > parseInteger(values.p75)) {
      errors.p75 = t('benchmarkPanel.validation.p75GeP50');
    }

    if (isDigits(values.p75) && isDigits(values.p90) && parseInteger(values.p75) > parseInteger(values.p90)) {
      errors.p90 = t('benchmarkPanel.validation.p90GeP75');
    }

    return errors;
  }

  function validateAssignmentForm(values: AssignmentFormValues): AssignmentFormErrors {
    const errors: AssignmentFormErrors = {};

    if (!values.employeeId.trim()) {
      errors.employeeId = t('assignmentPanel.validation.employeeRequired');
    }

    if (!values.bandId.trim()) {
      errors.bandId = t('assignmentPanel.validation.bandRequired');
    }

    if (!isoDatePattern.test(values.effectiveFrom)) {
      errors.effectiveFrom = t('assignmentPanel.validation.effectiveFromFormat');
    }

    if (values.effectiveTo.trim().length > 0 && !isoDatePattern.test(values.effectiveTo)) {
      errors.effectiveTo = t('assignmentPanel.validation.effectiveToFormat');
    }

    if (values.effectiveTo.trim().length > 0 && values.effectiveTo < values.effectiveFrom) {
      errors.effectiveTo = t('assignmentPanel.validation.effectiveToAfterFrom');
    }

    return errors;
  }

  function alertLabel(status: "below_band" | "above_band" | "missing_salary") {
    if (status === "below_band") {
      return t('alerts.belowBand');
    }

    if (status === "above_band") {
      return t('alerts.aboveBand');
    }

    return t('alerts.missingSalary');
  }

  function assignmentStatus(
    effectiveFrom: string,
    effectiveTo: string | null
  ): { label: string; tone: "success" | "info" | "draft" } {
    const today = todayIsoDate();

    if (effectiveFrom > today) {
      return {
        label: t('bandStatus.scheduled'),
        tone: "info"
      };
    }

    if (effectiveTo && effectiveTo < today) {
      return {
        label: t('bandStatus.historical'),
        tone: "draft"
      };
    }

    return {
      label: t('bandStatus.active'),
      tone: "success"
    };
  }

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
    }, 4000);
  };

  const sortedBands = useMemo(() => {
    const rows = bandsQuery.data?.bands ?? [];

    return [...rows].sort((leftBand, rightBand) => {
      const leftLabel = `${leftBand.title} ${leftBand.level ?? ""}`.trim();
      const rightLabel = `${rightBand.title} ${rightBand.level ?? ""}`.trim();
      const comparison = leftLabel.localeCompare(rightLabel);

      return bandSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [bandSortDirection, bandsQuery.data?.bands]);

  const sortedAlerts = useMemo(() => {
    const rows = bandsQuery.data?.alerts ?? [];

    return [...rows].sort((leftAlert, rightAlert) => {
      const comparison = leftAlert.employeeName.localeCompare(rightAlert.employeeName);
      return alertSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [alertSortDirection, bandsQuery.data?.alerts]);

  const sortedBenchmarks = useMemo(() => {
    const rows = bandsQuery.data?.benchmarks ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      return new Date(rightRow.importedAt).getTime() - new Date(leftRow.importedAt).getTime();
    });
  }, [bandsQuery.data?.benchmarks]);

  const sortedAssignments = useMemo(() => {
    const rows = bandsQuery.data?.assignments ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      return new Date(rightRow.assignedAt).getTime() - new Date(leftRow.assignedAt).getTime();
    });
  }, [bandsQuery.data?.assignments]);

  const activeEmployeeOptions = useMemo(() => {
    return (bandsQuery.data?.employeeOptions ?? []).filter((employee) => employee.status === "active");
  }, [bandsQuery.data?.employeeOptions]);

  const resetBandPanel = () => {
    setIsBandPanelOpen(false);
    setEditingBandId(null);
    setBandFormValues(INITIAL_BAND_FORM);
    setBandFormErrors({});
    setIsSubmittingBand(false);
  };

  const resetBenchmarkPanel = () => {
    setIsBenchmarkPanelOpen(false);
    setBenchmarkFormValues(INITIAL_BENCHMARK_FORM);
    setBenchmarkFormErrors({});
    setIsSubmittingBenchmark(false);
  };

  const resetAssignmentPanel = () => {
    setIsAssignmentPanelOpen(false);
    setAssignmentFormValues(INITIAL_ASSIGNMENT_FORM);
    setAssignmentFormErrors({});
    setIsSubmittingAssignment(false);
  };

  const handleOpenCreateBand = () => {
    setEditingBandId(null);
    setBandFormValues(INITIAL_BAND_FORM);
    setBandFormErrors({});
    setIsBandPanelOpen(true);
  };

  const handleOpenEditBand = (bandId: string) => {
    const selectedBand = (bandsQuery.data?.bands ?? []).find((row) => row.id === bandId);

    if (!selectedBand) {
      showToast("error", t('toast.bandNotFound'));
      return;
    }

    setEditingBandId(selectedBand.id);
    setBandFormValues({
      title: selectedBand.title,
      level: selectedBand.level ?? "",
      department: selectedBand.department ?? "",
      locationType: selectedBand.locationType,
      locationValue: selectedBand.locationValue ?? "",
      currency: selectedBand.currency,
      minSalaryAmount: String(selectedBand.minSalaryAmount),
      midSalaryAmount: String(selectedBand.midSalaryAmount),
      maxSalaryAmount: String(selectedBand.maxSalaryAmount),
      equityMin: selectedBand.equityMin === null ? "" : String(selectedBand.equityMin),
      equityMax: selectedBand.equityMax === null ? "" : String(selectedBand.equityMax),
      effectiveFrom: selectedBand.effectiveFrom,
      effectiveTo: selectedBand.effectiveTo ?? ""
    });
    setBandFormErrors({});
    setIsBandPanelOpen(true);
  };

  const handleBandSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateBandForm(bandFormValues);
    setBandFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingBand(true);

    const payload = {
      title: bandFormValues.title,
      level: bandFormValues.level,
      department: bandFormValues.department,
      locationType: bandFormValues.locationType,
      locationValue: bandFormValues.locationValue,
      currency: bandFormValues.currency,
      minSalaryAmount: bandFormValues.minSalaryAmount,
      midSalaryAmount: bandFormValues.midSalaryAmount,
      maxSalaryAmount: bandFormValues.maxSalaryAmount,
      equityMin: bandFormValues.equityMin.trim().length > 0 ? bandFormValues.equityMin : null,
      equityMax: bandFormValues.equityMax.trim().length > 0 ? bandFormValues.equityMax : null,
      effectiveFrom: bandFormValues.effectiveFrom,
      effectiveTo: bandFormValues.effectiveTo.trim().length > 0 ? bandFormValues.effectiveTo : null
    };

    const result = editingBandId
      ? await bandsQuery.updateBand(editingBandId, payload)
      : await bandsQuery.createBand(payload);

    if (!result.success) {
      showToast("error", result.errorMessage ?? t('toast.bandSaveError'));
      setIsSubmittingBand(false);
      return;
    }

    showToast("success", editingBandId ? t('toast.bandUpdated') : t('toast.bandCreated'));
    resetBandPanel();
  };

  const handleBenchmarkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateBenchmarkForm(benchmarkFormValues);
    setBenchmarkFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingBenchmark(true);

    const payload = {
      source: benchmarkFormValues.source,
      title: benchmarkFormValues.title,
      level: benchmarkFormValues.level,
      location: benchmarkFormValues.location,
      currency: benchmarkFormValues.currency,
      p25: benchmarkFormValues.p25.trim().length > 0 ? benchmarkFormValues.p25 : null,
      p50: benchmarkFormValues.p50.trim().length > 0 ? benchmarkFormValues.p50 : null,
      p75: benchmarkFormValues.p75.trim().length > 0 ? benchmarkFormValues.p75 : null,
      p90: benchmarkFormValues.p90.trim().length > 0 ? benchmarkFormValues.p90 : null
    };

    const result = await bandsQuery.createBenchmark(payload);

    if (!result.success) {
      showToast("error", result.errorMessage ?? t('toast.benchmarkSaveError'));
      setIsSubmittingBenchmark(false);
      return;
    }

    showToast("success", t('toast.benchmarkAdded'));
    resetBenchmarkPanel();
  };

  const handleAssignmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateAssignmentForm(assignmentFormValues);
    setAssignmentFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingAssignment(true);

    const result = await bandsQuery.createAssignment({
      employeeId: assignmentFormValues.employeeId,
      bandId: assignmentFormValues.bandId,
      effectiveFrom: assignmentFormValues.effectiveFrom,
      effectiveTo:
        assignmentFormValues.effectiveTo.trim().length > 0
          ? assignmentFormValues.effectiveTo
          : null
    });

    if (!result.success) {
      showToast("error", result.errorMessage ?? t('toast.assignmentSaveError'));
      setIsSubmittingAssignment(false);
      return;
    }

    showToast("success", t('toast.assignmentSaved'));
    resetAssignmentPanel();
  };

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
      />

      <section className="onboarding-header-actions" aria-label={t('table.ariaLabel')}>
        <button type="button" className="button button-accent" onClick={handleOpenCreateBand}>
          {t('table.newBand')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setIsBenchmarkPanelOpen(true);
            setBenchmarkFormErrors({});
          }}
        >
          {t('table.addBenchmark')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setIsAssignmentPanelOpen(true);
            setAssignmentFormErrors({});
          }}
        >
          {t('table.assignEmployee')}
        </button>
      </section>

      {bandsQuery.isLoading ? bandTableSkeleton() : null}

      {!bandsQuery.isLoading && bandsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('emptyState.errorTitle')}
            description={bandsQuery.errorMessage}
          />
          <button type="button" className="button" onClick={() => bandsQuery.refresh()}>
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!bandsQuery.isLoading && !bandsQuery.errorMessage && bandsQuery.data ? (
        <section className="compensation-layout" aria-label={t('table.overviewAriaLabel')}>
          <article className="metric-card">
            <div>
              <h2 className="section-title">{t('table.coverageSummary')}</h2>
              <p className="settings-card-description">
                {t('table.coverageSummaryDescription', {
                  bandCount: bandsQuery.data.bands.length,
                  assignmentCount: bandsQuery.data.assignments.length,
                  alertCount: bandsQuery.data.alerts.length
                })}
              </p>
            </div>
            <StatusBadge tone={bandsQuery.data.alerts.length > 0 ? "warning" : "success"}>
              {bandsQuery.data.alerts.length > 0 ? t('table.actionNeeded') : t('table.healthy')}
            </StatusBadge>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('alerts.sectionTitle')}</h2>
                <p className="settings-card-description">
                  {t('alerts.sectionDescription')}
                </p>
              </div>
            </header>

            {sortedAlerts.length === 0 ? (
              <EmptyState
                title={t('emptyState.noAlertsTitle')}
                description={t('emptyState.noAlertsDescription')}
                ctaLabel={t('emptyState.reviewBands')}
                ctaHref="/admin/compensation-bands"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('alerts.tableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setAlertSortDirection((currentDirection) =>
                              currentDirection === "asc" ? "desc" : "asc"
                            )
                          }
                        >
                          {t('alerts.columnEmployee')}
                          <span className="numeric">{alertSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                        </button>
                      </th>
                      <th>{t('alerts.columnBand')}</th>
                      <th>{t('alerts.columnCurrentSalary')}</th>
                      <th>{t('alerts.columnBandRange')}</th>
                      <th>{t('alerts.columnCompaRatio')}</th>
                      <th>{tCommon('status.label')}</th>
                      <th className="table-action-column">{t('table.columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAlerts.map((alert) => (
                      <tr key={`${alert.employeeId}-${alert.bandId}`} className="data-table-row">
                        <td>
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{alert.employeeName}</p>
                            <p className="documents-cell-description">{alert.employeeTitle ?? t('table.noTitle')}</p>
                            <p className="documents-cell-description country-chip">
                              <span>{countryFlagFromCode(alert.countryCode)}</span>
                              <span>{countryNameFromCode(alert.countryCode, locale)}</span>
                            </p>
                          </div>
                        </td>
                        <td>{alert.bandLabel}</td>
                        <td>
                          {alert.currentSalaryAmount === null ? (
                            "--"
                          ) : (
                            <CurrencyDisplay amount={alert.currentSalaryAmount} currency={alert.currency} />
                          )}
                        </td>
                        <td>
                          <div className="documents-cell-copy">
                            <CurrencyDisplay amount={alert.minSalaryAmount} currency={alert.currency} />
                            <span className="numeric">{t('table.rangeTo')}</span>
                            <CurrencyDisplay amount={alert.maxSalaryAmount} currency={alert.currency} />
                          </div>
                        </td>
                        <td className="numeric">
                          {alert.compaRatio === null ? "--" : `${(alert.compaRatio * 100).toFixed(1)}%`}
                        </td>
                        <td>
                          <StatusBadge tone={alertTone(alert.status)}>{alertLabel(alert.status)}</StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="comp-bands-row-actions">
                            <Link className="table-row-action" href={`/people/${alert.employeeId}?tab=compensation`}>
                              {t('table.viewProfile')}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('table.bandsSectionTitle')}</h2>
                <p className="settings-card-description">
                  {t('table.bandsSectionDescription')}
                </p>
              </div>
            </header>

            {sortedBands.length === 0 ? (
              <EmptyState
                title={t('emptyState.noBandsTitle')}
                description={t('emptyState.noBandsDescription')}
                ctaLabel={t('emptyState.createBand')}
                onCtaClick={handleOpenCreateBand}
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('table.bandsTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setBandSortDirection((currentDirection) =>
                              currentDirection === "asc" ? "desc" : "asc"
                            )
                          }
                        >
                          {t('table.columnRoleLevel')}
                          <span className="numeric">{bandSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                        </button>
                      </th>
                      <th>{t('table.columnDepartment')}</th>
                      <th>{t('table.columnLocation')}</th>
                      <th>{t('table.columnSalaryRange')}</th>
                      <th>{t('table.columnEquityRange')}</th>
                      <th>{t('table.columnEffective')}</th>
                      <th>{t('table.columnAssigned')}</th>
                      <th className="table-action-column">{t('table.columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBands.map((band) => {
                      const effectiveFromTimestamp = dateOnlyToDateTime(band.effectiveFrom);
                      const effectiveToTimestamp = dateOnlyToDateTime(band.effectiveTo);

                      return (
                        <tr key={band.id} className="data-table-row">
                          <td>
                            <div className="documents-cell-copy">
                              <p className="documents-cell-title">{band.title}</p>
                              <p className="documents-cell-description">{band.level ?? t('table.noLevel')}</p>
                            </div>
                          </td>
                          <td>{band.department ?? "--"}</td>
                          <td>
                            {band.locationType === "global"
                              ? t('bandPanel.locationTypeGlobal')
                              : band.locationValue ?? band.locationType}
                          </td>
                          <td>
                            <div className="documents-cell-copy">
                              <CurrencyDisplay amount={band.minSalaryAmount} currency={band.currency} />
                              <span className="numeric">{t('table.rangeTo')}</span>
                              <CurrencyDisplay amount={band.maxSalaryAmount} currency={band.currency} />
                              <span className="settings-card-description">
                                {t('table.mid')}: <CurrencyDisplay amount={band.midSalaryAmount} currency={band.currency} />
                              </span>
                            </div>
                          </td>
                          <td className="numeric">
                            {band.equityMin === null && band.equityMax === null
                              ? "--"
                              : `${band.equityMin ?? 0} ${t('table.rangeTo')} ${band.equityMax ?? 0}`}
                          </td>
                          <td>
                            <div className="documents-cell-copy">
                              <span title={effectiveFromTimestamp ? formatDateTimeTooltip(effectiveFromTimestamp, locale) : undefined}>
                                {effectiveFromTimestamp ? formatRelativeTime(effectiveFromTimestamp, locale) : "--"}
                              </span>
                              {effectiveToTimestamp ? (
                                <span className="settings-card-description" title={formatDateTimeTooltip(effectiveToTimestamp, locale)}>
                                  {t('table.ends', { date: formatRelativeTime(effectiveToTimestamp, locale) })}
                                </span>
                              ) : (
                                <span className="settings-card-description">{t('table.noEndDate')}</span>
                              )}
                            </div>
                          </td>
                          <td className="numeric">{band.assignedEmployeeCount}</td>
                          <td className="table-row-action-cell">
                            <div className="comp-bands-row-actions">
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleOpenEditBand(band.id)}
                              >
                                {t('table.edit')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('table.benchmarkSectionTitle')}</h2>
                <p className="settings-card-description">
                  {t('table.benchmarkSectionDescription')}
                </p>
              </div>
            </header>

            {sortedBenchmarks.length === 0 ? (
              <>
                <EmptyState
                  title={t('emptyState.noBenchmarksTitle')}
                  description={t('emptyState.noBenchmarksDescription')}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsBenchmarkPanelOpen(true)}
                >
                  {t('table.addBenchmark')}
                </button>
              </>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('table.benchmarkTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('table.columnSource')}</th>
                      <th>{t('table.columnRole')}</th>
                      <th>{t('table.columnLocation')}</th>
                      <th>{t('table.columnP50')}</th>
                      <th>{t('table.columnP75')}</th>
                      <th>{t('table.columnImported')}</th>
                      <th className="table-action-column">{t('table.columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBenchmarks.map((benchmark) => (
                      <tr key={benchmark.id} className="data-table-row">
                        <td>{benchmark.source}</td>
                        <td>
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{benchmark.title}</p>
                            <p className="documents-cell-description">{benchmark.level ?? t('table.noLevel')}</p>
                          </div>
                        </td>
                        <td>{benchmark.location ?? t('bandPanel.locationTypeGlobal')}</td>
                        <td>
                          {benchmark.p50 === null ? "--" : <CurrencyDisplay amount={benchmark.p50} currency={benchmark.currency} />}
                        </td>
                        <td>
                          {benchmark.p75 === null ? "--" : <CurrencyDisplay amount={benchmark.p75} currency={benchmark.currency} />}
                        </td>
                        <td>
                          <span title={formatDateTimeTooltip(benchmark.importedAt, locale)}>
                            {formatRelativeTime(benchmark.importedAt, locale)}
                          </span>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="comp-bands-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => {
                                handleOpenCreateBand();
                                setBandFormValues((currentValues) => ({
                                  ...currentValues,
                                  title: benchmark.title,
                                  level: benchmark.level ?? "",
                                  locationType: benchmark.location ? "city" : "global",
                                  locationValue: benchmark.location ?? "",
                                  currency: benchmark.currency,
                                  minSalaryAmount:
                                    benchmark.p25 === null ? currentValues.minSalaryAmount : String(benchmark.p25),
                                  midSalaryAmount:
                                    benchmark.p50 === null ? currentValues.midSalaryAmount : String(benchmark.p50),
                                  maxSalaryAmount:
                                    benchmark.p75 === null ? currentValues.maxSalaryAmount : String(benchmark.p75)
                                }));
                              }}
                            >
                              {t('emptyState.createBand')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('table.assignmentsSectionTitle')}</h2>
                <p className="settings-card-description">
                  {t('table.assignmentsSectionDescription')}
                </p>
              </div>
            </header>

            {sortedAssignments.length === 0 ? (
              <>
                <EmptyState
                  title={t('emptyState.noAssignmentsTitle')}
                  description={t('emptyState.noAssignmentsDescription')}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsAssignmentPanelOpen(true)}
                >
                  {t('table.assignEmployee')}
                </button>
              </>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('table.assignmentsTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('alerts.columnEmployee')}</th>
                      <th>{t('alerts.columnBand')}</th>
                      <th>{t('table.columnEffectiveWindow')}</th>
                      <th>{tCommon('status.label')}</th>
                      <th>{t('table.columnAssigned')}</th>
                      <th className="table-action-column">{t('table.columnActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssignments.map((assignment) => {
                      const assignmentState = assignmentStatus(assignment.effectiveFrom, assignment.effectiveTo);
                      const assignedTimestamp = assignment.assignedAt;
                      const effectiveFromTimestamp = dateOnlyToDateTime(assignment.effectiveFrom);
                      const effectiveToTimestamp = dateOnlyToDateTime(assignment.effectiveTo);

                      return (
                        <tr key={assignment.id} className="data-table-row">
                          <td>{assignment.employeeName}</td>
                          <td>{assignment.bandLabel}</td>
                          <td>
                            <div className="documents-cell-copy">
                              <span title={effectiveFromTimestamp ? formatDateTimeTooltip(effectiveFromTimestamp, locale) : undefined}>
                                {t('table.starts', { date: effectiveFromTimestamp ? formatRelativeTime(effectiveFromTimestamp, locale) : "--" })}
                              </span>
                              <span className="settings-card-description" title={effectiveToTimestamp ? formatDateTimeTooltip(effectiveToTimestamp, locale) : undefined}>
                                {effectiveToTimestamp ? t('table.ends', { date: formatRelativeTime(effectiveToTimestamp, locale) }) : t('table.noEndDate')}
                              </span>
                            </div>
                          </td>
                          <td>
                            <StatusBadge tone={assignmentState.tone}>{assignmentState.label}</StatusBadge>
                          </td>
                          <td>
                            <span title={formatDateTimeTooltip(assignedTimestamp, locale)}>{formatRelativeTime(assignedTimestamp, locale)}</span>
                          </td>
                          <td className="table-row-action-cell">
                            <div className="comp-bands-row-actions">
                              <Link
                                className="table-row-action"
                                href={`/people/${assignment.employeeId}?tab=compensation`}
                              >
                                {t('table.viewProfile')}
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}

      <SlidePanel
        isOpen={isBandPanelOpen}
        title={editingBandId ? t('bandPanel.editTitle') : t('bandPanel.createTitle')}
        description={t('bandPanel.description')}
        onClose={resetBandPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleBandSubmit}>
          <label className="form-field">
            <span className="form-label">{t('bandPanel.roleTitle')}</span>
            <input
              className={`form-input ${bandFormErrors.title ? "form-input-error" : ""}`}
              value={bandFormValues.title}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  title: event.target.value
                }))
              }
            />
            {bandFormErrors.title ? <span className="form-field-error">{bandFormErrors.title}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.level')}</span>
            <input
              className={`form-input ${bandFormErrors.level ? "form-input-error" : ""}`}
              value={bandFormValues.level}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  level: event.target.value
                }))
              }
            />
            {bandFormErrors.level ? <span className="form-field-error">{bandFormErrors.level}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.department')}</span>
            <input
              className={`form-input ${bandFormErrors.department ? "form-input-error" : ""}`}
              value={bandFormValues.department}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  department: event.target.value
                }))
              }
            />
            {bandFormErrors.department ? (
              <span className="form-field-error">{bandFormErrors.department}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.locationType')}</span>
            <select
              className={`form-input ${bandFormErrors.locationType ? "form-input-error" : ""}`}
              value={bandFormValues.locationType}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  locationType: event.target.value as CompensationBandLocationType,
                  locationValue:
                    event.target.value === "global" ? "" : currentValues.locationValue
                }))
              }
            >
              <option value="global">{t('bandPanel.locationTypeGlobal')}</option>
              <option value="country">{t('bandPanel.locationTypeCountry')}</option>
              <option value="city">{t('bandPanel.locationTypeCity')}</option>
              <option value="zone">{t('bandPanel.locationTypeZone')}</option>
            </select>
            {bandFormErrors.locationType ? (
              <span className="form-field-error">{bandFormErrors.locationType}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.locationValue')}</span>
            <input
              className={`form-input ${bandFormErrors.locationValue ? "form-input-error" : ""}`}
              value={bandFormValues.locationValue}
              disabled={bandFormValues.locationType === "global"}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  locationValue: event.target.value
                }))
              }
            />
            {bandFormErrors.locationValue ? (
              <span className="form-field-error">{bandFormErrors.locationValue}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.currency')}</span>
            <input
              className={`form-input ${bandFormErrors.currency ? "form-input-error" : ""}`}
              value={bandFormValues.currency}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  currency: event.target.value.toUpperCase()
                }))
              }
            />
            {bandFormErrors.currency ? (
              <span className="form-field-error">{bandFormErrors.currency}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.minSalary')}</span>
            <input
              className={`form-input ${bandFormErrors.minSalaryAmount ? "form-input-error" : ""}`}
              value={bandFormValues.minSalaryAmount}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  minSalaryAmount: event.target.value
                }))
              }
            />
            {bandFormErrors.minSalaryAmount ? (
              <span className="form-field-error">{bandFormErrors.minSalaryAmount}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.midSalary')}</span>
            <input
              className={`form-input ${bandFormErrors.midSalaryAmount ? "form-input-error" : ""}`}
              value={bandFormValues.midSalaryAmount}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  midSalaryAmount: event.target.value
                }))
              }
            />
            {bandFormErrors.midSalaryAmount ? (
              <span className="form-field-error">{bandFormErrors.midSalaryAmount}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.maxSalary')}</span>
            <input
              className={`form-input ${bandFormErrors.maxSalaryAmount ? "form-input-error" : ""}`}
              value={bandFormValues.maxSalaryAmount}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  maxSalaryAmount: event.target.value
                }))
              }
            />
            {bandFormErrors.maxSalaryAmount ? (
              <span className="form-field-error">{bandFormErrors.maxSalaryAmount}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.equityMin')}</span>
            <input
              className={`form-input ${bandFormErrors.equityMin ? "form-input-error" : ""}`}
              value={bandFormValues.equityMin}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  equityMin: event.target.value
                }))
              }
            />
            {bandFormErrors.equityMin ? <span className="form-field-error">{bandFormErrors.equityMin}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.equityMax')}</span>
            <input
              className={`form-input ${bandFormErrors.equityMax ? "form-input-error" : ""}`}
              value={bandFormValues.equityMax}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  equityMax: event.target.value
                }))
              }
            />
            {bandFormErrors.equityMax ? <span className="form-field-error">{bandFormErrors.equityMax}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.effectiveFrom')}</span>
            <input
              type="date"
              className={`form-input ${bandFormErrors.effectiveFrom ? "form-input-error" : ""}`}
              value={bandFormValues.effectiveFrom}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  effectiveFrom: event.target.value
                }))
              }
            />
            {bandFormErrors.effectiveFrom ? (
              <span className="form-field-error">{bandFormErrors.effectiveFrom}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('bandPanel.effectiveTo')}</span>
            <input
              type="date"
              className={`form-input ${bandFormErrors.effectiveTo ? "form-input-error" : ""}`}
              value={bandFormValues.effectiveTo}
              onChange={(event) =>
                setBandFormValues((currentValues) => ({
                  ...currentValues,
                  effectiveTo: event.target.value
                }))
              }
            />
            {bandFormErrors.effectiveTo ? (
              <span className="form-field-error">{bandFormErrors.effectiveTo}</span>
            ) : null}
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetBandPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingBand}>
              {isSubmittingBand ? tCommon('working') : editingBandId ? t('bandPanel.updateBand') : t('bandPanel.createBand')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isBenchmarkPanelOpen}
        title={t('benchmarkPanel.title')}
        description={t('benchmarkPanel.description')}
        onClose={resetBenchmarkPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleBenchmarkSubmit}>
          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.source')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.source ? "form-input-error" : ""}`}
              value={benchmarkFormValues.source}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  source: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.source ? (
              <span className="form-field-error">{benchmarkFormErrors.source}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.roleTitle')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.title ? "form-input-error" : ""}`}
              value={benchmarkFormValues.title}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  title: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.title ? <span className="form-field-error">{benchmarkFormErrors.title}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.level')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.level ? "form-input-error" : ""}`}
              value={benchmarkFormValues.level}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  level: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.level ? <span className="form-field-error">{benchmarkFormErrors.level}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.location')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.location ? "form-input-error" : ""}`}
              value={benchmarkFormValues.location}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  location: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.location ? (
              <span className="form-field-error">{benchmarkFormErrors.location}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.currency')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.currency ? "form-input-error" : ""}`}
              value={benchmarkFormValues.currency}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  currency: event.target.value.toUpperCase()
                }))
              }
            />
            {benchmarkFormErrors.currency ? (
              <span className="form-field-error">{benchmarkFormErrors.currency}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.p25')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.p25 ? "form-input-error" : ""}`}
              value={benchmarkFormValues.p25}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  p25: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.p25 ? <span className="form-field-error">{benchmarkFormErrors.p25}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.p50')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.p50 ? "form-input-error" : ""}`}
              value={benchmarkFormValues.p50}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  p50: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.p50 ? <span className="form-field-error">{benchmarkFormErrors.p50}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.p75')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.p75 ? "form-input-error" : ""}`}
              value={benchmarkFormValues.p75}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  p75: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.p75 ? <span className="form-field-error">{benchmarkFormErrors.p75}</span> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('benchmarkPanel.p90')}</span>
            <input
              className={`form-input ${benchmarkFormErrors.p90 ? "form-input-error" : ""}`}
              value={benchmarkFormValues.p90}
              onChange={(event) =>
                setBenchmarkFormValues((currentValues) => ({
                  ...currentValues,
                  p90: event.target.value
                }))
              }
            />
            {benchmarkFormErrors.p90 ? <span className="form-field-error">{benchmarkFormErrors.p90}</span> : null}
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetBenchmarkPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingBenchmark}>
              {isSubmittingBenchmark ? tCommon('working') : t('benchmarkPanel.addBenchmark')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isAssignmentPanelOpen}
        title={t('assignmentPanel.title')}
        description={t('assignmentPanel.description')}
        onClose={resetAssignmentPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleAssignmentSubmit}>
          <label className="form-field">
            <span className="form-label">{t('assignmentPanel.employee')}</span>
            <select
              className={`form-input ${assignmentFormErrors.employeeId ? "form-input-error" : ""}`}
              value={assignmentFormValues.employeeId}
              onChange={(event) =>
                setAssignmentFormValues((currentValues) => ({
                  ...currentValues,
                  employeeId: event.target.value
                }))
              }
            >
              <option value="">{t('assignmentPanel.selectEmployee')}</option>
              {activeEmployeeOptions.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </select>
            {assignmentFormErrors.employeeId ? (
              <span className="form-field-error">{assignmentFormErrors.employeeId}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('assignmentPanel.compensationBand')}</span>
            <select
              className={`form-input ${assignmentFormErrors.bandId ? "form-input-error" : ""}`}
              value={assignmentFormValues.bandId}
              onChange={(event) =>
                setAssignmentFormValues((currentValues) => ({
                  ...currentValues,
                  bandId: event.target.value
                }))
              }
            >
              <option value="">{t('assignmentPanel.selectBand')}</option>
              {sortedBands.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.title} {band.level ? `(${band.level})` : ""}
                </option>
              ))}
            </select>
            {assignmentFormErrors.bandId ? (
              <span className="form-field-error">{assignmentFormErrors.bandId}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('assignmentPanel.effectiveFrom')}</span>
            <input
              type="date"
              className={`form-input ${assignmentFormErrors.effectiveFrom ? "form-input-error" : ""}`}
              value={assignmentFormValues.effectiveFrom}
              onChange={(event) =>
                setAssignmentFormValues((currentValues) => ({
                  ...currentValues,
                  effectiveFrom: event.target.value
                }))
              }
            />
            {assignmentFormErrors.effectiveFrom ? (
              <span className="form-field-error">{assignmentFormErrors.effectiveFrom}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('assignmentPanel.effectiveTo')}</span>
            <input
              type="date"
              className={`form-input ${assignmentFormErrors.effectiveTo ? "form-input-error" : ""}`}
              value={assignmentFormValues.effectiveTo}
              onChange={(event) =>
                setAssignmentFormValues((currentValues) => ({
                  ...currentValues,
                  effectiveTo: event.target.value
                }))
              }
            />
            {assignmentFormErrors.effectiveTo ? (
              <span className="form-field-error">{assignmentFormErrors.effectiveTo}</span>
            ) : null}
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={resetAssignmentPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingAssignment}>
              {isSubmittingAssignment ? tCommon('working') : t('assignmentPanel.assign')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {toasts.length > 0 ? (
        <div className="toast-region" aria-live="polite" aria-label={t('toast.ariaLabel')}>
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() =>
                  setToasts((currentToasts) =>
                    currentToasts.filter((currentToast) => currentToast.id !== toast.id)
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
