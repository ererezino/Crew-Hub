"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { usePayrollRunsDashboard } from "../../../hooks/use-payroll-runs";
import { formatDate, formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  getCurrencyTotal,
  getPrimaryCurrency,
  labelForPayrollCycleStatus,
  labelForPayrollRunStatus,
  toneForPayrollCycleStatus,
  toneForPayrollRunStatus
} from "../../../lib/payroll/runs";

type AppLocale = "en" | "fr";
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

function formatPeriodLabel(start: string, end: string, locale: AppLocale): string {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} - ${end}`;
  }

  return `${formatDate(startDate, locale)} - ${formatDate(endDate, locale)}`;
}

function formatCycleDate(date: string | null, locale: AppLocale): string {
  if (!date) return "—";
  return formatDate(date, locale);
}

export function PayrollDashboardClient({
  canManage,
  createRunHref,
  settingsHref,
  headerActions
}: PayrollDashboardClientProps) {
  const t = useTranslations('payrollDashboard');
  const locale = useLocale() as AppLocale;

  const runsQuery = usePayrollRunsDashboard();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRuns = useMemo(() => {
    const rows = runsQuery.data?.runs ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.payPeriodStart.localeCompare(right.payPeriodStart);
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
        title={t('title')}
        description={t('description')}
        actions={headerActions}
      />

      <FeatureBanner
        moduleId="payroll"
        description={t('pilotBanner')}
      />

      {runsQuery.isLoading ? runsTableSkeleton() : null}

      {!runsQuery.isLoading && runsQuery.errorMessage ? (
        <ErrorState
          title={t('unavailable')}
          message={runsQuery.errorMessage}
          onRetry={() => runsQuery.refresh()}
        />
      ) : null}

      {!runsQuery.isLoading && !runsQuery.errorMessage && runsQuery.data ? (
        <>
          <section className="payroll-metric-grid" aria-label={t('metricsAriaLabel')}>
            <article className="metric-card">
              <p className="metric-label">{t('latestStatus')}</p>
              <p className="metric-value">
                {runsQuery.data.metrics.latestStatus ? (
                  <StatusBadge tone={toneForPayrollRunStatus(runsQuery.data.metrics.latestStatus)}>
                    {labelForPayrollRunStatus(runsQuery.data.metrics.latestStatus)}
                  </StatusBadge>
                ) : (
                  "--"
                )}
              </p>
              <p className="metric-hint">{t('latestStatusHint')}</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('totalCost')}</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={runsQuery.data.metrics.latestTotalCostAmount}
                  currency={dashboardCurrency}
                />
              </p>
              <p className="metric-hint">{t('totalCostHint')}</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('contractors')}</p>
              <p className="metric-value numeric">
                {runsQuery.data.metrics.eligibleEmployeeCount}
              </p>
              <p className="metric-hint">{t('contractorsHint')}</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('nextPayDate')}</p>
              <p className="metric-value">
                {runsQuery.data.metrics.nextPayDate ? (
                  <time
                    className="numeric"
                    dateTime={runsQuery.data.metrics.nextPayDate}
                    title={formatDateTimeTooltip(runsQuery.data.metrics.nextPayDate, locale)}
                  >
                    {formatRelativeTime(`${runsQuery.data.metrics.nextPayDate}T00:00:00.000Z`, locale)}
                  </time>
                ) : (
                  "--"
                )}
              </p>
              <p className="metric-hint">{t('nextPayDateHint')}</p>
            </article>
          </section>

          {sortedRuns.length === 0 ? (
            <EmptyState
              title={t('noRuns')}
              description={t('noRunsDescription')}
              ctaLabel={canManage ? t('createRun') : t('openWithholding')}
              ctaHref={canManage ? createRunHref : settingsHref}
            />
          ) : (
            <section className="data-table-container" aria-label={t('tableAriaLabel')}>
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
                        {t('colPeriod')}
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>{t('colCycles')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colEmployees')}</th>
                    <th>{t('colGross')}</th>
                    <th>{t('colInitiator')}</th>
                    <th className="table-action-column">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map((run) => (
                    <tr key={run.id} className="data-table-row">
                      <td>
                        <p>{formatPeriodLabel(run.payPeriodStart, run.payPeriodEnd, locale)}</p>
                        <p className="settings-card-description">
                          {t('cycleSchedule', {
                            cycle1: formatCycleDate(run.cycle1Date, locale),
                            cycle2: formatCycleDate(run.cycle2Date, locale)
                          })}
                        </p>
                      </td>
                      <td>
                        <p className="settings-card-description">{t('cycle1Label')}</p>
                        <p>
                          <time
                            dateTime={run.cycle1Date ?? ""}
                            title={run.cycle1Date ? formatDateTimeTooltip(run.cycle1Date, locale) : undefined}
                          >
                            {formatCycleDate(run.cycle1Date, locale)}
                          </time>
                        </p>
                        {run.cycle1Status ? (
                          <StatusBadge tone={toneForPayrollCycleStatus(run.cycle1Status)}>
                            {labelForPayrollCycleStatus(run.cycle1Status)}
                          </StatusBadge>
                        ) : null}
                        <p className="settings-card-description">{t('cycle2Label')}</p>
                        <p>
                          <time
                            dateTime={run.cycle2Date ?? ""}
                            title={run.cycle2Date ? formatDateTimeTooltip(run.cycle2Date, locale) : undefined}
                          >
                            {formatCycleDate(run.cycle2Date, locale)}
                          </time>
                        </p>
                        {run.cycle2Status ? (
                          <StatusBadge tone={toneForPayrollCycleStatus(run.cycle2Status)}>
                            {labelForPayrollCycleStatus(run.cycle2Status)}
                          </StatusBadge>
                        ) : null}
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
                            {t('openRun')}
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
