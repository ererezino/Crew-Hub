"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useExpenseReports } from "../../../../hooks/use-expenses";
import { currentMonthKey, formatMonthLabel } from "../../../../lib/expenses";
import type { ExpenseReportBucket } from "../../../../types/expenses";

function ReportsSkeleton() {
  return (
    <section className="expenses-reports-skeleton" aria-hidden="true">
      <div className="expenses-metric-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`expenses-reports-metric-skeleton-${index}`} className="expenses-metric-skeleton-card" />
        ))}
      </div>
      <div className="expenses-report-chart-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`expenses-reports-chart-skeleton-${index}`} className="expenses-report-chart-skeleton" />
        ))}
      </div>
    </section>
  );
}

function ExpenseReportBars({
  title,
  rows
}: {
  title: string;
  rows: ExpenseReportBucket[];
}) {
  const maxAmount = useMemo(
    () => rows.reduce((currentMax, row) => Math.max(currentMax, row.totalAmount), 0),
    [rows]
  );

  return (
    <article className="settings-card expenses-report-card">
      <header className="expenses-report-card-header">
        <h2 className="section-title">{title}</h2>
      </header>

      {rows.length === 0 ? (
        <p className="settings-card-description">No data for this period.</p>
      ) : (
        <ul className="expenses-report-bars" aria-label={title}>
          {rows.map((row) => {
            const widthPercentage =
              maxAmount > 0 ? Math.max(4, Math.round((row.totalAmount / maxAmount) * 100)) : 4;

            return (
              <li key={row.key} className="expenses-report-row">
                <div className="expenses-report-row-copy">
                  <p className="expenses-report-row-title">{row.label}</p>
                  <p className="expenses-report-row-meta">
                    <CurrencyDisplay amount={row.totalAmount} currency="USD" /> |{" "}
                    <span className="numeric">{row.count}</span> items
                  </p>
                </div>
                <div className="expenses-report-row-bar-track" role="presentation">
                  <div
                    className="expenses-report-row-bar-fill"
                    style={{ width: `${widthPercentage}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

export function ExpenseReportsClient() {
  const [month, setMonth] = useState(currentMonthKey());
  const reportsQuery = useExpenseReports({ month });

  const handleCsvExport = () => {
    const targetUrl = `/api/v1/expenses/reports?month=${encodeURIComponent(month)}&format=csv`;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <PageHeader
        title="Expense Reports"
        description="Monthly reporting by category, employee, and department with CSV export."
        actions={
          <button type="button" className="button button-accent" onClick={handleCsvExport}>
            Export CSV
          </button>
        }
      />

      <section className="expenses-toolbar" aria-label="Report filters">
        <label className="form-field">
          <span className="form-label">Month</span>
          <input
            className="form-input numeric"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
          />
        </label>
        <p className="settings-card-description">Showing {formatMonthLabel(month)} expense data.</p>
      </section>

      {reportsQuery.isLoading ? <ReportsSkeleton /> : null}

      {!reportsQuery.isLoading && reportsQuery.errorMessage ? (
        <section className="expenses-error-state">
          <EmptyState
            title="Expense reports are unavailable"
            description={reportsQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/expenses/reports"
          />
          <button type="button" className="button button-accent" onClick={() => reportsQuery.refresh()}>
            Retry
          </button>
        </section>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.errorMessage && reportsQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label="Expense report summary">
            <article className="metric-card">
              <p className="metric-label">Total Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.totalAmount} currency="USD" />
              </p>
              <p className="metric-hint">Month total submitted expenses</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Expense Count</p>
              <p className="metric-value numeric">{reportsQuery.data.totals.expenseCount}</p>
              <p className="metric-hint">Number of expense submissions</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Pending Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.pendingAmount} currency="USD" />
              </p>
              <p className="metric-hint">Still awaiting approval or reimbursement</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Reimbursed Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.reimbursedAmount} currency="USD" />
              </p>
              <p className="metric-hint">Marked as reimbursed this month</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Avg Manager Approval Time</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgSubmissionToManagerApprovalHours === null
                  ? "--"
                  : `${reportsQuery.data.timings.avgSubmissionToManagerApprovalHours.toFixed(2)}h`}
              </p>
              <p className="metric-hint">From submission to manager approval</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Avg Disbursement Time</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgManagerApprovalToDisbursementHours === null
                  ? "--"
                  : `${reportsQuery.data.timings.avgManagerApprovalToDisbursementHours.toFixed(2)}h`}
              </p>
              <p className="metric-hint">From manager approval to disbursement</p>
            </article>
          </section>

          {reportsQuery.data.totals.expenseCount === 0 ? (
            <EmptyState
              title="No report data for this month"
              description="Submitted expenses will appear in these reports once records exist for the selected month."
              ctaLabel="Open expenses"
              ctaHref="/expenses"
            />
          ) : (
            <section className="expenses-report-layout">
              <article className="settings-card expenses-report-card">
                <header className="expenses-report-card-header">
                  <h2 className="section-title">By Status</h2>
                </header>
                {reportsQuery.data.statusBreakdown.length === 0 ? (
                  <p className="settings-card-description">No status data for this period.</p>
                ) : (
                  <ul className="expenses-report-bars" aria-label="Expense status breakdown">
                    {reportsQuery.data.statusBreakdown.map((row) => (
                      <li key={row.status} className="expenses-report-row">
                        <div className="expenses-report-row-copy">
                          <p className="expenses-report-row-title">{row.label}</p>
                          <p className="expenses-report-row-meta">
                            <CurrencyDisplay amount={row.totalAmount} currency="USD" /> |{" "}
                            <span className="numeric">{row.count}</span> items
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <ExpenseReportBars title="By Category" rows={reportsQuery.data.byCategory} />
              <ExpenseReportBars title="By Employee" rows={reportsQuery.data.byEmployee} />
              <ExpenseReportBars title="By Department" rows={reportsQuery.data.byDepartment} />
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
