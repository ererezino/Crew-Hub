"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { labelForPayrollCycleStatus, toneForPayrollCycleStatus } from "../../../../lib/payroll/runs";

type StatusTone = "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing";

type OversightCycleSummary = {
  id: string;
  runId: string;
  label: string | null;
  cycleNumber: number | null;
  status: string;
  totalNet: number;
  currency: string;
  targetPayDate: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  paidAt: string | null;
  employeeCount: number;
  payPeriod: string;
};

type OversightFlaggedRun = {
  runId: string;
  payPeriod: string;
  flaggedCount: number;
};

type OversightHistoricalRun = {
  id: string;
  payPeriod: string;
  nextStep: "review" | "authorize" | "publish";
};

type FinanceOversightResponseData = {
  cyclesAwaitingApproval: OversightCycleSummary[];
  activeCycles: OversightCycleSummary[];
  recentlyPaidCycles: OversightCycleSummary[];
  payoutBlockers: OversightFlaggedRun[];
  historicalAwaitingAction: OversightHistoricalRun[];
};

function useOversightData() {
  const [data, setData] = useState<FinanceOversightResponseData | null>(null);
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

function CycleCard({ cycle }: { cycle: OversightCycleSummary }) {
  const t = useTranslations("dashboard.financeOversight");

  return (
    <Link
      href={`/payroll/runs/${cycle.runId}`}
      className="oversight-cycle-card"
    >
      <div className="oversight-cycle-card-header">
        <span className="oversight-cycle-label">
          {cycle.label ?? t("cycleLabelFallback", { cycle: cycle.cycleNumber ?? "?" })}
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
          <span>{t("cycleEmployees", { count: cycle.employeeCount })}</span>
          {cycle.targetPayDate && (
            <span className="oversight-cycle-pay-date">
              {t("cyclePayDate", { date: cycle.targetPayDate })}
            </span>
          )}
        </div>
        {cycle.submittedByName && (
          <div className="oversight-cycle-actor">
            {t("cycleSubmittedBy", { name: cycle.submittedByName })}
          </div>
        )}
        {cycle.approvedByName && (
          <div className="oversight-cycle-actor">
            {t("cycleApprovedBy", { name: cycle.approvedByName })}
          </div>
        )}
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
    data.cyclesAwaitingApproval.length > 0 ||
    data.activeCycles.length > 0 ||
    data.recentlyPaidCycles.length > 0 ||
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

      {data.cyclesAwaitingApproval.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("awaitingApprovalSectionTitle")}</h2>
          <p className="oversight-section-description">{t("awaitingApprovalSectionDescription")}</p>
          <div className="oversight-cycle-grid">
            {data.cyclesAwaitingApproval.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
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
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </section>
      )}

      {data.payoutBlockers.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("payoutBlockersSectionTitle")}</h2>
          <p className="oversight-section-description">{t("payoutBlockersSectionDescription")}</p>
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

      {data.recentlyPaidCycles.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">{t("recentlyCompletedSectionTitle")}</h2>
          <p className="oversight-section-description">{t("recentlyCompletedSectionDescription")}</p>
          <div className="oversight-cycle-grid">
            {data.recentlyPaidCycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
