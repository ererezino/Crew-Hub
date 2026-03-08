"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import {
  complianceUrgency,
  labelForComplianceCadence,
  labelForComplianceStatus,
  toneForComplianceStatus
} from "../../../lib/compliance";
import { getLocalComplianceGuidance } from "../../../lib/compliance/local-guidance";
import {
  formatDateTimeTooltip,
  formatRelativeTime,
  nowIsoTimestamp
} from "../../../lib/datetime";
import { useCompliance, updateComplianceDeadline } from "../../../hooks/use-compliance";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import type {
  ComplianceDeadlineRecord,
  ComplianceStatus,
  PolicyAckStatus,
  UpdateComplianceDeadlinePayload
} from "../../../types/compliance";
import { humanizeError } from "@/lib/errors";

/* ── Local types ── */

type ViewMode = "table" | "calendar";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";
type MetricFilter = "overdue" | "this_month" | "next_30" | null;

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

/* ── Helpers ── */

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

function isThisMonth(dateStr: string): boolean {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  return target.getUTCFullYear() === year && target.getUTCMonth() === month;
}

function isNext30Days(dateStr: string): boolean {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  const diff = target.getTime() - now.getTime();
  return diff >= 0 && diff <= 30 * 24 * 60 * 60 * 1000;
}

function computeSummary(deadlines: readonly ComplianceDeadlineRecord[]) {
  const overdueCount = deadlines.filter((r) => r.urgency === "overdue").length;
  const dueThisMonthCount = deadlines.filter(
    (r) => r.status !== "completed" && isThisMonth(r.dueDate)
  ).length;
  const dueNext30Count = deadlines.filter(
    (r) => r.status !== "completed" && isNext30Days(r.dueDate)
  ).length;

  const totalAnnual = deadlines.length;
  const completedOnTime = deadlines.filter((r) => r.status === "completed").length;
  const onTrackPct = totalAnnual > 0 ? Math.round((completedOnTime / totalAnnual) * 100) : 100;

  return { overdueCount, dueThisMonthCount, dueNext30Count, onTrackPct };
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
      <div className="table-skeleton" />
      <div className="table-skeleton" />
    </section>
  );
}

/* ── Main component ── */

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

  // Country filter
  const [countryFilter, setCountryFilter] = useState<string>("all");

  // Metric card filter
  const [metricFilter, setMetricFilter] = useState<MetricFilter>(null);

  // Generate deadlines state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateYear, setGenerateYear] = useState(new Date().getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);

  // Acknowledgment tracking state
  const [ackStatuses, setAckStatuses] = useState<PolicyAckStatus[]>([]);
  const [ackLoading, setAckLoading] = useState(true);
  const [ackError, setAckError] = useState<string | null>(null);
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());
  const [requestingAckFor, setRequestingAckFor] = useState<string | null>(null);

  const complianceQuery = useCompliance(range);

  useEffect(() => {
    setOptimisticDeadlines(null);
  }, [complianceQuery.data?.deadlines]);

  // Fetch acknowledgment statuses
  const fetchAckStatuses = useCallback(async () => {
    setAckLoading(true);
    setAckError(null);
    try {
      const response = await fetch("/api/v1/compliance/acknowledgments");
      const json = await response.json();
      if (!response.ok || json.error) {
        setAckError(json.error?.message ?? "Unable to load acknowledgment data.");
        return;
      }
      setAckStatuses((json.data as PolicyAckStatus[]) ?? []);
    } catch {
      setAckError("Unable to load acknowledgment data.");
    } finally {
      setAckLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAckStatuses();
  }, [fetchAckStatuses]);

  const invalidRange = draftStartDate > draftEndDate;
  const sourceDeadlines = useMemo(
    () => optimisticDeadlines ?? complianceQuery.data?.deadlines ?? [],
    [optimisticDeadlines, complianceQuery.data?.deadlines]
  );

  // Country tabs data
  const countryTabs = useMemo(() => {
    const countryMap = new Map<string, { total: number; overdue: number }>();

    for (const d of sourceDeadlines) {
      const entry = countryMap.get(d.countryCode) ?? { total: 0, overdue: 0 };
      entry.total++;
      if (d.urgency === "overdue") entry.overdue++;
      countryMap.set(d.countryCode, entry);
    }

    return [...countryMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, counts]) => ({
        code,
        label: countryNameFromCode(code),
        flag: countryFlagFromCode(code),
        total: counts.total,
        overdue: counts.overdue
      }));
  }, [sourceDeadlines]);

  const localGuidance = useMemo(() => {
    if (countryFilter === "all") {
      return [];
    }

    return getLocalComplianceGuidance(countryFilter);
  }, [countryFilter]);

  // Filtered deadlines (country + metric)
  const filteredDeadlines = useMemo(() => {
    let result = sourceDeadlines;

    if (countryFilter !== "all") {
      result = result.filter((d) => d.countryCode === countryFilter);
    }

    if (metricFilter === "overdue") {
      result = result.filter((d) => d.urgency === "overdue");
    } else if (metricFilter === "this_month") {
      result = result.filter((d) => d.status !== "completed" && isThisMonth(d.dueDate));
    } else if (metricFilter === "next_30") {
      result = result.filter((d) => d.status !== "completed" && isNext30Days(d.dueDate));
    }

    return result;
  }, [sourceDeadlines, countryFilter, metricFilter]);

  const sortedDeadlines = useMemo(() => {
    return [...filteredDeadlines].sort((left, right) => {
      const dueComparison = left.dueDate.localeCompare(right.dueDate);

      if (dueComparison !== 0) {
        return sortDirection === "asc" ? dueComparison : dueComparison * -1;
      }

      return left.requirement.localeCompare(right.requirement);
    });
  }, [filteredDeadlines, sortDirection]);

  const summary = useMemo(() => computeSummary(sourceDeadlines), [sourceDeadlines]);

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

  /* ── Toast helpers ── */

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);
    window.setTimeout(() => dismissToast(toastId), 4000);
  };

  /* ── Range filter ── */

  const applyRange = () => {
    if (invalidRange) return;
    setRange({ startDate: draftStartDate, endDate: draftEndDate });
  };

  /* ── Metric card click ── */

  const toggleMetricFilter = (filter: MetricFilter) => {
    setMetricFilter((current) => (current === filter ? null : filter));
  };

  /* ── SlidePanel open/close ── */

  const openUpdatePanel = useCallback((deadlineId: string) => {
    const deadline = (optimisticDeadlines ?? complianceQuery.data?.deadlines ?? []).find(
      (row) => row.id === deadlineId
    );

    if (!deadline) return;

    setSelectedDeadlineId(deadline.id);
    setFormState({
      status: deadline.status,
      assignedTo: deadline.assignedTo,
      proofDocumentId: deadline.proofDocumentId,
      notes: deadline.notes
    });
  }, [optimisticDeadlines, complianceQuery.data?.deadlines]);

  const closeUpdatePanel = useCallback(() => {
    if (isSaving) return;
    setSelectedDeadlineId(null);
    setFormState(null);
  }, [isSaving]);

  /* ── Submit deadline update ── */

  const submitUpdate = async () => {
    if (!selectedDeadline || !formState) return;

    const previousDeadlines = sourceDeadlines;
    const optimistic = previousDeadlines.map((row) => {
      if (row.id !== selectedDeadline.id) return row;

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
          ? complianceQuery.data?.assignees.find((a) => a.id === formState.assignedTo)?.fullName ?? row.assignedToName
          : null,
        proofDocumentId: formState.proofDocumentId,
        proofDocumentTitle: formState.proofDocumentId
          ? complianceQuery.data?.proofDocuments.find((p) => p.id === formState.proofDocumentId)?.title ?? row.proofDocumentTitle
          : null,
        completedAt: formState.status === "completed" ? row.completedAt ?? nowIsoTimestamp() : null,
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
      closeUpdatePanel();
      complianceQuery.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Generate deadlines ── */

  const handleGenerate = async () => {
    setIsGenerating(true);

    try {
      const response = await fetch("/api/v1/compliance/generate-deadlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: generateYear })
      });

      const json = await response.json();

      if (!response.ok || json.error) {
        showToast("error", json.error?.message ?? "Unable to generate deadlines.");
        return;
      }

      const { created, skipped } = json.data ?? { created: 0, skipped: 0 };
      showToast("success", `Generated ${created} deadline(s). ${skipped} already existed.`);
      setShowGenerateModal(false);
      complianceQuery.refresh();
    } catch {
      showToast("error", "Unable to generate deadlines.");
    } finally {
      setIsGenerating(false);
    }
  };

  /* ── Acknowledgment helpers ── */

  const togglePolicyExpansion = (policyId: string) => {
    setExpandedPolicies((current) => {
      const next = new Set(current);
      if (next.has(policyId)) {
        next.delete(policyId);
      } else {
        next.add(policyId);
      }
      return next;
    });
  };

  const requestAcknowledgment = async (policyId: string) => {
    setRequestingAckFor(policyId);
    try {
      const response = await fetch("/api/v1/compliance/acknowledgments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_id: policyId }),
      });
      const json = await response.json();
      if (!response.ok || json.error) {
        showToast("error", json.error?.message ?? "Unable to request acknowledgments.");
        return;
      }
      const count = (json.data as { created: number })?.created ?? 0;
      showToast("success", `Acknowledgment requested from ${count} employee(s).`);
      void fetchAckStatuses();
    } catch {
      showToast("error", "Unable to request acknowledgments.");
    } finally {
      setRequestingAckFor(null);
    }
  };

  /* ── Render ── */

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Statutory filings with due dates, proof, and country tracking."
        actions={
          <>
            <button
              type="button"
              className="button button-accent"
              onClick={() => setShowGenerateModal(true)}
            >
              Generate {new Date().getFullYear()} deadlines
            </button>
            <button
              type="button"
              className={viewMode === "table" ? "button button-primary" : "button button-subtle"}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={viewMode === "calendar" ? "button button-primary" : "button button-subtle"}
              onClick={() => setViewMode("calendar")}
            >
              Calendar
            </button>
          </>
        }
      />

      {/* ── Date range toolbar ── */}
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
        <ErrorState
          title="Compliance data unavailable"
          message={complianceQuery.errorMessage}
          onRetry={complianceQuery.refresh}
        />
      ) : null}

      {!complianceQuery.isLoading && !complianceQuery.errorMessage ? (
        <section className="settings-layout">

          {/* ── Summary metric cards — clickable ── */}
          <section className="compliance-metric-grid" aria-label="Compliance summary">
            <button
              type="button"
              className={`metric-card compliance-metric-clickable${metricFilter === "overdue" ? " compliance-metric-active" : ""}`}
              style={{ borderColor: "var(--status-error-border)" }}
              onClick={() => toggleMetricFilter("overdue")}
            >
              <p className="metric-label" style={{ color: "var(--status-error-text)" }}>Overdue</p>
              <p className="metric-value numeric" style={{ color: "var(--status-error-text)" }}>
                {summary.overdueCount}
              </p>
            </button>
            <button
              type="button"
              className={`metric-card compliance-metric-clickable${metricFilter === "this_month" ? " compliance-metric-active" : ""}`}
              style={{ borderColor: "var(--status-warning-border)" }}
              onClick={() => toggleMetricFilter("this_month")}
            >
              <p className="metric-label" style={{ color: "var(--status-warning-text)" }}>Due this month</p>
              <p className="metric-value numeric" style={{ color: "var(--status-warning-text)" }}>
                {summary.dueThisMonthCount}
              </p>
            </button>
            <button
              type="button"
              className={`metric-card compliance-metric-clickable${metricFilter === "next_30" ? " compliance-metric-active" : ""}`}
              style={{ borderColor: "var(--status-info-border)" }}
              onClick={() => toggleMetricFilter("next_30")}
            >
              <p className="metric-label" style={{ color: "var(--status-info-text)" }}>Due next 30 days</p>
              <p className="metric-value numeric" style={{ color: "var(--status-info-text)" }}>
                {summary.dueNext30Count}
              </p>
            </button>
            <article
              className="metric-card"
              style={{ borderColor: "var(--status-success-border)" }}
            >
              <p className="metric-label" style={{ color: "var(--status-success-text)" }}>On track</p>
              <p className="metric-value numeric" style={{ color: "var(--status-success-text)" }}>
                {summary.onTrackPct}%
              </p>
            </article>
          </section>

          {/* ── Country filter tabs ── */}
          {countryTabs.length > 1 ? (
            <section className="page-tabs" aria-label="Filter by country">
              <button
                type="button"
                className={countryFilter === "all" ? "page-tab page-tab-active" : "page-tab"}
                onClick={() => setCountryFilter("all")}
              >
                All
              </button>
              {countryTabs.map((tab) => (
                <button
                  key={tab.code}
                  type="button"
                  className={countryFilter === tab.code ? "page-tab page-tab-active" : "page-tab"}
                  onClick={() => setCountryFilter(tab.code)}
                >
                  {tab.flag} {tab.code}
                  {tab.overdue > 0 ? (
                    <span className="compliance-country-tab-badge">{tab.overdue}</span>
                  ) : null}
                </button>
              ))}
            </section>
          ) : null}

          <section className="settings-card compliance-local-guidance" aria-label="Local authority guidance">
            <header className="compliance-local-guidance-header">
              <h2 className="section-title">Local authority guidance</h2>
              <p className="settings-card-description">
                {countryFilter === "all"
                  ? "Select a country tab to view local filing guidance and official authority links."
                  : `Reference links for ${countryNameFromCode(countryFilter)} filing obligations.`}
              </p>
            </header>

            {countryFilter === "all" ? null : localGuidance.length > 0 ? (
              <ul className="compliance-local-guidance-list">
                {localGuidance.map((entry) => (
                  <li key={`${entry.countryCode}-${entry.authority}`} className="compliance-local-guidance-item">
                    <div>
                      <p className="form-label">{entry.authority}</p>
                      <p className="settings-card-description">{entry.local_guidance}</p>
                    </div>
                    <a
                      className="table-row-action"
                      href={entry.authority_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Authority site
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-card-description">
                No local authority guidance is configured for this country yet.
              </p>
            )}
          </section>

          {/* ── Active filter indicator ── */}
          {metricFilter || countryFilter !== "all" ? (
            <div className="compliance-active-filters">
              <span className="settings-card-description">
                Showing {sortedDeadlines.length} of {sourceDeadlines.length} deadlines
                {countryFilter !== "all" ? ` in ${countryNameFromCode(countryFilter)}` : ""}
                {metricFilter === "overdue" ? " (overdue)" : ""}
                {metricFilter === "this_month" ? " (due this month)" : ""}
                {metricFilter === "next_30" ? " (due next 30 days)" : ""}
              </span>
              <button
                type="button"
                className="button button-subtle"
                onClick={() => { setMetricFilter(null); setCountryFilter("all"); }}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {sortedDeadlines.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={32} />}
              title="No compliance deadlines in this date range"
              description={
                metricFilter || countryFilter !== "all"
                  ? "No deadlines match the current filters."
                  : "Try a wider date range or generate deadlines for the next year."
              }
              ctaLabel="Clear filters"
              ctaHref="/compliance"
            />
          ) : null}

          {/* ── Table view ── */}
          {sortedDeadlines.length > 0 && viewMode === "table" ? (
            <section className="data-table-container" aria-label="Compliance deadlines table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Authority</th>
                    <th>Country</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        Due Date
                        <span className="numeric">{sortDirection === "asc" ? " ↑" : " ↓"}</span>
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeadlines.map((deadline) => (
                    <tr
                      key={deadline.id}
                      className="data-table-row compliance-table-row-clickable"
                      onClick={() => openUpdatePanel(deadline.id)}
                    >
                      <td>
                        <p>{deadline.requirement}</p>
                      </td>
                      <td>{deadline.authority}</td>
                      <td>
                        <p className="country-chip">
                          <span>{countryFlagFromCode(deadline.countryCode)}</span>
                          <span>{countryNameFromCode(deadline.countryCode)}</span>
                        </p>
                      </td>
                      <td>
                        <p className={`numeric ${dueDateToneClass(deadline.urgency)}`} title={formatDateTimeTooltip(deadline.dueDate)}>
                          {formatRelativeTime(deadline.dueDate)}
                        </p>
                        <p className="settings-card-description">{deadline.dueDate}</p>
                      </td>
                      <td>
                        <StatusBadge tone={toneForComplianceStatus(deadline.status)}>
                          {labelForComplianceStatus(deadline.status)}
                        </StatusBadge>
                      </td>
                      <td>{deadline.assignedToName ?? <span className="settings-card-description">Unassigned</span>}</td>
                      <td>
                        {deadline.proofDocumentId ? (
                          <Link className="table-row-action" href="/documents" onClick={(e) => e.stopPropagation()}>
                            View
                          </Link>
                        ) : (
                          <span className="settings-card-description">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {/* ── Calendar view ── */}
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
                            onClick={() => openUpdatePanel(deadline.id)}
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

          {/* ── Acknowledgment Tracking ── */}
          <section className="ack-tracking-section" aria-label="Policy acknowledgment tracking">
            <h2 className="ack-tracking-title">Acknowledgment Tracking</h2>

            {ackLoading ? (
              <div className="compliance-skeleton" aria-hidden="true">
                <div className="compliance-skeleton-card" />
                <div className="compliance-skeleton-card" />
              </div>
            ) : null}

            {!ackLoading && ackError ? (
              <ErrorState
                title="Acknowledgments unavailable"
                message={ackError}
                onRetry={() => void fetchAckStatuses()}
              />
            ) : null}

            {!ackLoading && !ackError && ackStatuses.length === 0 ? (
              <EmptyState
                title="No policies to acknowledge"
                description="No published policies require acknowledgment yet."
                showIcon={false}
              />
            ) : null}

            {!ackLoading && !ackError && ackStatuses.length > 0 ? (
              <div>
                {ackStatuses.map((status) => {
                  const isExpanded = expandedPolicies.has(status.policy_id);
                  const progressPct =
                    status.total_required > 0
                      ? Math.round((status.acknowledged_count / status.total_required) * 100)
                      : 0;

                  return (
                    <article key={status.policy_id} className="ack-policy-card">
                      <div className="ack-policy-header">
                        <button
                          type="button"
                          className="ack-policy-name"
                          onClick={() => togglePolicyExpansion(status.policy_id)}
                          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", padding: 0 }}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {status.policy_name}
                        </button>
                        <div className="ack-progress">
                          <div className="ack-progress-bar">
                            <div
                              className="ack-progress-fill"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="ack-progress-text">
                            {status.acknowledged_count}/{status.total_required}
                          </span>
                          <button
                            type="button"
                            className="button button-subtle ack-request-btn"
                            disabled={requestingAckFor === status.policy_id}
                            onClick={() => void requestAcknowledgment(status.policy_id)}
                          >
                            {requestingAckFor === status.policy_id
                              ? "Requesting..."
                              : "Request Acknowledgment"}
                          </button>
                        </div>
                      </div>

                      {isExpanded && status.pending_employees.length > 0 ? (
                        <div className="ack-pending-list">
                          {status.pending_employees.map((emp) => (
                            <div key={emp.id} className="ack-pending-employee">
                              <span>{emp.full_name}</span>
                              <span className="ack-pending-employee-email">{emp.email}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {isExpanded && status.pending_employees.length === 0 && status.pending_count === 0 ? (
                        <div className="ack-pending-list">
                          <p className="settings-card-description">All employees have acknowledged this policy.</p>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        </section>
      ) : null}

      {/* ── SlidePanel for updating a deadline ── */}
      <SlidePanel
        isOpen={!!selectedDeadline && !!formState}
        title={selectedDeadline?.requirement ?? "Update Deadline"}
        description={selectedDeadline ? `${selectedDeadline.authority} • Due ${selectedDeadline.dueDate}` : undefined}
        onClose={closeUpdatePanel}
      >
        {selectedDeadline && formState ? (
          <div className="slide-panel-form">
            {selectedDeadline.description ? (
              <p className="settings-card-description" style={{ marginBottom: "var(--space-4)" }}>
                {selectedDeadline.description}
              </p>
            ) : null}

            <label className="form-field" htmlFor="compliance-status">
              <span className="form-label">Status</span>
              <select
                id="compliance-status"
                className="form-input"
                value={formState.status}
                onChange={(event) =>
                  setFormState((current) =>
                    current ? { ...current, status: event.currentTarget.value as ComplianceStatus } : current
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
                    current ? { ...current, assignedTo: event.currentTarget.value || null } : current
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
                    current ? { ...current, proofDocumentId: event.currentTarget.value || null } : current
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
                    current ? { ...current, notes: event.currentTarget.value || null } : current
                  )
                }
              />
            </label>

            <footer className="settings-actions">
              <button type="button" className="button button-subtle" onClick={closeUpdatePanel}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-accent"
                disabled={isSaving}
                onClick={() => void submitUpdate()}
              >
                {isSaving ? "Saving..." : "Save changes"}
              </button>
            </footer>
          </div>
        ) : null}
      </SlidePanel>

      {/* ── Generate deadlines confirmation modal ── */}
      {showGenerateModal ? (
        <section className="compliance-update-dialog" aria-label="Generate deadlines confirmation">
          <button
            type="button"
            className="compliance-update-backdrop"
            aria-label="Close modal"
            onClick={() => setShowGenerateModal(false)}
          />
          <article className="compliance-update-panel">
            <header className="compliance-update-header">
              <div>
                <h2 className="section-title">Generate Compliance Deadlines</h2>
                <p className="settings-card-description">
                  This will create deadline records for all compliance items for the selected year.
                  Existing deadlines will not be duplicated.
                </p>
              </div>
              <button
                type="button"
                className="button button-subtle"
                onClick={() => setShowGenerateModal(false)}
              >
                Close
              </button>
            </header>

            <label className="form-field" htmlFor="generate-year">
              <span className="form-label">Year</span>
              <input
                id="generate-year"
                type="number"
                className="form-input numeric"
                min={2020}
                max={2100}
                value={generateYear}
                onChange={(event) => setGenerateYear(parseInt(event.currentTarget.value, 10) || new Date().getFullYear())}
              />
            </label>

            <footer className="settings-actions">
              <button type="button" className="button button-subtle" onClick={() => setShowGenerateModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-accent"
                disabled={isGenerating}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? "Generating..." : `Generate ${generateYear} deadlines`}
              </button>
            </footer>
          </article>
        </section>
      ) : null}

      {/* ── Toasts ── */}
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
