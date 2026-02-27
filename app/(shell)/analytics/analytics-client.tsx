"use client";

import {
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { useAnalytics } from "../../../hooks/use-analytics";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { getExpenseCategoryLabel, isExpenseCategory } from "../../../lib/expenses";
import type { AnalyticsCsvSection } from "../../../types/analytics";

const CHART_PALETTE = [
  "var(--color-accent)",
  "var(--status-info-text)",
  "var(--status-warning-text)",
  "var(--status-pending-text)",
  "var(--text-secondary)"
] as const;

function toLocalDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange() {
  const today = new Date();
  const endDate = toLocalDateString(today);
  const startDateValue = new Date(today);
  startDateValue.setDate(startDateValue.getDate() - 89);
  const startDate = toLocalDateString(startDateValue);

  return { startDate, endDate };
}

function formatMonthLabel(month: string): string {
  const [year, monthValue] = month.split("-").map((value) => Number.parseInt(value, 10));

  if (!Number.isFinite(year) || !Number.isFinite(monthValue) || monthValue < 1 || monthValue > 12) {
    return month;
  }

  const date = new Date(Date.UTC(year, monthValue - 1, 1));
  return date.toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  });
}

function employmentTypeLabel(value: string): string {
  if (value === "full_time") {
    return "Full time";
  }

  if (value === "part_time") {
    return "Part time";
  }

  if (value === "contractor") {
    return "Contractor";
  }

  return value;
}

function leaveTypeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function expenseCategoryLabel(value: string): string {
  if (!isExpenseCategory(value)) {
    return value;
  }

  return getExpenseCategoryLabel(value);
}

function AnalyticsSkeleton() {
  return (
    <section className="analytics-skeleton" aria-hidden="true">
      <div className="analytics-skeleton-toolbar" />
      <div className="analytics-skeleton-metrics">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`analytics-metric-skeleton-${index}`} className="analytics-skeleton-card" />
        ))}
      </div>
      <div className="analytics-skeleton-charts">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`analytics-chart-skeleton-${index}`} className="analytics-skeleton-chart" />
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  description,
  onExport,
  exporting
}: {
  title: string;
  description: string;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <header className="analytics-section-header">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="settings-card-description">{description}</p>
      </div>
      <button
        type="button"
        className="button button-subtle"
        onClick={onExport}
        disabled={exporting}
      >
        {exporting ? "Exporting..." : "Export CSV"}
      </button>
    </header>
  );
}

function AnalyticsContent() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [draftStartDate, setDraftStartDate] = useState(defaults.startDate);
  const [draftEndDate, setDraftEndDate] = useState(defaults.endDate);
  const [range, setRange] = useState(defaults);
  const [exportingSection, setExportingSection] = useState<AnalyticsCsvSection | null>(null);
  const analyticsQuery = useAnalytics(range);

  const invalidRange = draftStartDate > draftEndDate;

  const applyRange = () => {
    if (invalidRange) {
      return;
    }

    setRange({
      startDate: draftStartDate,
      endDate: draftEndDate
    });
  };

  const applyPreset = (preset: "30d" | "90d" | "ytd") => {
    const today = new Date();
    const endDate = toLocalDateString(today);
    const start = new Date(today);

    if (preset === "30d") {
      start.setDate(start.getDate() - 29);
    } else if (preset === "90d") {
      start.setDate(start.getDate() - 89);
    } else {
      start.setMonth(0, 1);
    }

    const startDate = toLocalDateString(start);
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setRange({ startDate, endDate });
  };

  const exportSection = (section: AnalyticsCsvSection) => {
    setExportingSection(section);

    const searchParams = new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
      format: "csv",
      section
    });

    window.open(`/api/v1/analytics?${searchParams.toString()}`, "_blank", "noopener,noreferrer");

    window.setTimeout(() => {
      setExportingSection((current) => (current === section ? null : current));
    }, 500);
  };

  if (analyticsQuery.isPending) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Role-aware reporting for people, time off, payroll, and expenses in Crew Hub."
        />
        <AnalyticsSkeleton />
      </>
    );
  }

  if (analyticsQuery.isError || !analyticsQuery.data) {
    const errorMessage =
      analyticsQuery.error instanceof Error
        ? analyticsQuery.error.message
        : "Unable to load analytics.";

    return (
      <>
        <PageHeader
          title="Analytics"
          description="Role-aware reporting for people, time off, payroll, and expenses in Crew Hub."
        />
        <section className="settings-layout">
          <EmptyState
            title="Analytics unavailable"
            description={errorMessage}
            ctaLabel="Retry"
            ctaHref="/analytics"
          />
          <button type="button" className="button button-accent" onClick={() => analyticsQuery.refetch()}>
            Retry now
          </button>
        </section>
      </>
    );
  }

  const data = analyticsQuery.data;
  const noData =
    data.people.metrics.activeHeadcount === 0 &&
    data.timeOff.metrics.requestedDays === 0 &&
    data.payroll.metrics.totalNet === 0 &&
    data.expenses.metrics.totalAmount === 0;

  const peopleByDepartment = data.people.byDepartment;
  const peopleByCountry = data.people.byCountry.map((row) => ({
    ...row,
    label: `${countryFlagFromCode(row.key)} ${countryNameFromCode(row.key)}`
  }));
  const peopleTrend = data.people.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month)
  }));
  const peopleEmploymentType = data.people.employmentType.map((row) => ({
    ...row,
    label: employmentTypeLabel(row.key)
  }));

  const timeOffByType = data.timeOff.byType.map((row) => ({
    ...row,
    label: leaveTypeLabel(row.key)
  }));
  const timeOffTrend = data.timeOff.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month)
  }));

  const payrollTrend = data.payroll.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month)
  }));
  const payrollByCountry = data.payroll.byCountry.map((row) => ({
    ...row,
    label: `${countryFlagFromCode(row.key)} ${countryNameFromCode(row.key)}`
  }));

  const expensesByCategory = data.expenses.byCategory.map((row) => ({
    ...row,
    label: expenseCategoryLabel(row.key)
  }));
  const expensesTrend = data.expenses.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month)
  }));
  const topSpenders = data.expenses.topSpenders;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Role-aware reporting for people, time off, payroll, and expenses in Crew Hub."
        actions={
          analyticsQuery.isFetching ? (
            <StatusBadge tone="processing">Refreshing</StatusBadge>
          ) : null
        }
      />

      <section className="analytics-toolbar" aria-label="Analytics filters">
        <label className="form-field" htmlFor="analytics-start-date">
          <span className="form-label">Start date</span>
          <input
            id="analytics-start-date"
            className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
            type="date"
            value={draftStartDate}
            onChange={(event) => setDraftStartDate(event.currentTarget.value)}
          />
        </label>
        <label className="form-field" htmlFor="analytics-end-date">
          <span className="form-label">End date</span>
          <input
            id="analytics-end-date"
            className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
            type="date"
            value={draftEndDate}
            onChange={(event) => setDraftEndDate(event.currentTarget.value)}
          />
        </label>
        <div className="analytics-toolbar-actions">
          <div className="analytics-preset-group">
            <button type="button" className="button button-subtle" onClick={() => applyPreset("30d")}>
              Last 30d
            </button>
            <button type="button" className="button button-subtle" onClick={() => applyPreset("90d")}>
              Last 90d
            </button>
            <button type="button" className="button button-subtle" onClick={() => applyPreset("ytd")}>
              YTD
            </button>
          </div>
          <button type="button" className="button button-accent" disabled={invalidRange} onClick={applyRange}>
            Apply
          </button>
        </div>
        {invalidRange ? <p className="form-field-error">Start date cannot be after end date.</p> : null}
      </section>

      {noData ? (
        <EmptyState
          title="No analytics data for this range"
          description="Try a wider date range or seed data to populate analytics charts."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      ) : null}

      {!noData ? (
        <section className="settings-layout">
          <article className="settings-card">
            <SectionHeader
              title="People"
              description="Headcount, country and department distribution, employment mix, and growth trend."
              onExport={() => exportSection("people")}
              exporting={exportingSection === "people"}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">Active headcount</p>
                <p className="metric-value numeric">{data.people.metrics.activeHeadcount}</p>
                <p className="metric-hint">Current active employees</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">New hires</p>
                <p className="metric-value numeric">{data.people.metrics.newHires}</p>
                <p className="metric-hint">Joined in selected range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Departments</p>
                <p className="metric-value numeric">{data.people.metrics.activeDepartments}</p>
                <p className="metric-hint">With active headcount</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Countries</p>
                <p className="metric-value numeric">{data.people.metrics.activeCountries}</p>
                <p className="metric-hint">With active headcount</p>
              </article>
            </section>
            <section className="analytics-chart-grid">
              <article className="analytics-chart-card">
                <h3 className="section-title">Headcount by department</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={peopleByDepartment}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">Headcount by country</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={peopleByCountry}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">Headcount trend</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={peopleTrend}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="headcount" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="hires" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">Employment type</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={peopleEmploymentType}
                      dataKey="count"
                      nameKey="label"
                      innerRadius={56}
                      outerRadius={88}
                      paddingAngle={2}
                    >
                      {peopleEmploymentType.map((row, index) => (
                        <Cell key={row.key} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </article>
            </section>
          </article>

          <article className="settings-card">
            <SectionHeader
              title="Time Off"
              description="Utilization across leave types, monthly trend, and employees currently out."
              onExport={() => exportSection("time_off")}
              exporting={exportingSection === "time_off"}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">Requested days</p>
                <p className="metric-value numeric">{data.timeOff.metrics.requestedDays.toFixed(1)}</p>
                <p className="metric-hint">Approved + pending in range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Approved days</p>
                <p className="metric-value numeric">{data.timeOff.metrics.approvedDays.toFixed(1)}</p>
                <p className="metric-hint">Approved leave in range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Utilization</p>
                <p className="metric-value numeric">{data.timeOff.metrics.utilizationRate.toFixed(1)}%</p>
                <p className="metric-hint">Approved days vs available balance</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Currently out</p>
                <p className="metric-value numeric">{data.timeOff.metrics.currentlyOutCount}</p>
                <p className="metric-hint">Approved leave active today</p>
              </article>
            </section>
            <section className="analytics-chart-grid analytics-chart-grid-two">
              <article className="analytics-chart-card">
                <h3 className="section-title">Leave by type</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={timeOffByType}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="totalDays" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">Leave trend</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={timeOffTrend}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="requestedDays" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="approvedDays" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </article>
            </section>

            <section className="analytics-list-card">
              <h3 className="section-title">Currently out</h3>
              {data.timeOff.currentlyOut.length === 0 ? (
                <p className="settings-card-description">No one is currently out on approved leave.</p>
              ) : (
                <ul className="analytics-chip-list">
                  {data.timeOff.currentlyOut.map((row) => (
                    <li key={`${row.employeeId}-${row.leaveType}-${row.endDate}`} className="analytics-chip-item">
                      <div>
                        <p>
                          <strong>{row.fullName}</strong> • {leaveTypeLabel(row.leaveType)}
                        </p>
                        <p className="settings-card-description">
                          {countryFlagFromCode(row.countryCode)} {countryNameFromCode(row.countryCode)} • Ends{" "}
                          <span className="numeric" title={formatDateTimeTooltip(row.endDate)}>
                            {formatRelativeTime(row.endDate)}
                          </span>
                        </p>
                      </div>
                      <a className="table-row-action" href={`/people/${row.employeeId}`}>
                        View profile
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </article>

          <article className="settings-card">
            <SectionHeader
              title="Payroll"
              description="Total payroll cost, monthly trend, and average net pay by department and country."
              onExport={() => exportSection("payroll")}
              exporting={exportingSection === "payroll"}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">Total net</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.payroll.metrics.totalNet} currency="USD" />
                </p>
                <p className="metric-hint">Net payroll in selected range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Total gross</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.payroll.metrics.totalGross} currency="USD" />
                </p>
                <p className="metric-hint">Gross payroll in selected range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Total deductions</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.payroll.metrics.totalDeductions} currency="USD" />
                </p>
                <p className="metric-hint">Withholding and deductions</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Avg net / employee</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.payroll.metrics.avgNetPerEmployee} currency="USD" />
                </p>
                <p className="metric-hint">
                  Across <span className="numeric">{data.payroll.metrics.runCount}</span> payroll runs
                </p>
              </article>
            </section>
            <section className="analytics-chart-grid analytics-chart-grid-two">
              <article className="analytics-chart-card">
                <h3 className="section-title">Payroll trend</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={payrollTrend}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="totalNet" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalGross" stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </article>
              <article className="analytics-chart-card">
                <h3 className="section-title">Average net by department</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.payroll.byDepartment}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="avgNet" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>
            <article className="analytics-chart-card">
              <h3 className="section-title">Total net by country</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={payrollByCountry}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                  <YAxis tick={{ fill: "var(--text-secondary)" }} />
                  <Tooltip />
                  <Bar dataKey="totalNet" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </article>
          </article>

          <article className="settings-card">
            <SectionHeader
              title="Expenses"
              description="Expense cost distribution, trend, and top spenders by amount."
              onExport={() => exportSection("expenses")}
              exporting={exportingSection === "expenses"}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">Total submitted</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.totalAmount} currency="USD" />
                </p>
                <p className="metric-hint">All expenses in selected range</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Approved/reimbursed</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.approvedAmount} currency="USD" />
                </p>
                <p className="metric-hint">Approved + reimbursed spend</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Pending amount</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.pendingAmount} currency="USD" />
                </p>
                <p className="metric-hint">Awaiting approval</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Expense count</p>
                <p className="metric-value numeric">{data.expenses.metrics.expenseCount}</p>
                <p className="metric-hint">Submitted expense records</p>
              </article>
            </section>
            <section className="analytics-chart-grid">
              <article className="analytics-chart-card">
                <h3 className="section-title">By category</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={expensesByCategory}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="totalAmount" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
              <article className="analytics-chart-card">
                <h3 className="section-title">Expense trend</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={expensesTrend}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="totalAmount" stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </article>
              <article className="analytics-chart-card analytics-chart-span-two">
                <h3 className="section-title">Top spenders</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topSpenders}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="fullName" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="totalAmount" fill={CHART_PALETTE[2]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>
          </article>
        </section>
      ) : null}
    </>
  );
}

export function AnalyticsClient() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 15 * 60 * 1000
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContent />
    </QueryClientProvider>
  );
}
