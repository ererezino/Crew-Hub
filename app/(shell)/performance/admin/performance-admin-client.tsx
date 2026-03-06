"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

function cycleFormErrors(values: CycleFormValues): Partial<Record<keyof CycleFormValues, string>> {
  const errors: Partial<Record<keyof CycleFormValues, string>> = {};

  if (!values.name.trim()) {
    errors.name = "Cycle name is required.";
  }

  if (!values.startDate) {
    errors.startDate = "Start date is required.";
  }

  if (!values.endDate) {
    errors.endDate = "End date is required.";
  }

  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = "End date cannot be before start date.";
  }

  if (values.selfReviewDeadline && values.startDate && values.selfReviewDeadline < values.startDate) {
    errors.selfReviewDeadline = "Self review deadline cannot be before start date.";
  }

  if (values.managerReviewDeadline && values.startDate && values.managerReviewDeadline < values.startDate) {
    errors.managerReviewDeadline = "Manager deadline cannot be before start date.";
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

function standardTemplateSections(): ReviewSectionDefinition[] {
  return [
    {
      id: "delivery",
      title: "Delivery",
      description: "Execution quality and reliability over the review period.",
      questions: [
        {
          id: "delivery-impact-rating",
          title: "Delivery impact",
          prompt: "Rate overall delivery impact for the period.",
          type: "rating",
          required: true
        },
        {
          id: "delivery-commentary",
          title: "Delivery notes",
          prompt: "Share examples of delivery outcomes.",
          type: "text",
          required: true,
          maxLength: 1200
        }
      ]
    },
    {
      id: "collaboration",
      title: "Collaboration",
      description: "Cross-functional communication and teamwork.",
      questions: [
        {
          id: "collaboration-rating",
          title: "Collaboration effectiveness",
          prompt: "Rate collaboration effectiveness with team and stakeholders.",
          type: "rating",
          required: true
        },
        {
          id: "growth-focus",
          title: "Growth focus",
          prompt: "What should this person keep doing or improve next cycle?",
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

function sharingStatusLabel(status: "unshared" | "shared" | "acknowledged"): string {
  switch (status) {
    case "unshared":
      return "Not shared";
    case "shared":
      return "Shared";
    case "acknowledged":
      return "Acknowledged";
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
      <h2 className="section-title">Calibration</h2>
      <p className="settings-card-description">
        Compare self-review and manager scores across the organisation. Read-only view for HR and admin.
      </p>

      {calibrationQuery.isLoading ? (
        <div className="performance-skeleton-card" aria-hidden="true" />
      ) : calibrationQuery.errorMessage ? (
        <ErrorState
          title="Calibration unavailable"
          message={calibrationQuery.errorMessage}
          onRetry={calibrationQuery.refresh}
        />
      ) : !cycle ? (
        <EmptyState
          title="No cycle found"
          description="Create a review cycle to see calibration data."
          ctaLabel="Back to admin"
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
              aria-label="Filter by department"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              className="form-input"
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.currentTarget.value)}
              aria-label="Filter by country"
            >
              <option value="all">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>{countryNameFromCode(c)}</option>
              ))}
            </select>
          </div>

          {summary ? (
            <div className="calibration-summary">
              <p>
                Cycle completion:{" "}
                <span className="numeric">
                  {summary.completedAssignments} of {summary.totalAssignments} (
                  {summary.completionPct}%)
                </span>
              </p>
              <p>
                Average self score:{" "}
                <span className="numeric">
                  {summary.avgSelfScore !== null ? summary.avgSelfScore.toFixed(1) : "N/A"}
                </span>
              </p>
              <p>
                Average manager score:{" "}
                <span className="numeric">
                  {summary.avgManagerScore !== null ? summary.avgManagerScore.toFixed(1) : "N/A"}
                </span>
              </p>
            </div>
          ) : null}

          <section className="data-table-container" aria-label="Calibration data">
            {sortedRows.length === 0 ? (
              <EmptyState
                title="No calibration data"
                description="No completed assignments match the selected filters."
                ctaLabel="Clear filters"
                ctaHref="/performance/admin"
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("employee")}>
                        Employee{sortArrow("employee")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("department")}>
                        Department{sortArrow("department")}
                      </button>
                    </th>
                    <th>Country</th>
                    <th>Review Type</th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("selfScore")}>
                        Self Score{sortArrow("selfScore")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("managerScore")}>
                        Manager Score{sortArrow("managerScore")}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-trigger" onClick={() => toggleSort("variance")}>
                        Variance{sortArrow("variance")}
                      </button>
                    </th>
                    <th>Status</th>
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
                          <span>{countryNameFromCode(row.countryCode)}</span>
                        </p>
                      </td>
                      <td>{toSentenceCase(row.reviewType)}</td>
                      <td className="numeric">
                        {row.selfScore !== null ? row.selfScore.toFixed(1) : "N/A"}
                      </td>
                      <td className="numeric">
                        {row.managerScore !== null ? row.managerScore.toFixed(1) : "N/A"}
                      </td>
                      <td className={`numeric ${varianceTone(row.variance)}`}>
                        {row.variance !== null
                          ? `${row.variance > 0 ? "+" : ""}${row.variance.toFixed(1)}`
                          : "N/A"}
                      </td>
                      <td>
                        <StatusBadge tone={sharingStatusTone(row.status)}>
                          {sharingStatusLabel(row.status)}
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
        showToast("error", body.error?.message ?? "Unable to share review.");
        return;
      }

      showToast("success", "Review shared with employee.");
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to share review.");
    } finally {
      setIsSharingReview(false);
    }
  };

  const createCycle = async () => {
    const validation = cycleFormErrors(cycleForm);
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
        showToast("error", body.error?.message ?? "Unable to create review cycle.");
        return;
      }

      showToast("success", "Review cycle created.");
      setCycleForm(defaultCycleFormValues());
      setCycleFormValidation({});
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to create review cycle.");
    } finally {
      setIsCreatingCycle(false);
    }
  };

  const createStandardTemplate = async () => {
    setIsCreatingTemplate(true);

    try {
      const payload: CreateReviewTemplatePayload = {
        name: "Standard Performance Template",
        sections: standardTemplateSections()
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
        showToast("error", body.error?.message ?? "Unable to create review template.");
        return;
      }

      showToast("success", "Standard review template created.");
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to create review template.");
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const assignCycle = async () => {
    if (!adminQuery.data) {
      return;
    }

    if (!selectedCycleId || !selectedTemplateId) {
      showToast("error", "Select both a cycle and a template before assigning.");
      return;
    }

    const activeDirectory = adminQuery.data.directory.filter(
      (row) => row.status === "active" && row.managerId !== null && row.id !== row.managerId
    );

    if (activeDirectory.length === 0) {
      showToast("error", "No active employees with managers are available for assignment.");
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
        showToast("error", body.error?.message ?? "Unable to assign review cycle.");
        return;
      }

      showToast(
        "success",
        `Assigned ${body.data.createdCount} reviews (${body.data.skippedCount} skipped).`
      );
      adminQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to assign review cycle.");
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Performance Admin"
        description="Run review cycles, track completion, and calibrate fairly."
        actions={
          <Link className="button button-subtle" href="/performance">
            Back to performance
          </Link>
        }
      />

      {/* ── Tab Navigation ── */}
      <section className="page-tabs" aria-label="Admin sections">
        <button
          type="button"
          className={activeTab === "admin" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("admin")}
        >
          Admin
        </button>
        <button
          type="button"
          className={activeTab === "calibration" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("calibration")}
        >
          Calibration
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
              title="Performance admin unavailable"
              message={adminQuery.errorMessage}
              onRetry={adminQuery.refresh}
            />
          ) : null}

          {!adminQuery.isLoading && !adminQuery.errorMessage && adminQuery.data ? (
            <section className="settings-layout">
              <section className="performance-admin-metrics">
                <article className="metric-card">
                  <p className="metric-label">Total Assignments</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.totalAssignments}</p>
                  <p className="metric-hint">Across all cycles</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">Completed</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.completedAssignments}</p>
                  <p className="metric-hint">Submitted by employee + manager</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">Pending Self</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.pendingSelfAssignments}</p>
                  <p className="metric-hint">Awaiting self review</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">Pending Manager</p>
                  <p className="metric-value numeric">{adminQuery.data.metrics.pendingManagerAssignments}</p>
                  <p className="metric-hint">Awaiting manager review</p>
                </article>
              </section>

              <article className="settings-card">
                <h2 className="section-title">Create Cycle</h2>
                <p className="settings-card-description">
                  Set cycle dates and deadlines for the next review period.
                </p>
                <div className="performance-admin-form-grid">
                  <label className="form-field" htmlFor="cycle-name">
                    <span className="form-label">Cycle name</span>
                    <input
                      id="cycle-name"
                      className={cycleFormValidation.name ? "form-input form-input-error" : "form-input"}
                      value={cycleForm.name}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setCycleForm((current) => ({ ...current, name: nextValue }));
                        setCycleFormValidation((current) => ({
                          ...current,
                          name: nextValue.trim() ? undefined : "Cycle name is required."
                        }));
                      }}
                    />
                    {cycleFormValidation.name ? (
                      <p className="form-field-error">{cycleFormValidation.name}</p>
                    ) : null}
                  </label>

                  <label className="form-field" htmlFor="cycle-type">
                    <span className="form-label">Cycle type</span>
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
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                      <option value="probation">Probation</option>
                    </select>
                  </label>

                  <label className="form-field" htmlFor="cycle-status">
                    <span className="form-label">Initial status</span>
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
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="in_review">In Review</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>

                  <label className="form-field" htmlFor="cycle-start-date">
                    <span className="form-label">Start date</span>
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
                    <span className="form-label">End date</span>
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
                    <span className="form-label">Self review deadline</span>
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
                    <span className="form-label">Manager review deadline</span>
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
                    {isCreatingCycle ? "Creating..." : "Create cycle"}
                  </button>
                </div>
              </article>

              <article className="settings-card">
                <h2 className="section-title">Templates & Assignment</h2>
                <p className="settings-card-description">
                  Create a standard template, then assign the selected cycle to active employees.
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
                    {isCreatingTemplate ? "Creating template..." : "Create standard template"}
                  </button>

                  <label className="form-field" htmlFor="assign-cycle">
                    <span className="form-label">Cycle</span>
                    <select
                      id="assign-cycle"
                      className="form-input"
                      value={selectedCycleId}
                      onChange={(event) => setSelectedCycleId(event.currentTarget.value)}
                    >
                      <option value="">Select cycle</option>
                      {adminQuery.data.cycles.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {cycle.name} ({toSentenceCase(cycle.type)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="assign-template">
                    <span className="form-label">Template</span>
                    <select
                      id="assign-template"
                      className="form-input"
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}
                    >
                      <option value="">Select template</option>
                      {adminQuery.data.templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="assign-due-date">
                    <span className="form-label">Due date (optional)</span>
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
                    {isAssigning ? "Assigning..." : "Assign to active employees"}
                  </button>
                </div>
              </article>

              <article className="settings-card">
                <h2 className="section-title">Assignment Tracker</h2>
                <section className="data-table-container" aria-label="Performance assignment tracker">
                  {sortedAssignments.length === 0 ? (
                    <EmptyState
                      title="No assignments yet"
                      description="Create a cycle and assign reviews to start tracking progress."
                      ctaLabel="Back to performance"
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
                              Employee
                              <span className="numeric">{assignmentSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                            </button>
                          </th>
                          <th>Cycle</th>
                          <th>Reviewer</th>
                          <th>Country</th>
                          <th>Status</th>
                          <th>Sharing</th>
                          <th>Updated</th>
                          <th className="table-action-column">Actions</th>
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
                                  <span>{countryNameFromCode(assignment.employeeCountryCode)}</span>
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
                                    <StatusBadge tone="success">Acknowledged</StatusBadge>
                                  ) : sharingStatus === "shared" ? (
                                    <StatusBadge tone="pending">Awaiting acknowledgment</StatusBadge>
                                  ) : (
                                    <button
                                      type="button"
                                      className="button button-accent button-sm"
                                      disabled={isSharingReview}
                                      onClick={() => { void shareReview(assignment.id); }}
                                    >
                                      {isSharingReview ? "Sharing..." : "Share with employee"}
                                    </button>
                                  )
                                ) : (
                                  <span className="settings-card-description">--</span>
                                )}
                              </td>
                              <td title={formatDateTimeTooltip(assignment.updatedAt)}>
                                {formatRelativeTime(assignment.updatedAt)}
                              </td>
                              <td className="table-row-action-cell">
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => showToast("info", `Assignment ${assignment.id.slice(0, 8)}`)}
                                >
                                  View
                                </button>
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
        <section className="toast-region" aria-live="polite" aria-label="Performance admin toasts">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
              >
                Dismiss
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
