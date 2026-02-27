"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import {
  labelForReviewAssignmentStatus,
  labelForReviewCycleStatus,
  toneForReviewAssignmentStatus,
  toneForReviewCycleStatus
} from "../../../../lib/performance/reviews";
import { usePerformanceAdmin } from "../../../../hooks/use-performance";
import type {
  AssignReviewApiResponse,
  AssignReviewPayload,
  CreateReviewCycleApiResponse,
  CreateReviewCyclePayload,
  CreateReviewTemplateApiResponse,
  CreateReviewTemplatePayload,
  ReviewSectionDefinition
} from "../../../../types/performance";

type SortDirection = "asc" | "desc";
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
  return new Date().toISOString().slice(0, 10);
}

function defaultCycleFormValues(): CycleFormValues {
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

  return {
    name: "",
    type: "quarterly",
    status: "draft",
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
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
      <div className="performance-skeleton-table" />
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

export function AdminPerformanceClient() {
  const adminQuery = usePerformanceAdmin();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [cycleForm, setCycleForm] = useState<CycleFormValues>(defaultCycleFormValues);
  const [cycleFormValidation, setCycleFormValidation] = useState<
    Partial<Record<keyof CycleFormValues, string>>
  >({});
  const [isCreatingCycle, setIsCreatingCycle] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

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

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
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
        description="Create review cycles, assign templates, and track completion progress."
        actions={
          <Link className="button button-subtle" href="/performance">
            Back to performance
          </Link>
        }
      />

      {adminQuery.isLoading ? adminSkeleton() : null}

      {!adminQuery.isLoading && adminQuery.errorMessage ? (
        <section className="settings-layout">
          <EmptyState
            title="Performance admin unavailable"
            description={adminQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/performance/admin"
          />
          <button type="button" className="button button-accent" onClick={adminQuery.refresh}>
            Retry now
          </button>
        </section>
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
                      {cycle.name} ({cycle.type})
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
                          <span className="numeric">{assignmentSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Cycle</th>
                      <th>Reviewer</th>
                      <th>Country</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssignments.map((assignment) => (
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
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </article>
        </section>
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
