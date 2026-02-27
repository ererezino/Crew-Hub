"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import {
  complianceUrgency,
  labelForComplianceCadence,
  labelForComplianceStatus,
  toneForComplianceStatus
} from "../../../lib/compliance";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { useCompliance, updateComplianceDeadline } from "../../../hooks/use-compliance";
import type {
  ComplianceDeadlineRecord,
  ComplianceStatus,
  UpdateComplianceDeadlinePayload
} from "../../../types/compliance";

type ViewMode = "table" | "calendar";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type DeadlineFormState = {
  status: ComplianceStatus;
  assignedTo: string | null;
  proofDocumentId: string | null;
  notes: string | null;
};

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() + 95);
  const start = new Date();
  start.setDate(start.getDate() - 30);

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end)
  };
}

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function summarizeDeadlines(deadlines: readonly ComplianceDeadlineRecord[]) {
  const overdueCount = deadlines.filter((row) => row.urgency === "overdue").length;
  const dueSoonCount = deadlines.filter((row) => row.urgency === "due_soon").length;
  const upcomingCount = deadlines.filter((row) => row.urgency === "upcoming").length;
  const completedCount = deadlines.filter((row) => row.urgency === "completed").length;
  const today = new Date().toISOString().slice(0, 10);

  return {
    overdueCount,
    dueSoonCount,
    upcomingCount,
    completedCount,
    nextDeadline:
      deadlines.find((row) => row.status !== "completed" && row.dueDate >= today) ?? null
  };
}

function dueDateToneClass(urgency: ComplianceDeadlineRecord["urgency"]): string {
  switch (urgency) {
    case "overdue":
      return "compliance-due-overdue";
    case "due_soon":
      return "compliance-due-soon";
    case "completed":
      return "compliance-due-completed";
    default:
      return "compliance-due-upcoming";
  }
}

function complianceSkeleton() {
  return (
    <section className="compliance-skeleton" aria-hidden="true">
      <div className="compliance-skeleton-toolbar" />
      <div className="compliance-skeleton-metrics">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`compliance-metric-skeleton-${index}`} className="compliance-skeleton-card" />
        ))}
      </div>
      <div className="compliance-skeleton-table" />
      <div className="compliance-skeleton-table" />
    </section>
  );
}

export function ComplianceClient() {
  const initialRange = useMemo(() => defaultDateRange(), []);
  const [draftStartDate, setDraftStartDate] = useState(initialRange.startDate);
  const [draftEndDate, setDraftEndDate] = useState(initialRange.endDate);
  const [range, setRange] = useState(initialRange);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedDeadlineId, setSelectedDeadlineId] = useState<string | null>(null);
  const [formState, setFormState] = useState<DeadlineFormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [optimisticDeadlines, setOptimisticDeadlines] = useState<ComplianceDeadlineRecord[] | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const complianceQuery = useCompliance(range);

  useEffect(() => {
    setOptimisticDeadlines(null);
  }, [complianceQuery.data?.deadlines]);

  const invalidRange = draftStartDate > draftEndDate;
  const sourceDeadlines = useMemo(
    () => optimisticDeadlines ?? complianceQuery.data?.deadlines ?? [],
    [optimisticDeadlines, complianceQuery.data?.deadlines]
  );

  const sortedDeadlines = useMemo(() => {
    return [...sourceDeadlines].sort((left, right) => {
      const dueComparison = left.dueDate.localeCompare(right.dueDate);

      if (dueComparison !== 0) {
        return sortDirection === "asc" ? dueComparison : dueComparison * -1;
      }

      return left.requirement.localeCompare(right.requirement);
    });
  }, [sourceDeadlines, sortDirection]);

  const summary = useMemo(() => summarizeDeadlines(sourceDeadlines), [sourceDeadlines]);

  const selectedDeadline = useMemo(
    () => sourceDeadlines.find((row) => row.id === selectedDeadlineId) ?? null,
    [selectedDeadlineId, sourceDeadlines]
  );

  const calendarGroups = useMemo(() => {
    const groups = new Map<string, ComplianceDeadlineRecord[]>();

    for (const deadline of sortedDeadlines) {
      const rows = groups.get(deadline.dueDate) ?? [];
      rows.push(deadline);
      groups.set(deadline.dueDate, rows);
    }

    return [...groups.entries()];
  }, [sortedDeadlines]);

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

  const applyRange = () => {
    if (invalidRange) {
      return;
    }

    setRange({
      startDate: draftStartDate,
      endDate: draftEndDate
    });
  };

  const openUpdateDialog = (deadlineId: string) => {
    const deadline = sourceDeadlines.find((row) => row.id === deadlineId);

    if (!deadline) {
      return;
    }

    setSelectedDeadlineId(deadline.id);
    setFormState({
      status: deadline.status,
      assignedTo: deadline.assignedTo,
      proofDocumentId: deadline.proofDocumentId,
      notes: deadline.notes
    });
  };

  const closeUpdateDialog = () => {
    if (isSaving) {
      return;
    }

    setSelectedDeadlineId(null);
    setFormState(null);
  };

  const submitUpdate = async () => {
    if (!selectedDeadline || !formState) {
      return;
    }

    const previousDeadlines = sourceDeadlines;
    const optimistic = previousDeadlines.map((row) => {
      if (row.id !== selectedDeadline.id) {
        return row;
      }

      const urgency = complianceUrgency({
        status: formState.status,
        dueDate: row.dueDate
      });

      return {
        ...row,
        status: formState.status,
        urgency,
        assignedTo: formState.assignedTo,
        assignedToName: formState.assignedTo
          ? complianceQuery.data?.assignees.find((assignee) => assignee.id === formState.assignedTo)?.fullName ?? row.assignedToName
          : null,
        proofDocumentId: formState.proofDocumentId,
        proofDocumentTitle: formState.proofDocumentId
          ? complianceQuery.data?.proofDocuments.find((proof) => proof.id === formState.proofDocumentId)?.title ?? row.proofDocumentTitle
          : null,
        completedAt: formState.status === "completed" ? row.completedAt ?? new Date().toISOString() : null,
        notes: formState.notes
      };
    });

    setOptimisticDeadlines(optimistic);
    setIsSaving(true);

    const payload: UpdateComplianceDeadlinePayload = {
      status: formState.status,
      assignedTo: formState.assignedTo,
      proofDocumentId: formState.proofDocumentId,
      notes: formState.notes
    };

    try {
      const response = await updateComplianceDeadline({
        deadlineId: selectedDeadline.id,
        payload
      });

      if (!response.data) {
        setOptimisticDeadlines(previousDeadlines);
        showToast("error", response.error?.message ?? "Unable to update deadline.");
        return;
      }

      setOptimisticDeadlines((current) =>
        (current ?? previousDeadlines).map((row) =>
          row.id === selectedDeadline.id ? response.data?.deadline ?? row : row
        )
      );
      showToast("success", "Compliance deadline updated.");
      closeUpdateDialog();
      complianceQuery.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Track statutory deadlines, completion status, and proof across countries."
        actions={
          <div className="page-header-actions">
            <button
              type="button"
              className={viewMode === "table" ? "button button-accent" : "button button-subtle"}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={viewMode === "calendar" ? "button button-accent" : "button button-subtle"}
              onClick={() => setViewMode("calendar")}
            >
              Calendar
            </button>
          </div>
        }
      />

      <section className="compliance-toolbar" aria-label="Compliance filters">
        <label className="form-field" htmlFor="compliance-start-date">
          <span className="form-label">Start date</span>
          <input
            id="compliance-start-date"
            className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
            type="date"
            value={draftStartDate}
            onChange={(event) => setDraftStartDate(event.currentTarget.value)}
          />
        </label>
        <label className="form-field" htmlFor="compliance-end-date">
          <span className="form-label">End date</span>
          <input
            id="compliance-end-date"
            className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
            type="date"
            value={draftEndDate}
            onChange={(event) => setDraftEndDate(event.currentTarget.value)}
          />
        </label>
        <div className="compliance-toolbar-actions">
          <button type="button" className="button button-accent" disabled={invalidRange} onClick={applyRange}>
            Apply
          </button>
          <button type="button" className="button button-subtle" onClick={complianceQuery.refresh}>
            Refresh
          </button>
        </div>
        {invalidRange ? <p className="form-field-error">Start date cannot be after end date.</p> : null}
      </section>

      {complianceQuery.isLoading ? complianceSkeleton() : null}

      {!complianceQuery.isLoading && complianceQuery.errorMessage ? (
        <section className="settings-layout">
          <EmptyState
            title="Compliance data unavailable"
            description={complianceQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/compliance"
          />
          <button type="button" className="button button-accent" onClick={complianceQuery.refresh}>
            Retry now
          </button>
        </section>
      ) : null}

      {!complianceQuery.isLoading && !complianceQuery.errorMessage ? (
        <section className="settings-layout">
          <section className="compliance-metric-grid" aria-label="Compliance urgency summary">
            <article className="metric-card">
              <p className="metric-label">Overdue</p>
              <p className="metric-value numeric">{summary.overdueCount}</p>
              <p className="metric-hint">Past due and not completed</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Due in 7 Days</p>
              <p className="metric-value numeric">{summary.dueSoonCount}</p>
              <p className="metric-hint">Immediate deadlines needing attention</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Upcoming</p>
              <p className="metric-value numeric">{summary.upcomingCount}</p>
              <p className="metric-hint">Future deadlines in selected range</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Completed</p>
              <p className="metric-value numeric">{summary.completedCount}</p>
              <p className="metric-hint">Marked as completed</p>
            </article>
          </section>

          <article className="settings-card compliance-next-card">
            <h2 className="section-title">Next Deadline</h2>
            {summary.nextDeadline ? (
              <p className="settings-card-description">
                <strong>{summary.nextDeadline.requirement}</strong>{" "}
                ({countryFlagFromCode(summary.nextDeadline.countryCode)} {countryNameFromCode(summary.nextDeadline.countryCode)})
                {" "}is due{" "}
                <span className={`numeric ${dueDateToneClass(summary.nextDeadline.urgency)}`} title={formatDateTimeTooltip(summary.nextDeadline.dueDate)}>
                  {formatRelativeTime(summary.nextDeadline.dueDate)}
                </span>
                .
              </p>
            ) : (
              <p className="settings-card-description">No active upcoming deadlines in this range.</p>
            )}
          </article>

          {sortedDeadlines.length === 0 ? (
            <EmptyState
              title="No compliance deadlines"
              description="No compliance deadlines exist in the selected date range."
              ctaLabel="Open dashboard"
              ctaHref="/dashboard"
            />
          ) : null}

          {sortedDeadlines.length > 0 && viewMode === "table" ? (
            <section className="data-table-container" aria-label="Compliance deadlines table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        Due Date
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Country</th>
                    <th>Requirement</th>
                    <th>Authority</th>
                    <th>Cadence</th>
                    <th>Assigned To</th>
                    <th>Status</th>
                    <th>Proof</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeadlines.map((deadline) => (
                    <tr key={deadline.id} className="data-table-row">
                      <td>
                        <p className={`numeric ${dueDateToneClass(deadline.urgency)}`} title={formatDateTimeTooltip(deadline.dueDate)}>
                          {formatRelativeTime(deadline.dueDate)}
                        </p>
                        <p className="settings-card-description">{deadline.dueDate}</p>
                      </td>
                      <td>
                        <p className="country-chip">
                          <span>{countryFlagFromCode(deadline.countryCode)}</span>
                          <span>{countryNameFromCode(deadline.countryCode)}</span>
                        </p>
                      </td>
                      <td>
                        <p>{deadline.requirement}</p>
                        <p className="settings-card-description">{deadline.description ?? "--"}</p>
                      </td>
                      <td>{deadline.authority}</td>
                      <td>{labelForComplianceCadence(deadline.cadence)}</td>
                      <td>{deadline.assignedToName ?? "--"}</td>
                      <td>
                        <StatusBadge tone={toneForComplianceStatus(deadline.status)}>
                          {labelForComplianceStatus(deadline.status)}
                        </StatusBadge>
                      </td>
                      <td>
                        {deadline.proofDocumentId ? (
                          <Link className="table-row-action" href={`/documents`}>
                            {deadline.proofDocumentTitle ?? "Attached"}
                          </Link>
                        ) : (
                          <span className="settings-card-description">None</span>
                        )}
                      </td>
                      <td className="table-row-action-cell">
                        <div className="compliance-row-actions">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openUpdateDialog(deadline.id)}
                          >
                            Update
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {sortedDeadlines.length > 0 && viewMode === "calendar" ? (
            <section className="compliance-calendar" aria-label="Compliance calendar view">
              {calendarGroups.map(([dueDate, rows]) => (
                <article key={dueDate} className="settings-card">
                  <header className="compliance-calendar-header">
                    <h3 className="section-title">{dueDate}</h3>
                    <p className="settings-card-description" title={formatDateTimeTooltip(dueDate)}>
                      {formatRelativeTime(dueDate)}
                    </p>
                  </header>
                  <ul className="compliance-calendar-list">
                    {rows.map((deadline) => (
                      <li key={deadline.id} className="compliance-calendar-item">
                        <div>
                          <p>
                            {countryFlagFromCode(deadline.countryCode)}{" "}
                            {countryNameFromCode(deadline.countryCode)} •{" "}
                            <strong>{deadline.requirement}</strong>
                          </p>
                          <p className="settings-card-description">
                            {deadline.authority} • {labelForComplianceCadence(deadline.cadence)}
                          </p>
                        </div>
                        <div className="compliance-calendar-item-meta">
                          <StatusBadge tone={toneForComplianceStatus(deadline.status)}>
                            {labelForComplianceStatus(deadline.status)}
                          </StatusBadge>
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openUpdateDialog(deadline.id)}
                          >
                            Update
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
          ) : null}
        </section>
      ) : null}

      {selectedDeadline && formState ? (
        <section className="compliance-update-dialog" aria-label="Update compliance deadline">
          <button
            type="button"
            className="compliance-update-backdrop"
            aria-label="Close update dialog"
            onClick={closeUpdateDialog}
          />
          <article className="compliance-update-panel">
            <header className="compliance-update-header">
              <div>
                <h2 className="section-title">Update Deadline</h2>
                <p className="settings-card-description">
                  {selectedDeadline.requirement} • {selectedDeadline.dueDate}
                </p>
              </div>
              <button type="button" className="button button-subtle" onClick={closeUpdateDialog}>
                Close
              </button>
            </header>

            <label className="form-field" htmlFor="compliance-status">
              <span className="form-label">Status</span>
              <select
                id="compliance-status"
                className="form-input"
                value={formState.status}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          status: event.currentTarget.value as ComplianceStatus
                        }
                      : current
                  )
                }
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>

            <label className="form-field" htmlFor="compliance-assigned-to">
              <span className="form-label">Assigned to</span>
              <select
                id="compliance-assigned-to"
                className="form-input"
                value={formState.assignedTo ?? ""}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          assignedTo: event.currentTarget.value || null
                        }
                      : current
                  )
                }
              >
                <option value="">Unassigned</option>
                {(complianceQuery.data?.assignees ?? []).map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.fullName}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="compliance-proof-document">
              <span className="form-label">Proof attachment</span>
              <select
                id="compliance-proof-document"
                className="form-input"
                value={formState.proofDocumentId ?? ""}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          proofDocumentId: event.currentTarget.value || null
                        }
                      : current
                  )
                }
              >
                <option value="">No proof document</option>
                {(complianceQuery.data?.proofDocuments ?? []).map((proof) => (
                  <option key={proof.id} value={proof.id}>
                    {proof.title}
                  </option>
                ))}
              </select>
              <Link className="settings-card-description" href="/documents">
                Upload proof in Documents
              </Link>
            </label>

            <label className="form-field" htmlFor="compliance-notes">
              <span className="form-label">Notes</span>
              <textarea
                id="compliance-notes"
                className="form-input"
                rows={3}
                maxLength={2000}
                value={formState.notes ?? ""}
                onChange={(event) =>
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          notes: event.currentTarget.value || null
                        }
                      : current
                  )
                }
              />
            </label>

            <footer className="settings-actions">
              <button type="button" className="button button-subtle" onClick={closeUpdateDialog}>
                Cancel
              </button>
              <button type="button" className="button button-accent" disabled={isSaving} onClick={() => void submitUpdate()}>
                {isSaving ? "Saving..." : "Save update"}
              </button>
            </footer>
          </article>
        </section>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Compliance toasts">
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
