"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import {
  ArrowRight,
  Ban,
  Banknote,
  CheckCircle2,
  CircleDot,
  History,
  ShieldAlert,
  Zap
} from "lucide-react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import { labelForPayrollCycleStatus, toneForPayrollCycleStatus } from "../../../../lib/payroll/runs";
import type { FinanceOversightData, OversightActiveCycle } from "../../../../types/dashboard";

type AppLocale = "en" | "fr";

type StatusTone = "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing";

function useOversightData() {
  const [data, setData] = useState<FinanceOversightData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/v1/payroll/oversight");
        const json = await response.json();

        if (!response.ok || json.error) {
          setError(json.error?.message ?? "Unable to load oversight data.");
          return;
        }

        setData(json.data);
      } catch {
        setError("Unable to load oversight data.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return { data, error, loading };
}

function OversightSkeleton() {
  return (
    <>
      <section className="oversight-brief-card oversight-brief-card-skeleton" aria-hidden="true" />
      <section className="oversight-summary-grid" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`summary-skeleton-${index}`} className="metric-card settings-skeleton" />
        ))}
      </section>
      <section className="oversight-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`card-skeleton-${index}`} className="oversight-card-skeleton" />
        ))}
      </section>
    </>
  );
}

function safeCycleTone(status: string): StatusTone {
  const tone = toneForPayrollCycleStatus(status);
  const validTones: StatusTone[] = ["success", "warning", "error", "info", "pending", "draft", "processing"];
  return validTones.includes(tone as StatusTone) ? (tone as StatusTone) : "pending";
}

function SummaryCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: number;
  hint: string;
  tone: "urgent" | "warning" | "danger" | "info" | "success";
}) {
  return (
    <article className={`metric-card oversight-summary-card oversight-summary-card-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-hint">{hint}</span>
    </article>
  );
}

function BriefStat({
  label,
  value,
  hint
}: {
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="oversight-brief-stat-card">
      <span className="metric-label">{label}</span>
      <strong className="oversight-brief-stat-value">{value}</strong>
      <span className="metric-hint">{hint}</span>
    </div>
  );
}

function CycleCard({ cycle }: { cycle: OversightActiveCycle }) {
  const t = useTranslations("dashboard.financeOversight");
  const cycleLabel = cycle.label ?? cycle.payPeriod ?? t("unknownPeriod");

  return (
    <li className="oversight-card-item">
      <span className="oversight-item-period">{cycleLabel}</span>
      <StatusBadge tone={safeCycleTone(cycle.status)}>
        {labelForPayrollCycleStatus(cycle.status)}
      </StatusBadge>
      <span className="oversight-item-meta settings-card-description">
        <CurrencyDisplay amount={cycle.totalNet} currency={cycle.currency} />
      </span>
      <Link href={`/payroll/runs/${cycle.runId}`} className="oversight-item-action button button-subtle button-sm">
        {t("viewRun")}
      </Link>
    </li>
  );
}

function HistoricalStepBadge({ step }: { step: "review" | "authorize" | "publish" }) {
  const t = useTranslations("dashboard.financeOversight");

  const labels: Record<string, string> = {
    review: t("historicalNeedsReview"),
    authorize: t("historicalNeedsAuthorization"),
    publish: t("historicalReadyToPublish")
  };
  const tones: Record<string, StatusTone> = {
    review: "warning",
    authorize: "processing",
    publish: "info"
  };

  return <StatusBadge tone={tones[step] ?? "pending"}>{labels[step] ?? step}</StatusBadge>;
}

export function OversightClient() {
  const t = useTranslations("dashboard.financeOversight");
  const locale = useLocale() as AppLocale;
  const { data, error, loading } = useOversightData();

  if (loading) {
    return (
      <div className="oversight-page">
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <OversightSkeleton />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="oversight-page">
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <ErrorState message={error ?? t("loadFailed")} />
      </div>
    );
  }

  const approvalQueueCount = data.pendingPayrollApprovals.length + data.pendingSalaryApprovals.count;
  const blockerCount = data.completionGaps.length + data.payoutBlockers.length;
  const flaggedItemCount = data.payoutBlockers.reduce((sum, blocker) => sum + blocker.flaggedCount, 0);
  const historicalCount = data.historicalAwaitingAction.length;
  const activeCyclesCount = data.activeCycles.length;
  const attentionCount = approvalQueueCount + blockerCount + historicalCount;
  const cashInMotion = data.activeCycles.reduce((sum, cycle) => sum + cycle.totalNet, 0);

  const hasAnything = attentionCount > 0 || activeCyclesCount > 0;

  const primaryAction = data.pendingPayrollApprovals[0]
    ? { href: `/payroll/runs/${data.pendingPayrollApprovals[0].id}`, label: t("primaryActionReviewQueue") }
    : data.completionGaps[0]
      ? { href: `/payroll/runs/${data.completionGaps[0].id}`, label: t("primaryActionOpenBlocker") }
      : data.payoutBlockers[0]
        ? { href: `/payroll/runs/${data.payoutBlockers[0].runId}`, label: t("primaryActionOpenBlocker") }
        : data.historicalAwaitingAction[0]
          ? { href: `/payroll/runs/${data.historicalAwaitingAction[0].id}`, label: t("primaryActionReviewHistory") }
          : data.pendingSalaryApprovals.count > 0
            ? { href: "/admin/compensation", label: t("viewSalary") }
            : null;

  return (
    <div className="oversight-page">
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <div className="oversight-page-actions">
            <Link href="/payroll" className="button button-subtle">
              {t("secondaryActionOpenPayroll")}
            </Link>
            {primaryAction ? (
              <Link href={primaryAction.href} className="button button-accent">
                {primaryAction.label} <ArrowRight size={14} />
              </Link>
            ) : null}
          </div>
        }
      />

      <section className={`oversight-brief-card${hasAnything ? "" : " oversight-brief-card-clear"}`}>
        <div className="oversight-brief-copy">
          <span className="metric-label">{t("briefLabel")}</span>
          <h2 className="oversight-brief-title">{t("briefTitle", { count: attentionCount })}</h2>
          <p className="oversight-brief-description">{t("briefDescription")}</p>
        </div>
        <div className="oversight-brief-stats">
          <BriefStat
            label={t("needsAttentionLabel")}
            value={attentionCount}
            hint={t("summaryBlockersHint")}
          />
          <BriefStat
            label={t("summaryFlaggedItemsLabel")}
            value={flaggedItemCount}
            hint={t("summaryFlaggedItemsHint")}
          />
          <BriefStat
            label={t("summaryCashInMotionLabel")}
            value={<CurrencyDisplay amount={cashInMotion} currency="NGN" />}
            hint={t("summaryCashInMotionHint")}
          />
        </div>
      </section>

      <section className="oversight-summary-grid" aria-label={t("summarySectionLabel")}>
        <SummaryCard
          label={t("summaryApprovalsLabel")}
          value={approvalQueueCount}
          hint={t("summaryApprovalsHint")}
          tone="urgent"
        />
        <SummaryCard
          label={t("summaryBlockersLabel")}
          value={blockerCount}
          hint={t("summaryBlockersHint")}
          tone="danger"
        />
        <SummaryCard
          label={t("summaryFlaggedItemsLabel")}
          value={flaggedItemCount}
          hint={t("summaryFlaggedItemsHint")}
          tone="warning"
        />
        <SummaryCard
          label={t("summaryActiveCyclesLabel")}
          value={activeCyclesCount}
          hint={t("summaryActiveCyclesHint")}
          tone="info"
        />
        <SummaryCard
          label={t("summaryHistoricalLabel")}
          value={historicalCount}
          hint={t("summaryHistoricalHint")}
          tone="success"
        />
      </section>

      {!hasAnything ? (
        <EmptyState
          title={t("allClearTitle")}
          description={t("allClearDescription")}
        />
      ) : (
        <>
          <section className="oversight-section">
            <h2 className="oversight-section-title">
              <ShieldAlert size={16} />
              {t("attentionSectionTitle")}
            </h2>
            <p className="oversight-section-description">{t("attentionSectionDescription")}</p>
            <div className="oversight-grid">
              {data.pendingPayrollApprovals.length > 0 ? (
                <article className="oversight-card oversight-card-urgent">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-urgent">
                      <CheckCircle2 size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("awaitingApproval")}</h3>
                    <span className="oversight-card-count">{data.pendingPayrollApprovals.length}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("awaitingApprovalDesc", { count: data.pendingPayrollApprovals.length })}
                  </p>
                  <ul className="oversight-card-list">
                    {data.pendingPayrollApprovals.map((run) => (
                      <li key={run.id} className="oversight-card-item">
                        <span className="oversight-item-period">{run.payPeriod || t("unknownPeriod")}</span>
                        <StatusBadge tone="pending">{toSentenceCase(run.status)}</StatusBadge>
                        <span className="oversight-item-meta settings-card-description">
                          <span>{t("employees", { count: run.employeeCount })}</span>
                          {run.submittedAt ? (
                            <span className="oversight-inline-meta">{t("submittedAgo", { date: formatRelativeTime(run.submittedAt, locale) })}</span>
                          ) : null}
                        </span>
                        <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-accent button-sm">
                          {t("reviewRun")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

              {data.pendingSalaryApprovals.count > 0 ? (
                <article className="oversight-card oversight-card-attention">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-attention">
                      <Banknote size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("salaryChangesPending")}</h3>
                    <span className="oversight-card-count">{data.pendingSalaryApprovals.count}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("salaryChangesPendingDesc", { count: data.pendingSalaryApprovals.count })}
                  </p>
                  <div className="oversight-card-footer">
                    <Link href="/admin/compensation" className="button button-subtle button-sm">
                      {t("viewSalary")}
                    </Link>
                  </div>
                </article>
              ) : null}

              {data.completionGaps.length > 0 ? (
                <article className="oversight-card oversight-card-warning">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-warning">
                      <CircleDot size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("completionGaps")}</h3>
                    <span className="oversight-card-count">{data.completionGaps.length}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("completionGapsDesc", { count: data.completionGaps.length })}
                  </p>
                  <ul className="oversight-card-list">
                    {data.completionGaps.map((run) => (
                      <li key={run.id} className="oversight-card-item">
                        <span className="oversight-item-period">{run.payPeriod || t("unknownPeriod")}</span>
                        <StatusBadge tone={run.status === "approved" ? "success" : run.status === "processing" ? "processing" : "draft"}>
                          {toSentenceCase(run.status)}
                        </StatusBadge>
                        <span className="oversight-item-meta settings-card-description">
                          {t("stuckSince", { date: formatRelativeTime(run.createdAt, locale) })}
                        </span>
                        <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-subtle button-sm">
                          {t("viewRun")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

              {data.payoutBlockers.length > 0 ? (
                <article className="oversight-card oversight-card-danger">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-danger">
                      <Ban size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("payoutBlockers")}</h3>
                    <span className="oversight-card-count">{data.payoutBlockers.length}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("payoutBlockersDesc", { count: data.payoutBlockers.length })}
                  </p>
                  <ul className="oversight-card-list">
                    {data.payoutBlockers.map((blocker) => (
                      <li key={blocker.runId} className="oversight-card-item">
                        <span className="oversight-item-period">{blocker.payPeriod || t("unknownPeriod")}</span>
                        <StatusBadge tone="error">{t("flaggedCount", { count: blocker.flaggedCount })}</StatusBadge>
                        <span className="oversight-item-meta settings-card-description">
                          {t("flaggedItems", { count: blocker.flaggedCount })}
                        </span>
                        <Link href={`/payroll/runs/${blocker.runId}`} className="oversight-item-action button button-subtle button-sm">
                          {t("viewRun")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

              {data.activeCycles.length > 0 ? (
                <article className="oversight-card">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-info">
                      <Zap size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("activeCycles")}</h3>
                    <span className="oversight-card-count">{data.activeCycles.length}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("activeCyclesDesc", { count: data.activeCycles.length })}
                  </p>
                  <ul className="oversight-card-list">
                    {data.activeCycles.map((cycle) => (
                      <CycleCard key={cycle.cycleId} cycle={cycle} />
                    ))}
                  </ul>
                </article>
              ) : null}

              {data.historicalAwaitingAction.length > 0 ? (
                <article className="oversight-card">
                  <header className="oversight-card-header">
                    <span className="oversight-card-icon oversight-icon-info">
                      <History size={14} />
                    </span>
                    <h3 className="oversight-card-title">{t("historicalAwaitingAction")}</h3>
                    <span className="oversight-card-count">{data.historicalAwaitingAction.length}</span>
                  </header>
                  <p className="oversight-card-description settings-card-description">
                    {t("historicalAwaitingActionDesc", { count: data.historicalAwaitingAction.length })}
                  </p>
                  <ul className="oversight-card-list">
                    {data.historicalAwaitingAction.map((run) => (
                      <li key={run.id} className="oversight-card-item">
                        <span className="oversight-item-period">{run.payPeriod || t("unknownPeriod")}</span>
                        <HistoricalStepBadge step={run.nextStep} />
                        <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-subtle button-sm">
                          {t("viewRun")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
