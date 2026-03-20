"use client";

import Link from "next/link";
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
  return (
    <Link
      href={`/payroll/runs/${cycle.runId}`}
      className="oversight-cycle-card"
    >
      <div className="oversight-cycle-card-header">
        <span className="oversight-cycle-label">{cycle.label ?? `Cycle ${cycle.cycleNumber ?? "?"}`}</span>
        <StatusBadge tone={safeCycleTone(cycle.status)}>
          {labelForPayrollCycleStatus(cycle.status)}
        </StatusBadge>
      </div>
      <div className="oversight-cycle-card-body">
        <div className="oversight-cycle-amount">
          <CurrencyDisplay amount={cycle.totalNet} currency={cycle.currency} />
        </div>
        <div className="oversight-cycle-meta">
          <span>{cycle.employeeCount} employee{cycle.employeeCount !== 1 ? "s" : ""}</span>
          {cycle.targetPayDate && (
            <span className="oversight-cycle-pay-date">Pay: {cycle.targetPayDate}</span>
          )}
        </div>
        {cycle.submittedByName && (
          <div className="oversight-cycle-actor">Submitted by {cycle.submittedByName}</div>
        )}
        {cycle.approvedByName && (
          <div className="oversight-cycle-actor">Approved by {cycle.approvedByName}</div>
        )}
      </div>
    </Link>
  );
}

function HistoricalStepBadge({ step }: { step: "review" | "authorize" | "publish" }) {
  const labels: Record<string, string> = {
    review: "Needs review",
    authorize: "Needs authorization",
    publish: "Ready to publish"
  };
  const tones: Record<string, StatusTone> = {
    review: "warning",
    authorize: "warning",
    publish: "info"
  };

  return <StatusBadge tone={tones[step] ?? "pending"}>{labels[step] ?? step}</StatusBadge>;
}

export function OversightClient() {
  const { data, error, loading } = useOversightData();

  if (loading) {
    return (
      <>
        <PageHeader
          title="Finance oversight"
          description="Cycles awaiting approval, payout blockers, and audit status"
        />
        <OversightSkeleton />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title="Finance oversight"
          description="Cycles awaiting approval, payout blockers, and audit status"
        />
        <ErrorState message={error ?? "Unable to load oversight data."} />
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
        title="Finance oversight"
        description="Cycles awaiting approval, payout blockers, and audit status"
      />

      {!hasAnything && (
        <EmptyState
          title="All clear"
          description="No cycles need attention right now."
        />
      )}

      {/* Cycles awaiting approval — the primary action surface */}
      {data.cyclesAwaitingApproval.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">Awaiting approval</h2>
          <p className="oversight-section-description">
            These cycles have been submitted and need FINANCE_APPROVER or SUPER_ADMIN review.
          </p>
          <div className="oversight-cycle-grid">
            {data.cyclesAwaitingApproval.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </section>
      )}

      {/* Active cycles — approved/ready/processing */}
      {data.activeCycles.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">Active cycles</h2>
          <p className="oversight-section-description">
            Approved or in-progress cycles awaiting payment completion.
          </p>
          <div className="oversight-cycle-grid">
            {data.activeCycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </section>
      )}

      {/* Payout blockers */}
      {data.payoutBlockers.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">Payout blockers</h2>
          <p className="oversight-section-description">
            Runs with flagged items that need resolution before payment.
          </p>
          <div className="oversight-blocker-list">
            {data.payoutBlockers.map((blocker) => (
              <Link
                key={blocker.runId}
                href={`/payroll/runs/${blocker.runId}`}
                className="oversight-blocker-card"
              >
                <StatusBadge tone="error">{blocker.flaggedCount} flagged</StatusBadge>
                <span className="oversight-blocker-label">View run</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Historical runs needing action */}
      {data.historicalAwaitingAction.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">Historical runs</h2>
          <p className="oversight-section-description">
            Imported historical runs that need review, authorization, or publication.
          </p>
          <div className="oversight-historical-list">
            {data.historicalAwaitingAction.map((run) => (
              <Link
                key={run.id}
                href={`/payroll/runs/${run.id}`}
                className="oversight-historical-card"
              >
                <span className="oversight-historical-period">{run.payPeriod || "Unknown period"}</span>
                <HistoricalStepBadge step={run.nextStep} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently paid — audit trail */}
      {data.recentlyPaidCycles.length > 0 && (
        <section className="oversight-section">
          <h2 className="oversight-section-title">Recently completed</h2>
          <p className="oversight-section-description">
            Last 10 paid cycles for audit reference.
          </p>
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
