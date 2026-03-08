"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useExpenseReports } from "../../../../hooks/use-expenses";
import {
  currentMonthKey,
  formatMonthLabel,
  getExpenseCategoryLabel,
  getExpenseStatusLabel
} from "../../../../lib/expenses";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type EnhancedCategoryBucket,
  type EnhancedDepartmentBucket,
  type EnhancedEmployeeBucket,
  type ExpenseReportBucket,
  type ExpenseReportStatusBucket
} from "../../../../types/expenses";

type BreakdownTab = "employee" | "category" | "department";

function ReportsSkeleton() {
  return (
    <section className="expenses-reports-skeleton" aria-hidden="true">
      <div className="expenses-metric-skeleton-grid">
        {Array.from({ length: 5 }, (_, index) => (
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
                    <CurrencyDisplay amount={row.totalAmount} currency="NGN" /> |{" "}
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

function EmployeeTable({ rows }: { rows: EnhancedEmployeeBucket[] }) {
  if (rows.length === 0) {
    return <p className="settings-card-description">No employee data for this period.</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th className="numeric">Count</th>
            <th className="numeric">Total Amount</th>
            <th className="numeric">Avg Processing</th>
            <th>Status Distribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.department ?? "-"}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency="NGN" />
              </td>
              <td className="numeric">
                {row.avgProcessingHours !== null
                  ? `${(row.avgProcessingHours / 24).toFixed(1)}d`
                  : "-"}
              </td>
              <td>
                <span className="expenses-status-pills">
                  {Object.entries(row.statusCounts).map(([status, count]) => (
                    <span key={status} className="expenses-status-pill">
                      {getExpenseStatusLabel(status as never)}: {count}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryTable({ rows }: { rows: EnhancedCategoryBucket[] }) {
  if (rows.length === 0) {
    return <p className="settings-card-description">No category data for this period.</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="numeric">Count</th>
            <th className="numeric">Total Amount</th>
            <th className="numeric">% of Total</th>
            <th>Most Common Vendor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency="NGN" />
              </td>
              <td className="numeric">{row.pctOfTotal}%</td>
              <td>{row.mostCommonVendor ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentTable({ rows }: { rows: EnhancedDepartmentBucket[] }) {
  if (rows.length === 0) {
    return <p className="settings-card-description">No department data for this period.</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>Department</th>
            <th className="numeric">Count</th>
            <th className="numeric">Total Amount</th>
            <th className="numeric">Employees</th>
            <th>Top Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency="NGN" />
              </td>
              <td className="numeric">{row.uniqueEmployees}</td>
              <td>{row.topCategory ? getExpenseCategoryLabel(row.topCategory as never) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExpenseReportsClient() {
  const [month, setMonth] = useState(currentMonthKey());
  const [country, setCountry] = useState("all");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [activeTab, setActiveTab] = useState<BreakdownTab>("employee");

  const reportsQuery = useExpenseReports({ month, country, department, status, category });

  const uniqueDepartments = useMemo(() => {
    if (!reportsQuery.data) return [];
    const depts = new Set<string>();
    for (const row of reportsQuery.data.enhancedByEmployee) {
      if (row.department) depts.add(row.department);
    }
    for (const row of reportsQuery.data.byDepartment) {
      if (row.label && row.label !== "") depts.add(row.label);
    }
    return [...depts].sort();
  }, [reportsQuery.data]);

  const handleCsvExport = () => {
    const params = new URLSearchParams();
    params.set("month", month);
    params.set("format", "csv");
    if (country !== "all") params.set("country", country);
    if (department !== "all") params.set("department", department);
    if (status !== "all") params.set("status", status);
    if (category !== "all") params.set("category", category);
    const targetUrl = `/api/v1/expenses/reports?${params.toString()}`;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <PageHeader
        title="Expense Reports"
        description="Monthly reporting by category, crew member, and department with CSV export."
        actions={
          <button type="button" className="button button-accent" onClick={handleCsvExport}>
            Export CSV
          </button>
        }
      />

      <section className="expenses-toolbar expenses-reports-filters" aria-label="Report filters">
        <label className="form-field">
          <span className="form-label">Month</span>
          <input
            className="form-input numeric"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
          />
        </label>

        <label className="form-field">
          <span className="form-label">Country</span>
          <select
            className="form-input analytics-filter-select"
            value={country}
            onChange={(event) => setCountry(event.currentTarget.value)}
          >
            <option value="all">All countries</option>
            <option value="US">United States</option>
            <option value="GB">United Kingdom</option>
            <option value="DE">Germany</option>
            <option value="NG">Nigeria</option>
            <option value="KE">Kenya</option>
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">Department</span>
          <select
            className="form-input analytics-filter-select"
            value={department}
            onChange={(event) => setDepartment(event.currentTarget.value)}
          >
            <option value="all">All departments</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">Status</span>
          <select
            className="form-input analytics-filter-select"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value)}
          >
            <option value="all">All statuses</option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {getExpenseStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">Category</span>
          <select
            className="form-input analytics-filter-select"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {getExpenseCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-card-description">Showing {formatMonthLabel(month)} expense data.</p>
      </section>

      {reportsQuery.isLoading ? <ReportsSkeleton /> : null}

      {!reportsQuery.isLoading && reportsQuery.errorMessage ? (
        <>
          <EmptyState
            title="Expense reports are unavailable"
            description={reportsQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/expenses/reports"
          />
          <button type="button" className="button button-accent" onClick={() => reportsQuery.refresh()}>
            Retry
          </button>
        </>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.errorMessage && reportsQuery.data ? (
        <>
          {/* ── Summary cards ── */}
          <section className="expenses-metric-grid" aria-label="Expense report summary">
            <article className="metric-card">
              <p className="metric-label">Total Submitted</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.totalAmount} currency="NGN" />
              </p>
              <p className="metric-hint">
                <span className="numeric">{reportsQuery.data.totals.expenseCount}</span> expenses
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Manager Approved</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.managerApprovedAmount} currency="NGN" />
              </p>
              <p className="metric-hint">Awaiting finance review</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Finance Approved</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.financeApprovedAmount} currency="NGN" />
              </p>
              <p className="metric-hint">Approved for reimbursement</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Reimbursed</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.reimbursedAmount} currency="NGN" />
              </p>
              <p className="metric-hint">Paid out this month</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Pending Reimbursement</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.pendingAmount} currency="NGN" />
              </p>
              <p className="metric-hint">Still owed to crew members</p>
            </article>
          </section>

          {/* ── Timing metrics ── */}
          <section className="expenses-metric-grid expenses-timing-row" aria-label="Processing times">
            <article className="metric-card">
              <p className="metric-label">Avg Manager Approval</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgSubmissionToManagerApprovalHours === null
                  ? "-"
                  : `${reportsQuery.data.timings.avgSubmissionToManagerApprovalHours.toFixed(1)}h`}
              </p>
              <p className="metric-hint">From submission to manager approval</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Avg Disbursement</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgManagerApprovalToDisbursementHours === null
                  ? "-"
                  : `${reportsQuery.data.timings.avgManagerApprovalToDisbursementHours.toFixed(1)}h`}
              </p>
              <p className="metric-hint">From manager approval to reimbursement</p>
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
            <>
              {/* ── Status breakdown + bar charts ── */}
              <section className="expenses-report-layout">
                <article className="settings-card expenses-report-card">
                  <header className="expenses-report-card-header">
                    <h2 className="section-title">By Status</h2>
                  </header>
                  {reportsQuery.data.statusBreakdown.length === 0 ? (
                    <p className="settings-card-description">No status data for this period.</p>
                  ) : (
                    <ul className="expenses-report-bars" aria-label="Expense status breakdown">
                      {reportsQuery.data.statusBreakdown.map((row: ExpenseReportStatusBucket) => (
                        <li key={row.status} className="expenses-report-row">
                          <div className="expenses-report-row-copy">
                            <p className="expenses-report-row-title">{row.label}</p>
                            <p className="expenses-report-row-meta">
                              <CurrencyDisplay amount={row.totalAmount} currency="NGN" /> |{" "}
                              <span className="numeric">{row.count}</span> items
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
                <ExpenseReportBars title="By Category" rows={reportsQuery.data.byCategory} />
              </section>

              {/* ── Tabbed breakdown sections ── */}
              <section className="settings-card expenses-report-breakdown" aria-label="Detailed breakdowns">
                <header className="expenses-report-card-header">
                  <h2 className="section-title">Detailed Breakdowns</h2>
                </header>

                <section className="page-tabs" aria-label="Breakdown tabs">
                  <button
                    type="button"
                    className={activeTab === "employee" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("employee")}
                  >
                    By Employee
                  </button>
                  <button
                    type="button"
                    className={activeTab === "category" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("category")}
                  >
                    By Category
                  </button>
                  <button
                    type="button"
                    className={activeTab === "department" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("department")}
                  >
                    By Department
                  </button>
                </section>

                <div className="expenses-report-tab-panel">
                  {activeTab === "employee" && (
                    <EmployeeTable rows={reportsQuery.data.enhancedByEmployee} />
                  )}
                  {activeTab === "category" && (
                    <CategoryTable rows={reportsQuery.data.enhancedByCategory} />
                  )}
                  {activeTab === "department" && (
                    <DepartmentTable rows={reportsQuery.data.enhancedByDepartment} />
                  )}
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
    </>
  );
}
