"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import {
  formatDateTimeTooltip,
  formatRelativeTime,
  toIsoDate,
  todayIsoDate
} from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import {
  labelForReviewAssignmentStatus,
  labelForReviewCycleStatus,
  toneForReviewAssignmentStatus,
  toneForReviewCycleStatus
} from "../../../../lib/performance/reviews";
import { useCalibration, usePerformanceAdmin } from "../../../../hooks/use-performance";
import type {
  AssignReviewApiResponse,
  AssignReviewPayload,
  CalibrationRow,
  CreateReviewCycleApiResponse,
  CreateReviewCyclePayload,
  CreateReviewTemplateApiResponse,
  CreateReviewTemplatePayload,
  ReviewSectionDefinition,
  ShareReviewResponse
} from "../../../../types/performance";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";
type TranslatorFn = (key: string) => string;

type AdminTab = "admin" | "calibration";
type SortDirection = "asc" | "desc";
type CalibrationSortKey = "employee" | "department" | "selfScore" | "managerScore" | "variance";
type ToastVariant = "success" | "error" | "info";
type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type CycleFormValues = {
  name: string;
  type: "quarterly" | "annual" | "probation";
  status: "draft" | "active" | "in_review" | "completed";
  startDate: string;
  endDate: string;
  selfReviewDeadline: string;
  managerReviewDeadline: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayDateString(): string {
  return todayIsoDate();
}

function defaultCycleFormValues(): CycleFormValues {
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

  return {
    name: "",
    type: "quarterly",
    status: "draft",
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    selfReviewDeadline: "",
    managerReviewDeadline: ""
  };
}

function cycleFormErrors(values: CycleFormValues, t: TranslatorFn): Partial<Record<keyof CycleFormValues, string>> {
  const errors: Partial<Record<keyof CycleFormValues, string>> = {};

  if (!values.name.trim()) {
    errors.name = t("validation.cycleNameRequired");
  }

  if (!values.startDate) {
    errors.startDate = t("validation.startDateRequired");
  }

  if (!values.endDate) {
    errors.endDate = t("validation.endDateRequired");
  }

  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = t("validation.endDateBeforeStart");
  }

  if (values.selfReviewDeadline && values.startDate && values.selfReviewDeadline < values.startDate) {
    errors.selfReviewDeadline = t("validation.selfDeadlineBeforeStart");
  }

  if (values.managerReviewDeadline && values.startDate && values.managerReviewDeadline < values.startDate) {
    errors.managerReviewDeadline = t("validation.managerDeadlineBeforeStart");
  }

  return errors;
}

function hasErrors(errors: Partial<Record<string, string>>): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

function adminSkeleton() {
  return (
    <section className="performance-skeleton" aria-hidden="true">
      <div className="performance-skeleton-header" />
      <div className="performance-skeleton-card" />
      <div className="performance-skeleton-card" />
      <div className="table-skeleton" />
    </section>
  );
}

function standardTemplateSections(t: TranslatorFn): ReviewSectionDefinition[] {
  return [
    {
      id: "delivery",
      title: t("templateSections.deliveryTitle"),
      description: t("templateSections.deliveryDescription"),
      questions: [
        {
          id: "delivery-impact-rating",
          title: t("templateSections.deliveryImpact"),
          prompt: t("templateSections.deliveryImpactPrompt"),
          type: "rating",
          required: true
        },
        {
          id: "delivery-commentary",
          title: t("templateSections.deliveryNotes"),
          prompt: t("templateSections.deliveryNotesPrompt"),
          type: "text",
          required: true,
          maxLength: 1200
        }
      ]
    },
    {
      id: "collaboration",
      title: t("templateSections.collaborationTitle"),
      description: t("templateSections.collaborationDescription"),
      questions: [
        {
          id: "collaboration-rating",
          title: t("templateSections.collaborationEffectiveness"),
          prompt: t("templateSections.collaborationPrompt"),
          type: "rating",
          required: true
        },
        {
          id: "growth-focus",
          title: t("templateSections.growthFocus"),
          prompt: t("templateSections.growthFocusPrompt"),
          type: "text",
          required: true,
          maxLength: 1200
        }
      ]
    }
  ];
}

function varianceTone(variance: number | null): string {
  if (variance === null) return "";
  const abs = Math.abs(variance);
  if (abs > 1) return "calibration-variance-high";
  if (abs <= 0.5) return "calibration-variance-low";
  return "calibration-variance-mid";
}

function sharingStatusLabel(status: "unshared" | "shared" | "acknowledged", t: TranslatorFn): string {
  switch (status) {
    case "unshared":
      return t("sharingStatus.notShared");
    case "shared":
      return t("sharingStatus.shared");
    case "acknowledged":
      return t("sharingStatus.acknowledged");
  }
}

function sharingStatusTone(status: "unshared" | "shared" | "acknowledged"): "draft" | "pending" | "success" {
  switch (status) {
    case "unshared":
      return "draft";
    case "shared":
      return "pending";
    case "acknowledged":
      return "success";
  }
}

// ── Calibration Tab Component ──

function CalibrationTab() {
  const t = useTranslations("performanceAdmin");
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;

  const cycleIdFilter = "";
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CalibrationSortKey>("employee");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const calibrationQuery = useCalibration({
    cycleId: cycleIdFilter || undefined,
    department: departmentFilter,
    country: countryFilter
  });

  const rows = useMemo(() => calibrationQuery.data?.rows ?? [], [calibrationQuery.data?.rows]);
  const summary = calibrationQuery.data?.summary ?? null;
  const cycle = calibrationQuery.data?.cycle ?? null;

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.department) set.add(row.department);
    }
    return [...set].sort();
  }, [rows]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.countryCode) set.add(row.countryCode);
    }
    return [...set].sort();
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0;

      switch (sortKey) {
        case "employee":
          cmp = a.employeeName.localeCompare(b.employeeName);
          break;
        case "department":
          cmp = (a.department ?? "").localeCompare(b.department ?? "");
          break;
        case "selfScore":
          cmp = (a.selfScore ?? -1) - (b.selfScore ?? -1);
          break;
        case "managerScore":
          cmp = (a.managerScore ?? -1) - (b.managerScore ?? -1);
          break;
        case "variance":
          cmp = (a.variance ?? 0) - (b.variance ?? 0);
          break;
      }

      return sortDirection === "asc" ? cmp : cmp * -1;
    });
  }, [rows, sortKey, sortDirection]);

  const toggleSort = (key: CalibrationSortKey) => {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortArrow = (key: CalibrationSortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <article className="settings-card">
      <h2 className="section-title">{t("calibration.title")}</h2>
      <p className="settings-card-description">
        {t("calibration.description")}
      </p>

      {calibrationQuery.isLoading ? (
        <div className="performance-skeleton-card" aria-hidden="true" />
      ) : calibrationQuery.errorMessage ? (
        <ErrorState
          title={t("calibration.unavailableTitle")}
          message={calibrationQuery.errorMessage}
          onRetry={calibrationQuery.refresh}
        />
      ) : !cycle ? (
        <EmptyState
          title={t("calibration.noCycleTitle")}
          description={t("calibration.noCycleDescription")}
          ctaLabel={t("calibration.backToAdmin")}
          ctaHref="/performance/admin"
        />
      ) : (
        <>
          <div className="calibration-filters">
            <div className="calibration-cycle-info">
              <StatusBadge tone={toneForReviewCycleStatus(cycle.status)}>
                {cycle.name} ({labelForReviewCycleStatus(cycle.status)})
              </StatusBadge>
            </div>

            <select
              className="form-input"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.currentTarget.value)}
              aria-label={t("calibration.filterByDepartment")}
            >
              <option value="all">{t("calibration.allDepartments")}</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              className="form-input"
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.currentTarget.value)}
              aria-label={t("calibration.filterByCountry")}
            >
              <option value="all">{t("calibration.allCountries")}</option>
              {countries.map((c) => (
                <option key={c} value={c}>{countryNameFromCode(c, locale)}</option>
              ))}
            </select>
          </div>

          {summary ? (
            <div className="calibration-summary">
              <p>
                {t("calibration.cycleCompletion")}{" "}
                <span className="numeric">
                  {t('calibration.completionCount', { completed: summary.completedAssignments, total: summary.totalAssignments, pct: summary.completionPct })}
                </span>
              </p>
              <p>
                {t("calibration.averageSelfScore")}{" "}
                <span className="numeric">
                  {summary.avgSelfScore !== null ? summary.avgSelfScore.toFixed(1) : t("calibration.notAvailable")}
                </span>
              </p>
              <p>
                {t("calibration.averageManagerScore")}{" "}
                <span className="numeric">
                  {summary.avgManagerScore !== null ? summary.avgManagerScore.toFixed(1) : t("calibration.notAvailable")}
                </span>
              </p>
            </div>
          ) : null}

          <section className="data-table-container" aria-label={t("calibration.title")}>
            {sortedRows.length === 0 ? (
              <EmptyState
                title={t("calibration.noDataTitle")}
                description={t("calibration.noDataDescription")}
                ctaLabel={t("calibration.clearFilters")}
                ctaHref="/performance/admin"
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("employee")}>
                        {t("calibrationTable.employee")}{sortArrow("employee")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("department")}>
                        {t("calibrationTable.department")}{sortArrow("department")}
                      </button>
                    </th>
                    <th>{t("calibrationTable.country")}</th>
                    <th>{t("calibrationTable.reviewType")}</th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("selfScore")}>
                        {t("calibrationTable.selfScore")}{sortArrow("selfScore")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("managerScore")}>
                        {t("calibrationTable.managerScore")}{sortArrow("managerScore")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("variance")}>
                        {t("calibrationTable.variance")}{sortArrow("variance")}
                      </button>
                    </th>
                    <th>{t("calibrationTable.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row: CalibrationRow) => (
                    <tr key={row.assignmentId} className="data-table-row">
                      <td>{row.employeeName}</td>
                      <td>{row.department ?? "--"}</td>
                      <td>
                        <p className="country-chip">
                          <span>{countryFlagFromCode(row.countryCode)}</span>
                          <span>{countryNameFromCode(row.countryCode, locale)}</span>
                        </p>
                      </td>
                      <td>{toSentenceCase(row.reviewType)}</td>
                      <td className="numeric">
                        {row.selfScore !== null ? row.selfScore.toFixed(1) : t("calibration.notAvailable")}
                      </td>
                      <td className="numeric">
                        {row.managerScore !== null ? row.managerScore.toFixed(1) : t("calibration.notAvailable")}
                      </td>
                      <td className={`numeric ${varianceTone(row.variance)}`}>
                        {row.variance !== null
                          ? `${row.variance > 0 ? "+" : ""}${row.variance.toFixed(1)}`
                          : t("calibration.notAvailable")}
                      </td>
                      <td>
                        <StatusBadge tone={sharingStatusTone(row.status)}>
                          {sharingStatusLabel(row.status, td as TranslatorFn)}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </article>
  );
}

// ── Main Admin Component ──

export function AdminPerformanceClient() {
  const t = useTranslations("performanceAdmin");
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;

  const adminQuery = usePerformanceAdmin();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTab>("admin");

  const [cycleForm, setCycleForm] = useState<CycleFormValues>(defaultCycleFormValues);
  const [cycleFormValidation, setCycleFormValidation] = useState<
    Partial<Record<keyof CycleFormValues, string>>
  >({});
  const [isCreatingCycle, setIsCreatingCycle] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isSharingReview, setIsSharingReview] = useState(false);

  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [assignmentDueAt, setAssignmentDueAt] = useState<string>(todayDateString());

  const [assignmentSortDirection, setAssignmentSortDirection] = useState<SortDirection>("asc");

  const sortedAssignments = useMemo(() => {
    const rows = adminQuery.data?.assignments ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.employeeName.localeCompare(right.employeeName);
      return assignmentSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [adminQuery.data?.assignments, assignmentSortDirection]);

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const shareReview = async (assignmentId: string) => {
    setIsSharingReview(true);

    try {
      const response = await fetch(`/api/v1/performance/assignments/${assignmentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const body = (await response.json()) as ShareReviewResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? td("toast.unableToShareReview"));
        return;
      }

      showToast("success", td("toast.reviewShared"));
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToShareReview"));
    } finally {
      setIsSharingReview(false);
    }
  };

  const createCycle = async () => {
    const validation = cycleFormErrors(cycleForm, td as TranslatorFn);
    setCycleFormValidation(validation);

    if (hasErrors(validation)) {
      return;
    }

    setIsCreatingCycle(true);

    try {
      const payload: CreateReviewCyclePayload = {
        name: cycleForm.name.trim(),
        type: cycleForm.type,
        status: cycleForm.status,
        startDate: cycleForm.startDate,
        endDate: cycleForm.endDate,
        selfReviewDeadline: cycleForm.selfReviewDeadline || null,
        managerReviewDeadline: cycleForm.managerReviewDeadline || null
      };

      const response = await fetch("/api/v1/performance/admin/cycles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as CreateReviewCycleApiResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? td("toast.unableToCreateCycle"));
        return;
      }

      showToast("success", td("toast.cycleCreated"));
      setCycleForm(defaultCycleFormValues());
      setCycleFormValidation({});
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToCreateCycle"));
    } finally {
      setIsCreatingCycle(false);
    }
  };

  const createStandardTemplate = async () => {
    setIsCreatingTemplate(true);

    try {
      const payload: CreateReviewTemplatePayload = {
        name: td("standardTemplateName"),
        sections: standardTemplateSections(td as TranslatorFn)
      };

      const response = await fetch("/api/v1/performance/admin/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as CreateReviewTemplateApiResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? td("toast.unableToCreateTemplate"));
        return;
      }

      showToast("success", td("toast.templateCreated"));
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToCreateTemplate"));
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const assignCycle = async () => {
    if (!adminQuery.data) {
      return;
    }

    if (!selectedCycleId || !selectedTemplateId) {
      showToast("error", td("toast.selectCycleAndTemplate"));
      return;
    }

    const activeDirectory = adminQuery.data.directory.filter(
      (row) => row.status === "active" && row.managerId !== null && row.id !== row.managerId
    );

    if (activeDirectory.length === 0) {
      showToast("error", td("toast.noActivePeople"));
      return;
    }

    const payload: AssignReviewPayload = {
      cycleId: selectedCycleId,
      templateId: selectedTemplateId,
      assignments: activeDirectory.map((row) => ({
        employeeId: row.id,
        reviewerId: row.managerId ?? row.id,
        dueAt: assignmentDueAt || null
      }))
    };

    setIsAssigning(true);

    try {
      const response = await fetch("/api/v1/performance/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as AssignReviewApiResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? td("toast.unableToAssignCycle"));
        return;
      }

      showToast(
        "success",
        td("toast.assignedReviews", { createdCount: body.data.createdCount, skippedCount: body.data.skippedCount })
      );
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToAssignCycle"));
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link className="button button-subtle" href="/performance">
            {t("backToPerformance")}
          </Link>
        }
      />

      {/* ── Tab Navigation ── */}
      <section className="page-tabs" aria-label={t("title")}>
        <button
          type="button"
          className={activeTab === "admin" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("admin")}
        >
          {t("tabs.admin")}
        </button>
        <button
          type="button"
          className={activeTab === "calibration" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("calibration")}
        >
          {t("tabs.calibration")}
        </button>
      </section>

      {activeTab === "calibration" ? (
        <section className="settings-layout">
          <CalibrationTab />
        </section>
      ) : null}

      {activeTab === "admin" ? (
        <>
          {adminQuery.isLoading ? adminSkeleton() : null}

          {!adminQuery.isLoading && adminQuery.errorMessage ? (
            <ErrorState
              title={t("errorTitle")}
              message={adminQuery.errorMessage}
              onRetry={adminQuery.refresh}
            />
          ) : null}

          {!adminQuery.isLoading && !adminQuery.errorMessage && adminQuery.data ? (
            <section className="settings-layout">
              <section className="performance-admin-metrics">
                <article className="metric-card">
                  <p className="metric-label">{t("metrics.totalAssignments")}</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.totalAssignments}</p>
                  <p className="metric-hint">{t("metrics.totalAssignmentsHint")}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t("metrics.completed")}</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.completedAssignments}</p>
                  <p className="metric-hint">{t("metrics.completedHint")}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t("metrics.pendingSelf")}</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.pendingSelfAssignments}</p>
                  <p className="metric-hint">{t("metrics.pendingSelfHint")}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t("metrics.pendingManager")}</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.pendingManagerAssignments}</p>
                  <p className="metric-hint">{t("metrics.pendingManagerHint")}</p>
                </article>
              </section>

              <article className="settings-card">
                <h2 className="section-title">{t("createCycle.title")}</h2>
                <p className="settings-card-description">
                  {t("createCycle.description")}
                </p>
                <div className="performance-admin-form-grid">
                  <label className="form-field" htmlFor="cycle-name">
                    <span className="form-label">{t("createCycle.cycleName")}</span>
                    <input
                      id="cycle-name"
                      className={cycleFormValidation.name ? "form-input form-input-error" : "form-input"}
                      value={cycleForm.name}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setCycleForm((current) => ({ ...current, name: nextValue }));
                        setCycleFormValidation((current) => ({
                          ...current,
                          name: nextValue.trim() ? undefined : td("validation.cycleNameRequired")
                        }));
                      }}
                    />
                    {cycleFormValidation.name ? (
                      <p className="form-field-error">{cycleFormValidation.name}</p>
                    ) : null}
                  </label>

                  <label className="form-field" htmlFor="cycle-type">
                    <span className="form-label">{t("createCycle.cycleType")}</span>
                    <select
                      id="cycle-type"
                      className="form-input"
                      value={cycleForm.type}
                      onChange={(event) =>
                        setCycleForm((current) => ({
                          ...current,
                          type: event.currentTarget.value as CycleFormValues["type"]
                        }))
                      }
                    >
                      <option value="quarterly">{t("cycleType.quarterly")}</option>
                      <option value="annual">{t("cycleType.annual")}</option>
                      <option value="probation">{t("cycleType.probation")}</option>
                    </select>
                  </label>

                  <label className="form-field" htmlFor="cycle-status">
                    <span className="form-label">{t("createCycle.initialStatus")}</span>
                    <select
                      id="cycle-status"
                      className="form-input"
                      value={cycleForm.status}
                      onChange={(event) =>
                        setCycleForm((current) => ({
                          ...current,
                          status: event.currentTarget.value as CycleFormValues["status"]
                        }))
                      }
                    >
                      <option value="draft">{t("cycleStatus.draft")}</option>
                      <option value="active">{t("cycleStatus.active")}</option>
                      <option value="in_review">{t("cycleStatus.inReview")}</option>
                      <option value="completed">{t("cycleStatus.completed")}</option>
                    </select>
                  </label>

                  <label className="form-field" htmlFor="cycle-start-date">
                    <span className="form-label">{t("createCycle.startDate")}</span>
                    <input
                      id="cycle-start-date"
                      type="date"
                      className={
                        cycleFormValidation.startDate ? "form-input form-input-error" : "form-input"
                      }
                      value={cycleForm.startDate}
                      onChange={(event) =>
                        setCycleForm((current) => ({ ...current, startDate: event.currentTarget.value }))
                      }
                    />
                    {cycleFormValidation.startDate ? (
                      <p className="form-field-error">{cycleFormValidation.startDate}</p>
                    ) : null}
                  </label>

                  <label className="form-field" htmlFor="cycle-end-date">
                    <span className="form-label">{t("createCycle.endDate")}</span>
                    <input
                      id="cycle-end-date"
                      type="date"
                      className={cycleFormValidation.endDate ? "form-input form-input-error" : "form-input"}
                      value={cycleForm.endDate}
                      onChange={(event) =>
                        setCycleForm((current) => ({ ...current, endDate: event.currentTarget.value }))
                      }
                    />
                    {cycleFormValidation.endDate ? (
                      <p className="form-field-error">{cycleFormValidation.endDate}</p>
                    ) : null}
                  </label>

                  <label className="form-field" htmlFor="cycle-self-deadline">
                    <span className="form-label">{t("createCycle.selfReviewDeadline")}</span>
                    <input
                      id="cycle-self-deadline"
                      type="date"
                      className={
                        cycleFormValidation.selfReviewDeadline
                          ? "form-input form-input-error"
                          : "form-input"
                      }
                      value={cycleForm.selfReviewDeadline}
                      onChange={(event) =>
                        setCycleForm((current) => ({
                          ...current,
                          selfReviewDeadline: event.currentTarget.value
                        }))
                      }
                    />
                    {cycleFormValidation.selfReviewDeadline ? (
                      <p className="form-field-error">{cycleFormValidation.selfReviewDeadline}</p>
                    ) : null}
                  </label>

                  <label className="form-field" htmlFor="cycle-manager-deadline">
                    <span className="form-label">{t("createCycle.managerReviewDeadline")}</span>
                    <input
                      id="cycle-manager-deadline"
                      type="date"
                      className={
                        cycleFormValidation.managerReviewDeadline
                          ? "form-input form-input-error"
                          : "form-input"
                      }
                      value={cycleForm.managerReviewDeadline}
                      onChange={(event) =>
                        setCycleForm((current) => ({
                          ...current,
                          managerReviewDeadline: event.currentTarget.value
                        }))
                      }
                    />
                    {cycleFormValidation.managerReviewDeadline ? (
                      <p className="form-field-error">{cycleFormValidation.managerReviewDeadline}</p>
                    ) : null}
                  </label>
                </div>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="button button-accent"
                    disabled={isCreatingCycle}
                    onClick={() => {
                      void createCycle();
                    }}
                  >
                    {isCreatingCycle ? t("createCycle.creating") : t("createCycle.createCycleButton")}
                  </button>
                </div>
              </article>

              <article className="settings-card">
                <h2 className="section-title">{t("templates.title")}</h2>
                <p className="settings-card-description">
                  {t("templates.description")}
                </p>

                <div className="performance-template-grid">
                  <button
                    type="button"
                    className="button button-subtle"
                    disabled={isCreatingTemplate}
                    onClick={() => {
                      void createStandardTemplate();
                    }}
                  >
                    {isCreatingTemplate ? t("templates.creatingTemplate") : t("templates.createStandardTemplate")}
                  </button>

                  <label className="form-field" htmlFor="assign-cycle">
                    <span className="form-label">{t("templates.cycleLabel")}</span>
                    <select
                      id="assign-cycle"
                      className="form-input"
                      value={selectedCycleId}
                      onChange={(event) => setSelectedCycleId(event.currentTarget.value)}
                    >
                      <option value="">{t("templates.selectCycle")}</option>
                      {adminQuery.data.cycles.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {cycle.name} ({toSentenceCase(cycle.type)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="assign-template">
                    <span className="form-label">{t("templates.templateLabel")}</span>
                    <select
                      id="assign-template"
                      className="form-input"
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}
                    >
                      <option value="">{t("templates.selectTemplate")}</option>
                      {adminQuery.data.templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="assign-due-date">
                    <span className="form-label">{t("templates.dueDateLabel")}</span>
                    <input
                      id="assign-due-date"
                      type="date"
                      className="form-input"
                      value={assignmentDueAt}
                      onChange={(event) => setAssignmentDueAt(event.currentTarget.value)}
                    />
                  </label>

                  <button
                    type="button"
                    className="button button-accent"
                    disabled={isAssigning}
                    onClick={() => {
                      void assignCycle();
                    }}
                  >
                    {isAssigning ? t("templates.assigning") : t("templates.assignToActivePeople")}
                  </button>
                </div>
              </article>

              <article className="settings-card">
                <h2 className="section-title">{t("tracker.title")}</h2>
                <section className="data-table-container" aria-label={t("tracker.title")}>
                  {sortedAssignments.length === 0 ? (
                    <EmptyState
                      title={t("tracker.emptyTitle")}
                      description={t("tracker.emptyDescription")}
                      ctaLabel={t("tracker.backToPerformanceCta")}
                      ctaHref="/performance"
                    />
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>
                            <button
                              type="button"
                              className="table-sort-trigger"
                              onClick={() =>
                                setAssignmentSortDirection((current) =>
                                  current === "asc" ? "desc" : "asc"
                                )
                              }
                            >
                              {t("table.employee")}
                              <span className="numeric">{assignmentSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                            </button>
                          </th>
                          <th>{t("table.cycle")}</th>
                          <th>{t("table.reviewer")}</th>
                          <th>{t("table.country")}</th>
                          <th>{t("table.status")}</th>
                          <th>{t("table.sharing")}</th>
                          <th>{t("table.updated")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAssignments.map((assignment) => {
                          const sharingStatus = assignment.acknowledgedAt
                            ? "acknowledged"
                            : assignment.sharedAt
                              ? "shared"
                              : "unshared";

                          return (
                            <tr key={assignment.id} className="data-table-row">
                              <td>{assignment.employeeName}</td>
                              <td>
                                <p>{assignment.cycleName}</p>
                                <p className="settings-card-description">
                                  <StatusBadge tone={toneForReviewCycleStatus(assignment.cycleStatus)}>
                                    {labelForReviewCycleStatus(assignment.cycleStatus)}
                                  </StatusBadge>
                                </p>
                              </td>
                              <td>{assignment.reviewerName}</td>
                              <td>
                                <p className="country-chip">
                                  <span>{countryFlagFromCode(assignment.employeeCountryCode)}</span>
                                  <span>{countryNameFromCode(assignment.employeeCountryCode, locale)}</span>
                                </p>
                              </td>
                              <td>
                                <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                                  {labelForReviewAssignmentStatus(assignment.status)}
                                </StatusBadge>
                              </td>
                              <td>
                                {assignment.status === "completed" ? (
                                  sharingStatus === "acknowledged" ? (
                                    <StatusBadge tone="success">{t("sharingStatus.acknowledged")}</StatusBadge>
                                  ) : sharingStatus === "shared" ? (
                                    <StatusBadge tone="pending">{t("sharingStatus.awaitingAcknowledgment")}</StatusBadge>
                                  ) : (
                                    <button
                                      type="button"
                                      className="button button-accent button-sm"
                                      disabled={isSharingReview}
                                      onClick={() => { void shareReview(assignment.id); }}
                                    >
                                      {isSharingReview ? t("shareReview.sharing") : t("shareReview.shareReviewButton")}
                                    </button>
                                  )
                                ) : (
                                  <span className="settings-card-description">--</span>
                                )}
                              </td>
                              <td title={formatDateTimeTooltip(assignment.updatedAt, locale)}>
                                {formatRelativeTime(assignment.updatedAt, locale)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              </article>
            </section>
          ) : null}
        </>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label={t("title")}>
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={t("dismissToast")}
              >
                {t("dismissToast")}
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
