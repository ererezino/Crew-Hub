"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
    <section className="oversight-skeleton" aria-hidden="true">
      <div className="oversight-section-skeleton">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={`skeleton-card-${i}`} className="oversight-card-skeleton" />
        ))}
      </div>
    </section>
  );
}

function safeCycleTone(status: string): StatusTone {
  const tone = toneForPayrollCycleStatus(status);
  const validTones: StatusTone[] = ["success", "warning", "error", "info", "pending", "draft", "processing"];
  return validTones.includes(tone as StatusTone) ? (tone as StatusTone) : "pending";
}

function CycleCard({ cycle }: { cycle: OversightActiveCycle }) {
  const t = useTranslations("dashboard.financeOversight");

  return (
    <Link
      href={`/payroll/runs/${cycle.runId}`}
      className="oversight-cycle-card"
    >
      <div className="oversight-cycle-card-header">
        <span className="oversight-cycle-label">
          {cycle.label ?? t("unknownPeriod")}
        </span>
        <StatusBadge tone={safeCycleTone(cycle.status)}>
          {labelForPayrollCycleStatus(cycle.status)}
        </StatusBadge>
      </div>
      <div className="oversight-cycle-card-body">
        <div className="oversight-cycle-amount">
          <CurrencyDisplay amount={cycle.totalNet} currency={cycle.currency} />
        </div>
        <div className="oversight-cycle-meta">
          <span>{cycle.payPeriod || t("unknownPeriod")}</span>
        </div>
      </div>
    </Link>
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
    authorize: "warning",
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
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <OversightSkeleton />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <ErrorState message={error ?? t("loadFailed")} />
      </>
    );
  }

  const hasAnything =
    data.pendingPayrollApprovals.length > 0 ||
    data.pendingSalaryApprovals.count > 0 ||
    data.activeCycles.length > 0 ||
    data.completionGaps.length > 0 ||
    data.payoutBlockers.length > 0 ||
    data.historicalAwaitingAction.length > 0;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      {!hasAnything && (
        <EmptyState
          title={t("allClearTitle")}
          description={t("allClearDescription")}
        />
      )}

      {data.pendingPayrollApprovals.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("awaitingApprovalSectionTitle")}</h2>
          <p className="oversight-section-description">{t("awaitingApprovalSectionDescription")}</p>
          <div className="oversight-historical-list">
            {data.pendingPayrollApprovals.map((run) => (
              <Link
                key={run.id}
                href={`/payroll/runs/${run.id}`}
                className="oversight-historical-card"
              >
                <span className="oversight-historical-period">{run.payPeriod || t("unknownPeriod")}</span>
                <StatusBadge tone="pending">{toSentenceCase(run.status)}</StatusBadge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.pendingSalaryApprovals.count > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("salaryChangesPending")}</h2>
          <p className="oversight-section-description">
            {t("salaryChangesPendingDesc", { count: data.pendingSalaryApprovals.count })}
          </p>
          <div className="oversight-historical-list">
            <Link href="/admin/compensation" className="oversight-historical-card">
              <span className="oversight-historical-period">{t("viewSalary")}</span>
              <StatusBadge tone="warning">{data.pendingSalaryApprovals.count}</StatusBadge>
            </Link>
          </div>
        </section>
      )}

      {data.completionGaps.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("completionGaps")}</h2>
          <p className="oversight-section-description">
            {t("completionGapsDesc", { count: data.completionGaps.length })}
          </p>
          <div className="oversight-historical-list">
            {data.completionGaps.map((run) => (
              <Link
                key={run.id}
                href={`/payroll/runs/${run.id}`}
                className="oversight-historical-card"
              >
                <span className="oversight-historical-period">{run.payPeriod || t("unknownPeriod")}</span>
                <StatusBadge tone={run.status === "approved" ? "success" : run.status === "processing" ? "processing" : "draft"}>
                  {toSentenceCase(run.status)}
                </StatusBadge>
                <span className="oversight-blocker-label">{t("stuckSince", { date: formatRelativeTime(run.createdAt, locale) })}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.activeCycles.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("activeCyclesSectionTitle")}</h2>
          <p className="oversight-section-description">{t("activeCyclesSectionDescription")}</p>
          <div className="oversight-cycle-grid">
            {data.activeCycles.map((cycle) => (
              <CycleCard key={cycle.cycleId} cycle={cycle} />
            ))}
          </div>
        </section>
      )}

      {data.payoutBlockers.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("payoutBlockersSectionTitle")}</h2>
          <p className="oversight-section-description">
            {t("payoutBlockersDesc", { count: data.payoutBlockers.length })}
          </p>
          <div className="oversight-blocker-list">
            {data.payoutBlockers.map((blocker) => (
              <Link
                key={blocker.runId}
                href={`/payroll/runs/${blocker.runId}`}
                className="oversight-blocker-card"
              >
                <StatusBadge tone="error">
                  {t("flaggedCount", { count: blocker.flaggedCount })}
                </StatusBadge>
                <span className="oversight-blocker-label">{t("viewRun")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.historicalAwaitingAction.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("historicalRunsSectionTitle")}</h2>
          <p className="oversight-section-description">{t("historicalRunsSectionDescription")}</p>
          <div className="oversight-historical-list">
            {data.historicalAwaitingAction.map((run) => (
              <Link
                key={run.id}
                href={`/payroll/runs/${run.id}`}
                className="oversight-historical-card"
              >
                <span className="oversight-historical-period">{run.payPeriod || t("unknownPeriod")}</span>
                <HistoricalStepBadge step={run.nextStep} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
