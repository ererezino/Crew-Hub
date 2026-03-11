"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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

type AppLocale = "en" | "fr";
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
  const t = useTranslations('compliance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
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
        setAckError(json.error?.message ?? t('toast.unableToLoadAcknowledgments'));
        return;
      }
      setAckStatuses((json.data as PolicyAckStatus[]) ?? []);
    } catch {
      setAckError(t('toast.unableToLoadAcknowledgments'));
    } finally {
      setAckLoading(false);
    }
  }, [t]);

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
        label: countryNameFromCode(code, locale),
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
        showToast("error", response.error?.message ?? t('toast.unableToUpdateDeadline'));
        return;
      }

      setOptimisticDeadlines((current) =>
        (current ?? previousDeadlines).map((row) =>
          row.id === selectedDeadline.id ? response.data?.deadline ?? row : row
        )
      );
      showToast("success", t('toast.deadlineUpdated'));
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
        showToast("error", json.error?.message ?? t('toast.unableToGenerate'));
        return;
      }

      const { created, skipped } = json.data ?? { created: 0, skipped: 0 };
      showToast("success", t('toast.generated', { created, skipped }));
      setShowGenerateModal(false);
      complianceQuery.refresh();
    } catch {
      showToast("error", t('toast.unableToGenerate'));
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
        showToast("error", json.error?.message ?? t('toast.unableToRequestAck'));
        return;
      }
      const count = (json.data as { created: number })?.created ?? 0;
      showToast("success", t('toast.ackRequested', { count }));
      void fetchAckStatuses();
    } catch {
      showToast("error", t('toast.unableToRequestAck'));
    } finally {
      setRequestingAckFor(null);
    }
  };

  /* ── Render ── */

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <button
              type="button"
              className="button button-accent"
              onClick={() => setShowGenerateModal(true)}
            >
              {t('generateDeadlinesButton', { year: new Date().getFullYear() })}
            </button>
            <button
              type="button"
              className={viewMode === "table" ? "button button-primary" : "button button-subtle"}
              onClick={() => setViewMode("table")}
            >
              {t('viewMode.table')}
            </button>
            <button
              type="button"
              className={viewMode === "calendar" ? "button button-primary" : "button button-subtle"}
              onClick={() => setViewMode("calendar")}
            >
              {t('viewMode.calendar')}
            </button>
          </>
        }
      />

      {/* ── Date range toolbar ── */}
      <section className="compliance-toolbar" aria-label={t('title')}>
        <label className="form-field" htmlFor="compliance-start-date">
          <span className="form-label">{t('toolbar.startDate')}</span>
          <input
            id="compliance-start-date"
            className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
            type="date"
            value={draftStartDate}
            onChange={(event) => setDraftStartDate(event.currentTarget.value)}
          />
        </label>
        <label className="form-field" htmlFor="compliance-end-date">
          <span className="form-label">{t('toolbar.endDate')}</span>
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
            {t('toolbar.apply')}
          </button>
          <button type="button" className="button button-subtle" onClick={complianceQuery.refresh}>
            {t('toolbar.refresh')}
          </button>
        </div>
        {invalidRange ? <p className="form-field-error">{t('toolbar.startAfterEndError')}</p> : null}
      </section>

      {complianceQuery.isLoading ? complianceSkeleton() : null}

      {!complianceQuery.isLoading && complianceQuery.errorMessage ? (
        <ErrorState
          title={t('errorTitle')}
          message={complianceQuery.errorMessage}
          onRetry={complianceQuery.refresh}
        />
      ) : null}

      {!complianceQuery.isLoading && !complianceQuery.errorMessage ? (
        <section className="settings-layout">

          {/* ── Summary metric cards — clickable ── */}
          <section className="compliance-metric-grid" aria-label={t('title')}>
            <button
              type="button"
              className={`metric-card compliance-metric-clickable${metricFilter === "overdue" ? " compliance-metric-active" : ""}`}
              style={{ borderColor: "var(--status-error-border)" }}
              onClick={() => toggleMetricFilter("overdue")}
            >
              <p className="metric-label" style={{ color: "var(--status-error-text)" }}>{t('metrics.overdue')}</p>
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
              <p className="metric-label" style={{ color: "var(--status-warning-text)" }}>{t('metrics.dueThisMonth')}</p>
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
              <p className="metric-label" style={{ color: "var(--status-info-text)" }}>{t('metrics.dueNext30Days')}</p>
              <p className="metric-value numeric" style={{ color: "var(--status-info-text)" }}>
                {summary.dueNext30Count}
              </p>
            </button>
            <article
              className="metric-card"
              style={{ borderColor: "var(--status-success-border)" }}
            >
              <p className="metric-label" style={{ color: "var(--status-success-text)" }}>{t('metrics.onTrack')}</p>
              <p className="metric-value numeric" style={{ color: "var(--status-success-text)" }}>
                {summary.onTrackPct}%
              </p>
            </article>
          </section>

          {/* ── Country filter tabs ── */}
          {countryTabs.length > 1 ? (
            <section className="page-tabs" aria-label={t('table.country')}>
              <button
                type="button"
                className={countryFilter === "all" ? "page-tab page-tab-active" : "page-tab"}
                onClick={() => setCountryFilter("all")}
              >
                {t('countryFilter.all')}
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

          <section className="settings-card compliance-local-guidance" aria-label={t('localGuidance.title')}>
            <header className="compliance-local-guidance-header">
              <h2 className="section-title">{t('localGuidance.title')}</h2>
              <p className="settings-card-description">
                {countryFilter === "all"
                  ? t('localGuidance.descriptionAll')
                  : t('localGuidance.descriptionCountry', { country: countryNameFromCode(countryFilter, locale) })}
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
                      {t('localGuidance.authoritySite')}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-card-description">
                {t('localGuidance.noGuidance')}
              </p>
            )}
          </section>

          {/* ── Active filter indicator ── */}
          {metricFilter || countryFilter !== "all" ? (
            <div className="compliance-active-filters">
              <span className="settings-card-description">
                {t('activeFilters.showing', { filtered: sortedDeadlines.length, total: sourceDeadlines.length })}
                {countryFilter !== "all" ? ` ${t('activeFilters.inCountry', { country: countryNameFromCode(countryFilter, locale) })}` : ""}
                {metricFilter === "overdue" ? ` ${t('activeFilters.overdue')}` : ""}
                {metricFilter === "this_month" ? ` ${t('activeFilters.dueThisMonth')}` : ""}
                {metricFilter === "next_30" ? ` ${t('activeFilters.dueNext30')}` : ""}
              </span>
              <button
                type="button"
                className="button button-subtle"
                onClick={() => { setMetricFilter(null); setCountryFilter("all"); }}
              >
                {t('activeFilters.clearFilters')}
              </button>
            </div>
          ) : null}

          {sortedDeadlines.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={32} />}
              title={t('emptyState.title')}
              description={
                metricFilter || countryFilter !== "all"
                  ? t('emptyState.descriptionFiltered')
                  : t('emptyState.descriptionDefault')
              }
              ctaLabel={t('emptyState.clearFilters')}
              ctaHref="/compliance"
            />
          ) : null}

          {/* ── Table view ── */}
          {sortedDeadlines.length > 0 && viewMode === "table" ? (
            <section className="data-table-container" aria-label={t('title')}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('table.requirement')}</th>
                    <th>{t('table.authority')}</th>
                    <th>{t('table.country')}</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        {t('table.dueDate')}
                        <span className="numeric">{sortDirection === "asc" ? " ↑" : " ↓"}</span>
                      </button>
                    </th>
                    <th>{t('table.status')}</th>
                    <th>{t('table.assignedTo')}</th>
                    <th>{t('table.proof')}</th>
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
                          <span>{countryNameFromCode(deadline.countryCode, locale)}</span>
                        </p>
                      </td>
                      <td>
                        <p className={`numeric ${dueDateToneClass(deadline.urgency)}`} title={formatDateTimeTooltip(deadline.dueDate, locale)}>
                          {formatRelativeTime(deadline.dueDate, locale)}
                        </p>
                        <p className="settings-card-description">{deadline.dueDate}</p>
                      </td>
                      <td>
                        <StatusBadge tone={toneForComplianceStatus(deadline.status)}>
                          {labelForComplianceStatus(deadline.status)}
                        </StatusBadge>
                      </td>
                      <td>{deadline.assignedToName ?? <span className="settings-card-description">{t('table.unassigned')}</span>}</td>
                      <td>
                        {deadline.proofDocumentId ? (
                          <Link className="table-row-action" href="/documents" onClick={(e) => e.stopPropagation()}>
                            {t('table.view')}
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
            <section className="compliance-calendar" aria-label={t('calendarView.ariaLabel')}>
              {calendarGroups.map(([dueDate, rows]) => (
                <article key={dueDate} className="settings-card">
                  <header className="compliance-calendar-header">
                    <h3 className="section-title">{dueDate}</h3>
                    <p className="settings-card-description" title={formatDateTimeTooltip(dueDate, locale)}>
                      {formatRelativeTime(dueDate, locale)}
                    </p>
                  </header>
                  <ul className="compliance-calendar-list">
                    {rows.map((deadline) => (
                      <li key={deadline.id} className="compliance-calendar-item">
                        <div>
                          <p>
                            {countryFlagFromCode(deadline.countryCode)}{" "}
                            {countryNameFromCode(deadline.countryCode, locale)} •{" "}
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
                            {t('table.update')}
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
          <section className="ack-tracking-section" aria-label={t('acknowledgment.title')}>
            <h2 className="ack-tracking-title">{t('acknowledgment.title')}</h2>

            {ackLoading ? (
              <div className="compliance-skeleton" aria-hidden="true">
                <div className="compliance-skeleton-card" />
                <div className="compliance-skeleton-card" />
              </div>
            ) : null}

            {!ackLoading && ackError ? (
              <ErrorState
                title={t('acknowledgment.unavailableTitle')}
                message={ackError}
                onRetry={() => void fetchAckStatuses()}
              />
            ) : null}

            {!ackLoading && !ackError && ackStatuses.length === 0 ? (
              <EmptyState
                title={t('acknowledgment.noPoliciesTitle')}
                description={t('acknowledgment.noPoliciesDescription')}
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
                              ? t('acknowledgment.requesting')
                              : t('acknowledgment.requestAcknowledgment')}
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
                          <p className="settings-card-description">{t('acknowledgment.allAcknowledged')}</p>
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
        title={selectedDeadline?.requirement ?? t('panel.defaultTitle')}
        description={selectedDeadline ? `${selectedDeadline.authority} • ${t('table.dueDate')} ${selectedDeadline.dueDate}` : undefined}
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
              <span className="form-label">{t('panel.statusLabel')}</span>
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
                <option value="pending">{t('panelStatus.pending')}</option>
                <option value="in_progress">{t('panelStatus.inProgress')}</option>
                <option value="completed">{t('panelStatus.completed')}</option>
                <option value="overdue">{t('panelStatus.overdue')}</option>
              </select>
            </label>

            <label className="form-field" htmlFor="compliance-assigned-to">
              <span className="form-label">{t('panel.assignedToLabel')}</span>
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
                <option value="">{t('panel.unassigned')}</option>
                {(complianceQuery.data?.assignees ?? []).map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.fullName}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="compliance-proof-document">
              <span className="form-label">{t('panel.proofAttachment')}</span>
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
                <option value="">{t('panel.noProofDocument')}</option>
                {(complianceQuery.data?.proofDocuments ?? []).map((proof) => (
                  <option key={proof.id} value={proof.id}>
                    {proof.title}
                  </option>
                ))}
              </select>
              <Link className="settings-card-description" href="/documents">
                {t('panel.uploadProofLink')}
              </Link>
            </label>

            <label className="form-field" htmlFor="compliance-notes">
              <span className="form-label">{t('panel.notesLabel')}</span>
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
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                className="button button-accent"
                disabled={isSaving}
                onClick={() => void submitUpdate()}
              >
                {isSaving ? tCommon('working') : t('panel.saveChanges')}
              </button>
            </footer>
          </div>
        ) : null}
      </SlidePanel>

      {/* ── Generate deadlines confirmation modal ── */}
      {showGenerateModal ? (
        <section className="compliance-update-dialog" aria-label={t('generateModal.title')}>
          <button
            type="button"
            className="compliance-update-backdrop"
            aria-label={tCommon('close')}
            onClick={() => setShowGenerateModal(false)}
          />
          <article className="compliance-update-panel">
            <header className="compliance-update-header">
              <div>
                <h2 className="section-title">{t('generateModal.title')}</h2>
                <p className="settings-card-description">
                  {t('generateModal.description')}
                </p>
              </div>
              <button
                type="button"
                className="button button-subtle"
                onClick={() => setShowGenerateModal(false)}
              >
                {tCommon('close')}
              </button>
            </header>

            <label className="form-field" htmlFor="generate-year">
              <span className="form-label">{t('generateModal.yearLabel')}</span>
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
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                className="button button-accent"
                disabled={isGenerating}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? t('generateModal.generating') : t('generateModal.generateButton', { year: generateYear })}
              </button>
            </footer>
          </article>
        </section>
      ) : null}

      {/* ── Toasts ── */}
      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label={t('title')}>
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={t('dismissToast')}
              >
                {t('dismissToast')}
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
