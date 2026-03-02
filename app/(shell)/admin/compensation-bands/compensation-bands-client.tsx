"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useCompensationBands } from "../../../../hooks/use-compensation-bands";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { type CompensationBandLocationType } from "../../../../types/compensation-bands";

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
  effectiveFrom: new Date().toISOString().slice(0, 10),
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
  effectiveFrom: new Date().toISOString().slice(0, 10),
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

function validateBandForm(values: BandFormValues): BandFormErrors {
  const errors: BandFormErrors = {};

  if (!values.title.trim()) {
    errors.title = "Title is required.";
  }

  if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
    errors.currency = "Currency must be a 3-letter code.";
  }

  if (!isDigits(values.minSalaryAmount)) {
    errors.minSalaryAmount = "Min salary must be a non-negative integer.";
  }

  if (!isDigits(values.midSalaryAmount)) {
    errors.midSalaryAmount = "Mid salary must be a non-negative integer.";
  }

  if (!isDigits(values.maxSalaryAmount)) {
    errors.maxSalaryAmount = "Max salary must be a non-negative integer.";
  }

  if (values.equityMin.trim().length > 0 && !isDigits(values.equityMin)) {
    errors.equityMin = "Equity min must be a non-negative integer.";
  }

  if (values.equityMax.trim().length > 0 && !isDigits(values.equityMax)) {
    errors.equityMax = "Equity max must be a non-negative integer.";
  }

  if (!isoDatePattern.test(values.effectiveFrom)) {
    errors.effectiveFrom = "Effective from must be in YYYY-MM-DD format.";
  }

  if (values.effectiveTo.trim().length > 0 && !isoDatePattern.test(values.effectiveTo)) {
    errors.effectiveTo = "Effective to must be in YYYY-MM-DD format.";
  }

  if (values.locationType !== "global" && !values.locationValue.trim()) {
    errors.locationValue = "Location value is required for this location type.";
  }

  if (
    isDigits(values.minSalaryAmount) &&
    isDigits(values.midSalaryAmount) &&
    parseInteger(values.midSalaryAmount) < parseInteger(values.minSalaryAmount)
  ) {
    errors.midSalaryAmount = "Mid salary must be greater than or equal to min salary.";
  }

  if (
    isDigits(values.midSalaryAmount) &&
    isDigits(values.maxSalaryAmount) &&
    parseInteger(values.maxSalaryAmount) < parseInteger(values.midSalaryAmount)
  ) {
    errors.maxSalaryAmount = "Max salary must be greater than or equal to mid salary.";
  }

  if (values.effectiveTo.trim().length > 0 && values.effectiveTo < values.effectiveFrom) {
    errors.effectiveTo = "Effective to must be on or after effective from.";
  }

  if (
    values.equityMin.trim().length > 0 &&
    values.equityMax.trim().length > 0 &&
    isDigits(values.equityMin) &&
    isDigits(values.equityMax) &&
    parseInteger(values.equityMax) < parseInteger(values.equityMin)
  ) {
    errors.equityMax = "Equity max must be greater than or equal to equity min.";
  }

  return errors;
}

function validateBenchmarkForm(values: BenchmarkFormValues): BenchmarkFormErrors {
  const errors: BenchmarkFormErrors = {};

  if (!values.source.trim()) {
    errors.source = "Source is required.";
  }

  if (!values.title.trim()) {
    errors.title = "Title is required.";
  }

  if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
    errors.currency = "Currency must be a 3-letter code.";
  }

  const percentileFields: Array<keyof BenchmarkFormValues> = ["p25", "p50", "p75", "p90"];

  for (const field of percentileFields) {
    const fieldValue = values[field].trim();

    if (fieldValue.length > 0 && !isDigits(fieldValue)) {
      errors[field] = "Percentile values must be non-negative integers.";
    }
  }

  if (isDigits(values.p25) && isDigits(values.p50) && parseInteger(values.p25) > parseInteger(values.p50)) {
    errors.p50 = "P50 must be greater than or equal to P25.";
  }

  if (isDigits(values.p50) && isDigits(values.p75) && parseInteger(values.p50) > parseInteger(values.p75)) {
    errors.p75 = "P75 must be greater than or equal to P50.";
  }

  if (isDigits(values.p75) && isDigits(values.p90) && parseInteger(values.p75) > parseInteger(values.p90)) {
    errors.p90 = "P90 must be greater than or equal to P75.";
  }

  return errors;
}

function validateAssignmentForm(values: AssignmentFormValues): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {};

  if (!values.employeeId.trim()) {
    errors.employeeId = "Employee is required.";
  }

  if (!values.bandId.trim()) {
    errors.bandId = "Band is required.";
  }

  if (!isoDatePattern.test(values.effectiveFrom)) {
    errors.effectiveFrom = "Effective from must be in YYYY-MM-DD format.";
  }

  if (values.effectiveTo.trim().length > 0 && !isoDatePattern.test(values.effectiveTo)) {
    errors.effectiveTo = "Effective to must be in YYYY-MM-DD format.";
  }

  if (values.effectiveTo.trim().length > 0 && values.effectiveTo < values.effectiveFrom) {
    errors.effectiveTo = "Effective to must be on or after effective from.";
  }

  return errors;
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

function alertLabel(status: "below_band" | "above_band" | "missing_salary") {
  if (status === "below_band") {
    return "Below band";
  }

  if (status === "above_band") {
    return "Above band";
  }

  return "Missing salary";
}

function assignmentStatus(
  effectiveFrom: string,
  effectiveTo: string | null
): { label: string; tone: "success" | "info" | "draft" } {
  const today = new Date().toISOString().slice(0, 10);

  if (effectiveFrom > today) {
    return {
      label: "Scheduled",
      tone: "info"
    };
  }

  if (effectiveTo && effectiveTo < today) {
    return {
      label: "Historical",
      tone: "draft"
    };
  }

  return {
    label: "Active",
    tone: "success"
  };
}

function bandTableSkeleton() {
  return (
    <div className="documents-table-skeleton" aria-hidden="true">
      <div className="documents-table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`comp-bands-skeleton-${index}`} className="documents-table-skeleton-row" />
      ))}
    </div>
  );
}

export function CompensationBandsClient() {
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

  const showToast = (variant: ToastVariant, message: string) => {
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
      showToast("error", "Selected band was not found.");
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
      showToast("error", result.errorMessage ?? "Unable to save compensation band.");
      setIsSubmittingBand(false);
      return;
    }

    showToast("success", editingBandId ? "Compensation band updated." : "Compensation band created.");
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
      showToast("error", result.errorMessage ?? "Unable to add benchmark data.");
      setIsSubmittingBenchmark(false);
      return;
    }

    showToast("success", "Benchmark data added.");
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
      showToast("error", result.errorMessage ?? "Unable to assign employee to band.");
      setIsSubmittingAssignment(false);
      return;
    }

    showToast("success", "Employee assignment saved.");
    resetAssignmentPanel();
  };

  return (
    <>
      <PageHeader
        title="Compensation Bands"
        description="Define salary ranges, compare with market data, and surface out-of-band compensation alerts."
      />

      <section className="onboarding-header-actions" aria-label="Compensation band actions">
        <button type="button" className="button button-accent" onClick={handleOpenCreateBand}>
          New band
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setIsBenchmarkPanelOpen(true);
            setBenchmarkFormErrors({});
          }}
        >
          Add benchmark
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setIsAssignmentPanelOpen(true);
            setAssignmentFormErrors({});
          }}
        >
          Assign employee
        </button>
      </section>

      {bandsQuery.isLoading ? bandTableSkeleton() : null}

      {!bandsQuery.isLoading && bandsQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Compensation bands are unavailable"
            description={bandsQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button type="button" className="button button-accent" onClick={() => bandsQuery.refresh()}>
            Retry
          </button>
        </section>
      ) : null}

      {!bandsQuery.isLoading && !bandsQuery.errorMessage && bandsQuery.data ? (
        <section className="compensation-layout" aria-label="Compensation bands overview">
          <article className="compensation-summary-card">
            <div>
              <h2 className="section-title">Coverage summary</h2>
              <p className="settings-card-description">
                {bandsQuery.data.bands.length} bands, {bandsQuery.data.assignments.length} assignments,
                {" "}
                {bandsQuery.data.alerts.length} flagged alerts.
              </p>
            </div>
            <StatusBadge tone={bandsQuery.data.alerts.length > 0 ? "warning" : "success"}>
              {bandsQuery.data.alerts.length > 0 ? "Action needed" : "Healthy"}
            </StatusBadge>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Out-of-band alerts</h2>
                <p className="settings-card-description">
                  Employees below or above their assigned compensation band midpoint range.
                </p>
              </div>
            </header>

            {sortedAlerts.length === 0 ? (
              <EmptyState
                title="No alerts"
                description="All employees with assignments are currently within their configured bands."
                ctaLabel="Review bands"
                ctaHref="/admin/compensation-bands"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Out-of-band alerts table">
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
                          Employee
                          <span className="numeric">{alertSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Band</th>
                      <th>Current salary</th>
                      <th>Band range</th>
                      <th>Compa ratio</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAlerts.map((alert) => (
                      <tr key={`${alert.employeeId}-${alert.bandId}`} className="data-table-row">
                        <td>
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{alert.employeeName}</p>
                            <p className="documents-cell-description">{alert.employeeTitle ?? "No title"}</p>
                            <p className="documents-cell-description country-chip">
                              <span>{countryFlagFromCode(alert.countryCode)}</span>
                              <span>{countryNameFromCode(alert.countryCode)}</span>
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
                            <span className="numeric">to</span>
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
                              View profile
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
                <h2 className="section-title">Compensation bands</h2>
                <p className="settings-card-description">
                  Salary and equity ranges by role, level, and location.
                </p>
              </div>
            </header>

            {sortedBands.length === 0 ? (
              <section className="documents-empty-state">
                <EmptyState
                  title="No compensation bands"
                  description="Create your first compensation band to begin benchmarking and pay equity reviews."
                  ctaLabel="Back to dashboard"
                  ctaHref="/dashboard"
                />
                <button type="button" className="button button-accent" onClick={handleOpenCreateBand}>
                  Create band
                </button>
              </section>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Compensation bands table">
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
                          Role / level
                          <span className="numeric">{bandSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Department</th>
                      <th>Location</th>
                      <th>Salary range</th>
                      <th>Equity range</th>
                      <th>Effective</th>
                      <th>Assigned</th>
                      <th className="table-action-column">Actions</th>
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
                              <p className="documents-cell-description">{band.level ?? "No level"}</p>
                            </div>
                          </td>
                          <td>{band.department ?? "--"}</td>
                          <td>
                            {band.locationType === "global"
                              ? "Global"
                              : band.locationValue ?? band.locationType}
                          </td>
                          <td>
                            <div className="documents-cell-copy">
                              <CurrencyDisplay amount={band.minSalaryAmount} currency={band.currency} />
                              <span className="numeric">to</span>
                              <CurrencyDisplay amount={band.maxSalaryAmount} currency={band.currency} />
                              <span className="settings-card-description">
                                Mid: <CurrencyDisplay amount={band.midSalaryAmount} currency={band.currency} />
                              </span>
                            </div>
                          </td>
                          <td className="numeric">
                            {band.equityMin === null && band.equityMax === null
                              ? "--"
                              : `${band.equityMin ?? 0} to ${band.equityMax ?? 0}`}
                          </td>
                          <td>
                            <div className="documents-cell-copy">
                              <span title={effectiveFromTimestamp ? formatDateTimeTooltip(effectiveFromTimestamp) : undefined}>
                                {effectiveFromTimestamp ? formatRelativeTime(effectiveFromTimestamp) : "--"}
                              </span>
                              {effectiveToTimestamp ? (
                                <span className="settings-card-description" title={formatDateTimeTooltip(effectiveToTimestamp)}>
                                  Ends {formatRelativeTime(effectiveToTimestamp)}
                                </span>
                              ) : (
                                <span className="settings-card-description">No end date</span>
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
                                Edit
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
                <h2 className="section-title">Market benchmark data</h2>
                <p className="settings-card-description">
                  Imported salary survey points used to tune compensation bands.
                </p>
              </div>
            </header>

            {sortedBenchmarks.length === 0 ? (
              <section className="documents-empty-state">
                <EmptyState
                  title="No benchmark data"
                  description="Add external benchmark records to compare your bands with market pay data."
                  ctaLabel="Back to dashboard"
                  ctaHref="/dashboard"
                />
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => setIsBenchmarkPanelOpen(true)}
                >
                  Add benchmark
                </button>
              </section>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Benchmark data table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Role</th>
                      <th>Location</th>
                      <th>P50</th>
                      <th>P75</th>
                      <th>Imported</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBenchmarks.map((benchmark) => (
                      <tr key={benchmark.id} className="data-table-row">
                        <td>{benchmark.source}</td>
                        <td>
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{benchmark.title}</p>
                            <p className="documents-cell-description">{benchmark.level ?? "No level"}</p>
                          </div>
                        </td>
                        <td>{benchmark.location ?? "Global"}</td>
                        <td>
                          {benchmark.p50 === null ? "--" : <CurrencyDisplay amount={benchmark.p50} currency={benchmark.currency} />}
                        </td>
                        <td>
                          {benchmark.p75 === null ? "--" : <CurrencyDisplay amount={benchmark.p75} currency={benchmark.currency} />}
                        </td>
                        <td>
                          <span title={formatDateTimeTooltip(benchmark.importedAt)}>
                            {formatRelativeTime(benchmark.importedAt)}
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
                              Create band
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
                <h2 className="section-title">Band assignments</h2>
                <p className="settings-card-description">
                  Employee-to-band mapping used for out-of-band and compa-ratio checks.
                </p>
              </div>
            </header>

            {sortedAssignments.length === 0 ? (
              <section className="documents-empty-state">
                <EmptyState
                  title="No assignments"
                  description="Assign employees to bands to enable compa-ratio and out-of-band alerts."
                  ctaLabel="Back to dashboard"
                  ctaHref="/dashboard"
                />
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => setIsAssignmentPanelOpen(true)}
                >
                  Assign employee
                </button>
              </section>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Band assignments table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Band</th>
                      <th>Effective window</th>
                      <th>Status</th>
                      <th>Assigned</th>
                      <th className="table-action-column">Actions</th>
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
                              <span title={effectiveFromTimestamp ? formatDateTimeTooltip(effectiveFromTimestamp) : undefined}>
                                Starts {effectiveFromTimestamp ? formatRelativeTime(effectiveFromTimestamp) : "--"}
                              </span>
                              <span className="settings-card-description" title={effectiveToTimestamp ? formatDateTimeTooltip(effectiveToTimestamp) : undefined}>
                                {effectiveToTimestamp ? `Ends ${formatRelativeTime(effectiveToTimestamp)}` : "No end date"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <StatusBadge tone={assignmentState.tone}>{assignmentState.label}</StatusBadge>
                          </td>
                          <td>
                            <span title={formatDateTimeTooltip(assignedTimestamp)}>{formatRelativeTime(assignedTimestamp)}</span>
                          </td>
                          <td className="table-row-action-cell">
                            <div className="comp-bands-row-actions">
                              <Link
                                className="table-row-action"
                                href={`/people/${assignment.employeeId}?tab=compensation`}
                              >
                                View profile
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
        title={editingBandId ? "Edit compensation band" : "Create compensation band"}
        description="Define salary range, location scope, and effective period."
        onClose={resetBandPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleBandSubmit}>
          <label className="form-field">
            <span className="form-label">Role title</span>
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
            <span className="form-label">Level</span>
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
            <span className="form-label">Department</span>
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
            <span className="form-label">Location type</span>
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
              <option value="global">Global</option>
              <option value="country">Country</option>
              <option value="city">City</option>
              <option value="zone">Zone</option>
            </select>
            {bandFormErrors.locationType ? (
              <span className="form-field-error">{bandFormErrors.locationType}</span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">Location value</span>
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
            <span className="form-label">Currency</span>
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
            <span className="form-label">Min salary (smallest unit)</span>
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
            <span className="form-label">Mid salary (smallest unit)</span>
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
            <span className="form-label">Max salary (smallest unit)</span>
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
            <span className="form-label">Equity min</span>
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
            <span className="form-label">Equity max</span>
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
            <span className="form-label">Effective from</span>
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
            <span className="form-label">Effective to</span>
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
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingBand}>
              {isSubmittingBand ? "Saving..." : editingBandId ? "Update band" : "Create band"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isBenchmarkPanelOpen}
        title="Add benchmark data"
        description="Import market percentiles for role and location comparisons."
        onClose={resetBenchmarkPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleBenchmarkSubmit}>
          <label className="form-field">
            <span className="form-label">Source</span>
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
            <span className="form-label">Role title</span>
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
            <span className="form-label">Level</span>
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
            <span className="form-label">Location</span>
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
            <span className="form-label">Currency</span>
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
            <span className="form-label">P25 (smallest unit)</span>
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
            <span className="form-label">P50 (smallest unit)</span>
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
            <span className="form-label">P75 (smallest unit)</span>
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
            <span className="form-label">P90 (smallest unit)</span>
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
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingBenchmark}>
              {isSubmittingBenchmark ? "Saving..." : "Add benchmark"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isAssignmentPanelOpen}
        title="Assign employee to band"
        description="Map an employee to a salary band for compa-ratio and alert checks."
        onClose={resetAssignmentPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleAssignmentSubmit}>
          <label className="form-field">
            <span className="form-label">Employee</span>
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
              <option value="">Select employee</option>
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
            <span className="form-label">Compensation band</span>
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
              <option value="">Select compensation band</option>
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
            <span className="form-label">Effective from</span>
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
            <span className="form-label">Effective to</span>
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
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmittingAssignment}>
              {isSubmittingAssignment ? "Saving..." : "Assign"}
            </button>
          </div>
        </form>
      </SlidePanel>

      {toasts.length > 0 ? (
        <div className="toast-region" aria-live="polite" aria-label="Compensation bands notifications">
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
