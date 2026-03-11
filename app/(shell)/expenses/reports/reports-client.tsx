"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getCountryOptions } from "../../../../lib/countries";
import type { AppLocale } from "../../../../i18n/locales";
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
  rows,
  currency,
  noDataLabel,
  itemsLabel
}: {
  title: string;
  rows: ExpenseReportBucket[];
  currency: string;
  noDataLabel: string;
  itemsLabel: string;
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
        <p className="settings-card-description">{noDataLabel}</p>
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
                    <CurrencyDisplay amount={row.totalAmount} currency={currency} /> |{" "}
                    <span className="numeric">{row.count}</span> {itemsLabel}
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

function EmployeeTable({
  rows,
  currency,
  t
}: {
  rows: EnhancedEmployeeBucket[];
  currency: string;
  t: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="settings-card-description">{t("noEmployeeData")}</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("colEmployee")}</th>
            <th>{t("colDepartment")}</th>
            <th className="numeric">{t("colCount")}</th>
            <th className="numeric">{t("colTotalAmount")}</th>
            <th className="numeric">{t("colAvgProcessing")}</th>
            <th>{t("colStatusDistribution")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.department ?? "-"}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency={currency} />
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

function CategoryTable({
  rows,
  currency,
  t
}: {
  rows: EnhancedCategoryBucket[];
  currency: string;
  t: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="settings-card-description">{t("noCategoryData")}</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("colCategory")}</th>
            <th className="numeric">{t("colCount")}</th>
            <th className="numeric">{t("colTotalAmount")}</th>
            <th className="numeric">{t("colPctTotal")}</th>
            <th>{t("colMostCommonVendor")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency={currency} />
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

function DepartmentTable({
  rows,
  currency,
  t
}: {
  rows: EnhancedDepartmentBucket[];
  currency: string;
  t: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="settings-card-description">{t("noDepartmentData")}</p>;
  }

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("colDepartment")}</th>
            <th className="numeric">{t("colCount")}</th>
            <th className="numeric">{t("colTotalAmount")}</th>
            <th className="numeric">{t("colEmployees")}</th>
            <th>{t("colTopCategory")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="numeric">{row.count}</td>
              <td className="numeric">
                <CurrencyDisplay amount={row.totalAmount} currency={currency} />
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
  const t = useTranslations("expenseReports");
  const locale = useLocale() as AppLocale;
  const tCommon = useTranslations("common");
  // Dynamic key lookup for sub-component table headers
  const td = t as (key: string, params?: Record<string, unknown>) => string;

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
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" className="button button-accent" onClick={handleCsvExport}>
            {t("exportCsv")}
          </button>
        }
      />

      <section className="expenses-toolbar expenses-reports-filters" aria-label={t("title")}>
        <label className="form-field">
          <span className="form-label">{t("filterMonth")}</span>
          <input
            className="form-input numeric"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
          />
        </label>

        <label className="form-field">
          <span className="form-label">{t("filterCountry")}</span>
          <select
            className="form-input analytics-filter-select"
            value={country}
            onChange={(event) => setCountry(event.currentTarget.value)}
          >
            <option value="all">{t("allCountries")}</option>
            {getCountryOptions(locale).map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.name}</option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">{t("filterDepartment")}</span>
          <select
            className="form-input analytics-filter-select"
            value={department}
            onChange={(event) => setDepartment(event.currentTarget.value)}
          >
            <option value="all">{t("allDepartments")}</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">{t("filterStatus")}</span>
          <select
            className="form-input analytics-filter-select"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value)}
          >
            <option value="all">{t("allStatuses")}</option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {getExpenseStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-label">{t("filterCategory")}</span>
          <select
            className="form-input analytics-filter-select"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
          >
            <option value="all">{t("allCategories")}</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {getExpenseCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-card-description">{t("showingMonth", { month: formatMonthLabel(month) })}</p>
      </section>

      {reportsQuery.isLoading ? <ReportsSkeleton /> : null}

      {!reportsQuery.isLoading && reportsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t("unavailable")}
            description={reportsQuery.errorMessage}
            ctaLabel={tCommon("retry")}
            ctaHref="/expenses/reports"
          />
          <button type="button" className="button button-accent" onClick={() => reportsQuery.refresh()}>
            {tCommon("retry")}
          </button>
        </>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.errorMessage && reportsQuery.data ? (
        <>
          {/* ── Summary cards ── */}
          <section className="expenses-metric-grid" aria-label={t("summaryAriaLabel")}>
            <article className="metric-card">
              <p className="metric-label">{t("totalSubmitted")}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.totalAmount} currency={reportsQuery.data.primaryCurrency} />
              </p>
              <p className="metric-hint">
                <span className="numeric">{reportsQuery.data.totals.expenseCount}</span> {t("expenses")}
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("managerApproved")}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.managerApprovedAmount} currency={reportsQuery.data.primaryCurrency} />
              </p>
              <p className="metric-hint">{t("managerApprovedHint")}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("financeApproved")}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.financeApprovedAmount} currency={reportsQuery.data.primaryCurrency} />
              </p>
              <p className="metric-hint">{t("financeApprovedHint")}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("reimbursed")}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.reimbursedAmount} currency={reportsQuery.data.primaryCurrency} />
              </p>
              <p className="metric-hint">{t("reimbursedHint")}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("pendingReimbursement")}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={reportsQuery.data.totals.pendingAmount} currency={reportsQuery.data.primaryCurrency} />
              </p>
              <p className="metric-hint">{t("pendingReimbursementHint")}</p>
            </article>
          </section>

          {/* ── Timing metrics ── */}
          <section className="expenses-metric-grid expenses-timing-row" aria-label={t("timingAriaLabel")}>
            <article className="metric-card">
              <p className="metric-label">{t("avgManagerApproval")}</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgSubmissionToManagerApprovalHours === null
                  ? "-"
                  : `${reportsQuery.data.timings.avgSubmissionToManagerApprovalHours.toFixed(1)}h`}
              </p>
              <p className="metric-hint">{t("avgManagerApprovalHint")}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("avgDisbursement")}</p>
              <p className="metric-value numeric">
                {reportsQuery.data.timings.avgManagerApprovalToDisbursementHours === null
                  ? "-"
                  : `${reportsQuery.data.timings.avgManagerApprovalToDisbursementHours.toFixed(1)}h`}
              </p>
              <p className="metric-hint">{t("avgDisbursementHint")}</p>
            </article>
          </section>

          {reportsQuery.data.totals.expenseCount === 0 ? (
            <EmptyState
              title={t("noReportData")}
              description={t("noReportDataDescription")}
              ctaLabel={t("openExpenses")}
              ctaHref="/expenses"
            />
          ) : (
            <>
              {/* ── Status breakdown + bar charts ── */}
              <section className="expenses-report-layout">
                <article className="settings-card expenses-report-card">
                  <header className="expenses-report-card-header">
                    <h2 className="section-title">{t("byStatus")}</h2>
                  </header>
                  {reportsQuery.data.statusBreakdown.length === 0 ? (
                    <p className="settings-card-description">{t("noStatusData")}</p>
                  ) : (
                    <ul className="expenses-report-bars" aria-label={t("statusBreakdownAriaLabel")}>
                      {reportsQuery.data.statusBreakdown.map((row: ExpenseReportStatusBucket) => (
                        <li key={row.status} className="expenses-report-row">
                          <div className="expenses-report-row-copy">
                            <p className="expenses-report-row-title">{row.label}</p>
                            <p className="expenses-report-row-meta">
                              <CurrencyDisplay amount={row.totalAmount} currency={reportsQuery.data!.primaryCurrency} /> |{" "}
                              <span className="numeric">{row.count}</span> {t("items")}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
                <ExpenseReportBars
                  title={t("byCategory")}
                  rows={reportsQuery.data.byCategory}
                  currency={reportsQuery.data.primaryCurrency}
                  noDataLabel={t("noDataPeriod")}
                  itemsLabel={t("items")}
                />
              </section>

              {/* ── Tabbed breakdown sections ── */}
              <section className="settings-card expenses-report-breakdown" aria-label={t("detailedBreakdowns")}>
                <header className="expenses-report-card-header">
                  <h2 className="section-title">{t("detailedBreakdowns")}</h2>
                </header>

                <section className="page-tabs" aria-label={t("breakdownAriaLabel")}>
                  <button
                    type="button"
                    className={activeTab === "employee" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("employee")}
                  >
                    {t("byEmployee")}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "category" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("category")}
                  >
                    {t("byCategory")}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "department" ? "page-tab page-tab-active" : "page-tab"}
                    onClick={() => setActiveTab("department")}
                  >
                    {t("byDepartment")}
                  </button>
                </section>

                <div className="expenses-report-tab-panel">
                  {activeTab === "employee" && (
                    <EmployeeTable rows={reportsQuery.data.enhancedByEmployee} currency={reportsQuery.data.primaryCurrency} t={td} />
                  )}
                  {activeTab === "category" && (
                    <CategoryTable rows={reportsQuery.data.enhancedByCategory} currency={reportsQuery.data.primaryCurrency} t={td} />
                  )}
                  {activeTab === "department" && (
                    <DepartmentTable rows={reportsQuery.data.enhancedByDepartment} currency={reportsQuery.data.primaryCurrency} t={td} />
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
