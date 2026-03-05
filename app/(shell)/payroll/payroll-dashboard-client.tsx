"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { usePayrollRunsDashboard } from "../../../hooks/use-payroll-runs";
import { formatDate, formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  getCurrencyTotal,
  getPrimaryCurrency,
  labelForPayrollRunStatus,
  toneForPayrollRunStatus
} from "../../../lib/payroll/runs";

type SortDirection = "asc" | "desc";

type PayrollDashboardClientProps = {
  canManage: boolean;
  createRunHref: string;
  settingsHref: string;
  headerActions?: ReactNode;
};

function runsTableSkeleton() {
  return (
    <section className="payroll-dashboard-skeleton" aria-hidden="true">
      <div className="payroll-metric-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`payroll-metric-skeleton-${index}`} className="payroll-metric-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`payroll-table-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

function formatPeriodLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} to ${end}`;
  }

  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

export function PayrollDashboardClient({
  canManage,
  createRunHref,
  settingsHref,
  headerActions
}: PayrollDashboardClientProps) {
  const runsQuery = usePayrollRunsDashboard();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRuns = useMemo(() => {
    const rows = runsQuery.data?.runs ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.payDate.localeCompare(right.payDate);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [runsQuery.data?.runs, sortDirection]);

  /** Derive the primary currency from the most recent run's totals. */
  const dashboardCurrency = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    if (runs.length === 0) return "NGN";
    return getPrimaryCurrency(runs[0].totalGross);
  }, [runsQuery.data?.runs]);

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Run payroll safely with staged approvals, item-level checks, and clear payout status."
        actions={headerActions}
      />

      {runsQuery.isLoading ? runsTableSkeleton() : null}

      {!runsQuery.isLoading && runsQuery.errorMessage ? (
        <ErrorState
          title="Payroll runs are unavailable"
          message={runsQuery.errorMessage}
          onRetry={() => runsQuery.refresh()}
        />
      ) : null}

      {!runsQuery.isLoading && !runsQuery.errorMessage && runsQuery.data ? (
        <>
          <section className="payroll-metric-grid" aria-label="Payroll run metrics">
            <article className="metric-card">
              <p className="metric-label">Latest Status</p>
              <p className="metric-value">
                {runsQuery.data.metrics.latestStatus ? (
                  <StatusBadge tone={toneForPayrollRunStatus(runsQuery.data.metrics.latestStatus)}>
                    {labelForPayrollRunStatus(runsQuery.data.metrics.latestStatus)}
                  </StatusBadge>
                ) : (
                  "--"
                )}
              </p>
              <p className="metric-hint">Most recent payroll run state</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Total Cost</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={runsQuery.data.metrics.latestTotalCostAmount}
                  currency={dashboardCurrency}
                />
              </p>
              <p className="metric-hint">Latest run net total</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Contractors</p>
              <p className="metric-value numeric">
                {runsQuery.data.metrics.activeContractorCount}
              </p>
              <p className="metric-hint">Active contractors eligible for payroll</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Next Pay Date</p>
              <p className="metric-value">
                {runsQuery.data.metrics.nextPayDate ? (
                  <time
                    className="numeric"
                    dateTime={runsQuery.data.metrics.nextPayDate}
                    title={formatDateTimeTooltip(runsQuery.data.metrics.nextPayDate)}
                  >
                    {formatRelativeTime(`${runsQuery.data.metrics.nextPayDate}T00:00:00.000Z`)}
                  </time>
                ) : (
                  "--"
                )}
              </p>
              <p className="metric-hint">Upcoming run date</p>
            </article>
          </section>

          {sortedRuns.length === 0 ? (
            <EmptyState
              title="No payroll runs yet"
              description="Create a payroll run to calculate contractor payouts. Net pay equals gross pay while withholding is disabled."
              ctaLabel={canManage ? "Create payroll run" : "Open withholding settings"}
              ctaHref={canManage ? createRunHref : settingsHref}
            />
          ) : (
            <section className="data-table-container" aria-label="Payroll runs table">
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
                        Period
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Employees</th>
                    <th>Gross</th>
                    <th>Initiator</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map((run) => (
                    <tr key={run.id} className="data-table-row">
                      <td>
                        <p>{formatPeriodLabel(run.payPeriodStart, run.payPeriodEnd)}</p>
                        <p className="settings-card-description">
                          Pay date{" "}
                          <time dateTime={run.payDate} title={formatDateTimeTooltip(run.payDate)}>
                            {formatDate(run.payDate)}
                          </time>
                        </p>
                      </td>
                      <td>
                        <StatusBadge tone={toneForPayrollRunStatus(run.status)}>
                          {labelForPayrollRunStatus(run.status)}
                        </StatusBadge>
                      </td>
                      <td className="numeric">{run.employeeCount}</td>
                      <td>
                        <CurrencyDisplay
                          amount={getCurrencyTotal(run.totalGross, getPrimaryCurrency(run.totalGross))}
                          currency={getPrimaryCurrency(run.totalGross)}
                        />
                      </td>
                      <td>{run.initiatedByName ?? "--"}</td>
                      <td className="table-row-action-cell">
                        <div className="payroll-row-actions">
                          <Link className="table-row-action" href={`/payroll/runs/${run.id}`}>
                            Open run
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
