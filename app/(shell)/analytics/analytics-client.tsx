"use client";

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
import { useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { useAnalytics, type AnalyticsQuery } from "../../../hooks/use-analytics";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDays } from "../../../lib/datetime";
import { getExpenseCategoryLabel, isExpenseCategory } from "../../../lib/expenses";
import { hasRole } from "../../../lib/roles";
import type { UserRole } from "../../../lib/navigation";
import type { AnalyticsCsvSection } from "../../../types/analytics";

type AppLocale = "en" | "fr";

/* ── Constants ── */

const CHART_PALETTE = [
  "var(--color-accent)",
  "var(--crew-navy)",
  "var(--status-warning-text)",
  "var(--status-pending-text)",
  "var(--text-secondary)"
] as const;

type DatePreset = "this_month" | "last_3" | "last_6" | "this_year" | "custom";

const EMPLOYMENT_TYPE_KEY: Record<string, string> = {
  full_time: "employmentFullTime",
  part_time: "employmentPartTime",
  contractor: "employmentContractor"
};

const STATUS_KEY: Record<string, string> = {
  active: "statusActive",
  onboarding: "statusOnboarding",
  inactive: "statusInactive",
  offboarding: "statusOffboarding"
};

/* ── Helpers ── */

function toLocalDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetToRange(preset: DatePreset): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = toLocalDateString(today);
  const start = new Date(today);

  switch (preset) {
    case "this_month":
      start.setDate(1);
      break;
    case "last_3":
      start.setMonth(start.getMonth() - 3);
      break;
    case "last_6":
      start.setMonth(start.getMonth() - 6);
      break;
    case "this_year":
      start.setMonth(0, 1);
      break;
    default:
      start.setDate(start.getDate() - 89);
      break;
  }

  return { startDate: toLocalDateString(start), endDate };
}

function formatMonthLabel(month: string, locale: AppLocale): string {
  const [year, monthValue] = month.split("-").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(year) || !Number.isFinite(monthValue) || monthValue < 1 || monthValue > 12) {
    return month;
  }
  const date = new Date(Date.UTC(year, monthValue - 1, 1));
  return date.toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function employmentTypeLabel(value: string, td: (key: string) => string): string {
  const key = EMPLOYMENT_TYPE_KEY[value];
  if (key) return td(key);
  return value;
}

function leaveTypeLabel(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function statusLabel(value: string, td: (key: string) => string): string {
  const key = STATUS_KEY[value];
  if (key) return td(key);
  return value;
}

function expenseCategoryLabel(value: string): string {
  if (!isExpenseCategory(value)) return value;
  return getExpenseCategoryLabel(value);
}

function canViewPayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function canViewPipeline(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

/* ── Sub-components ── */

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
  exporting,
  exportingLabel,
  exportCsvLabel
}: {
  title: string;
  description: string;
  onExport: () => void;
  exporting: boolean;
  exportingLabel: string;
  exportCsvLabel: string;
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
        {exporting ? exportingLabel : exportCsvLabel}
      </button>
    </header>
  );
}

function StatRow({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="analytics-stat-row">
      {items.map((item) => (
        <div key={item.label} className="analytics-stat-item">
          <span className="analytics-stat-label">{item.label}</span>
          <span className="analytics-stat-value numeric">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main content ── */

function AnalyticsContent({ userRoles }: { userRoles: readonly UserRole[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('analytics');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  // Initialize from URL params
  const initialPreset = (searchParams.get("preset") as DatePreset) || "last_3";
  const initialCountry = searchParams.get("country") || "all";
  const initialDepartment = searchParams.get("department") || "all";

  const [preset, setPreset] = useState<DatePreset>(initialPreset);
  const defaults = useMemo(() => presetToRange(initialPreset), [initialPreset]);
  const [draftStartDate, setDraftStartDate] = useState(searchParams.get("startDate") || defaults.startDate);
  const [draftEndDate, setDraftEndDate] = useState(searchParams.get("endDate") || defaults.endDate);
  const [range, setRange] = useState({ startDate: draftStartDate, endDate: draftEndDate });
  const [country, setCountry] = useState(initialCountry);
  const [department, setDepartment] = useState(initialDepartment);
  const [exportingSection, setExportingSection] = useState<AnalyticsCsvSection | null>(null);

  const analyticsQuery: AnalyticsQuery = useMemo(() => ({
    startDate: range.startDate,
    endDate: range.endDate,
    country: country !== "all" ? country : undefined,
    department: department !== "all" ? department : undefined
  }), [range, country, department]);

  const query = useAnalytics(analyticsQuery);

  // Persist filters to URL
  const updateUrl = useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(params)) {
        if (value && value !== "all") {
          sp.set(key, value);
        } else {
          sp.delete(key);
        }
      }
      router.replace(`/analytics?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const newRange = presetToRange(p);
    setDraftStartDate(newRange.startDate);
    setDraftEndDate(newRange.endDate);
    setRange(newRange);
    updateUrl({ preset: p, startDate: newRange.startDate, endDate: newRange.endDate });
  };

  const applyCustomRange = () => {
    if (draftStartDate > draftEndDate) return;
    setPreset("custom");
    setRange({ startDate: draftStartDate, endDate: draftEndDate });
    updateUrl({ preset: "custom", startDate: draftStartDate, endDate: draftEndDate });
  };

  const applyCountry = (value: string) => {
    setCountry(value);
    updateUrl({ country: value });
  };

  const applyDepartment = (value: string) => {
    setDepartment(value);
    updateUrl({ department: value });
  };

  const invalidRange = draftStartDate > draftEndDate;

  const exportSection = (section: AnalyticsCsvSection) => {
    setExportingSection(section);
    const sp = new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
      format: "csv",
      section
    });
    if (country !== "all") sp.set("country", country);
    if (department !== "all") sp.set("department", department);

    window.open(`/api/v1/analytics?${sp.toString()}`, "_blank", "noopener,noreferrer");
    window.setTimeout(() => {
      setExportingSection((current) => (current === section ? null : current));
    }, 500);
  };

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <AnalyticsSkeleton />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <ErrorState
          title={t('unavailable')}
          message={query.error instanceof Error ? query.error.message : t('loadError')}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const data = query.data;
  const showPayroll = canViewPayroll(userRoles);
  const showPipeline = canViewPipeline(userRoles);
  const countries = data.filterOptions.countries;
  const departments = data.filterOptions.departments;

  const noData =
    data.people.metrics.activeHeadcount === 0 &&
    data.timeOff.metrics.requestedDays === 0 &&
    data.payroll.metrics.totalNet === 0 &&
    data.expenses.metrics.totalAmount === 0;

  // Prepare chart data
  const peopleByCountry = data.people.byCountry.map((row) => ({
    ...row,
    label: `${countryFlagFromCode(row.key)} ${countryNameFromCode(row.key, locale)}`
  }));
  const peopleByDepartment = [...data.people.byDepartment].sort((a, b) => b.count - a.count);

  const timeOffByType = data.timeOff.byType.map((row) => ({
    ...row,
    label: leaveTypeLabel(row.key)
  }));
  const leaveByDept = data.timeOff.byDepartment;

  const payrollTrend = data.payroll.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month, locale)
  }));
  const payrollByDept = [...data.payroll.byDepartment].sort((a, b) => b.avgNet - a.avgNet);

  const expensesByCategory = data.expenses.byCategory.map((row) => ({
    ...row,
    label: expenseCategoryLabel(row.key)
  }));
  const expensesTrend = data.expenses.trend.map((row) => ({
    ...row,
    label: formatMonthLabel(row.month, locale)
  }));

  const presetButtons: Array<[DatePreset, string]> = [
    ["this_month", t('presetThisMonth')],
    ["last_3", t('presetLast3')],
    ["last_6", t('presetLast6')],
    ["this_year", t('presetThisYear')]
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={query.isFetching ? <StatusBadge tone="processing">{t('refreshing')}</StatusBadge> : null}
      />

      {/* ── Sticky Filters ── */}
      <section className="analytics-toolbar analytics-toolbar-sticky" aria-label={t('filtersAriaLabel')}>
        <div className="analytics-filter-row">
          <div className="analytics-preset-group">
            {presetButtons.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={preset === key ? "button button-primary" : "button button-subtle"}
                onClick={() => applyPreset(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {countries.length > 1 && (
            <select
              className="form-input analytics-filter-select"
              value={country}
              onChange={(e) => applyCountry(e.target.value)}
              aria-label={t('countryFilterAria')}
            >
              <option value="all">{t('allCountries')}</option>
              {countries.map((cc) => (
                <option key={cc} value={cc}>
                  {countryFlagFromCode(cc)} {countryNameFromCode(cc, locale)}
                </option>
              ))}
            </select>
          )}

          {departments.length > 1 && (
            <select
              className="form-input analytics-filter-select"
              value={department}
              onChange={(e) => applyDepartment(e.target.value)}
              aria-label={t('departmentFilterAria')}
            >
              <option value="all">{t('allDepartments')}</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          )}
        </div>

        {preset === "custom" || draftStartDate !== presetToRange(preset).startDate ? (
          <div className="analytics-filter-row">
            <label className="form-field" htmlFor="analytics-start-date">
              <span className="form-label">{t('startDateLabel')}</span>
              <input
                id="analytics-start-date"
                className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
                type="date"
                value={draftStartDate}
                onChange={(e) => setDraftStartDate(e.currentTarget.value)}
              />
            </label>
            <label className="form-field" htmlFor="analytics-end-date">
              <span className="form-label">{t('endDateLabel')}</span>
              <input
                id="analytics-end-date"
                className={invalidRange ? "form-input form-input-error numeric" : "form-input numeric"}
                type="date"
                value={draftEndDate}
                onChange={(e) => setDraftEndDate(e.currentTarget.value)}
              />
            </label>
            <button type="button" className="button button-accent" disabled={invalidRange} onClick={applyCustomRange}>
              {t('apply')}
            </button>
            {invalidRange && <p className="form-field-error">{t('invalidRangeError')}</p>}
          </div>
        ) : null}
      </section>

      {noData ? (
        <EmptyState
          title={t('noDataTitle')}
          description={t('noDataDescription')}
        />
      ) : (
        <section className="settings-layout">
          {/* Section 1: Workforce Overview */}
          <article className="settings-card">
            <SectionHeader
              title={t('workforceTitle')}
              description={t('workforceDescription')}
              onExport={() => exportSection("people")}
              exporting={exportingSection === "people"}
              exportingLabel={t('exporting')}
              exportCsvLabel={t('exportCsv')}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">{t('totalHeadcount')}</p>
                <p className="metric-value numeric">{data.people.metrics.activeHeadcount}</p>
                {data.people.metrics.newHiresThisMonth > 0 && (
                  <p className="metric-hint metric-hint-positive">
                    {t('newHiresThisMonth', { count: data.people.metrics.newHiresThisMonth })}
                  </p>
                )}
                {data.people.metrics.newHiresThisMonth === 0 && (
                  <p className="metric-hint">{t('currentActivePeople')}</p>
                )}
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('newHires')}</p>
                <p className="metric-value numeric">{data.people.metrics.newHires}</p>
                <p className="metric-hint">{t('newHiresHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('departures')}</p>
                <p className="metric-value numeric">{data.people.metrics.departures}</p>
                <p className="metric-hint">{t('departuresHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('avgTenure')}</p>
                <p className="metric-value numeric">{t('avgTenureValue', { months: data.people.metrics.avgTenureMonths })}</p>
                <p className="metric-hint">{t('avgTenureHint')}</p>
              </article>
            </section>

            <section className="analytics-chart-grid analytics-chart-grid-two">
              <article className="analytics-chart-card">
                <h3 className="section-title">{t('headcountByCountry')}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={peopleByCountry}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">{t('headcountByDepartment')}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={peopleByDepartment} layout="vertical">
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis dataKey="label" type="category" tick={{ fill: "var(--text-secondary)" }} width={100} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>

            <StatRow
              items={data.people.employmentType.map((row) => ({
                label: employmentTypeLabel(row.key, td),
                value: row.count
              }))}
            />

            {data.people.statusDistribution.length > 0 && (
              <StatRow
                items={data.people.statusDistribution.map((row) => ({
                  label: statusLabel(row.key, td),
                  value: row.count
                }))}
              />
            )}
          </article>

          {/* Section 2: Leave & Attendance */}
          <article className="settings-card">
            <SectionHeader
              title={t('leaveTitle')}
              description={t('leaveDescription')}
              onExport={() => exportSection("time_off")}
              exporting={exportingSection === "time_off"}
              exportingLabel={t('exporting')}
              exportCsvLabel={t('exportCsv')}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">{t('leaveDaysTaken')}</p>
                <p className="metric-value numeric">{formatDays(data.timeOff.metrics.totalDaysTaken, locale)}</p>
                <p className="metric-hint">{t('leaveDaysHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('mostCommonType')}</p>
                <p className="metric-value">{data.timeOff.metrics.mostCommonType ? leaveTypeLabel(data.timeOff.metrics.mostCommonType) : "-"}</p>
                <p className="metric-hint">{t('mostCommonTypeHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('avgBalanceRemaining')}</p>
                <p className="metric-value numeric">{t('avgBalanceDays', { days: formatDays(data.timeOff.metrics.avgLeaveBalance, locale) })}</p>
                <p className="metric-hint">{t('avgBalanceHint')}</p>
              </article>
            </section>

            <section className="analytics-chart-grid analytics-chart-grid-two">
              <article className="analytics-chart-card">
                <h3 className="section-title">{t('leaveByType')}</h3>
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
                <h3 className="section-title">{t('leaveByDept')}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={leaveByDept} layout="vertical">
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis dataKey="department" type="category" tick={{ fill: "var(--text-secondary)" }} width={100} />
                    <Tooltip formatter={(value) => `${String(value)}%`} />
                    <Bar dataKey="utilizationPct" fill={CHART_PALETTE[2]} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>

            {data.timeOff.topUsers.length > 0 && (
              <section className="analytics-list-card">
                <h3 className="section-title">{t('topLeaveTakers')}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('thEmployee')}</th>
                      <th>{t('thDepartment')}</th>
                      <th className="numeric">{t('thDays')}</th>
                      <th>{t('thPrimaryType')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.timeOff.topUsers.map((row) => (
                      <tr key={row.employeeId}>
                        <td>
                          <a className="table-row-action" href={`/people/${row.employeeId}`}>
                            {row.fullName}
                          </a>
                        </td>
                        <td>{row.department ?? "-"}</td>
                        <td className="numeric">{formatDays(row.totalDays, locale)}</td>
                        <td>{leaveTypeLabel(row.mainType)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </article>

          {/* Section 3: Payroll & Compensation (Finance Admin+ only) */}
          {showPayroll && (
            <article className="settings-card">
              <SectionHeader
                title={t('payrollTitle')}
                description={t('payrollDescription')}
                onExport={() => exportSection("payroll")}
                exporting={exportingSection === "payroll"}
                exportingLabel={t('exporting')}
                exportCsvLabel={t('exportCsv')}
              />
              <section className="analytics-metric-grid">
                <article className="metric-card">
                  <p className="metric-label">{t('grossLastRun')}</p>
                  <p className="metric-value">
                    <CurrencyDisplay amount={data.payroll.metrics.lastRunGross} currency={data.payroll.metrics.currency} />
                  </p>
                  <p className="metric-hint">{t('lastRunHint')}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('netLastRun')}</p>
                  <p className="metric-value">
                    <CurrencyDisplay amount={data.payroll.metrics.lastRunNet} currency={data.payroll.metrics.currency} />
                  </p>
                  <p className="metric-hint">{t('lastRunHint')}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('avgGrossSalary')}</p>
                  <p className="metric-value">
                    <CurrencyDisplay amount={data.payroll.metrics.avgGrossSalary} currency={data.payroll.metrics.currency} />
                  </p>
                  <p className="metric-hint">{t('avgGrossHint')}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('totalAllowances')}</p>
                  <p className="metric-value">
                    <CurrencyDisplay amount={data.payroll.metrics.totalAllowances} currency={data.payroll.metrics.currency} />
                  </p>
                  <p className="metric-hint">{t('totalAllowancesHint')}</p>
                </article>
              </section>

              <section className="analytics-chart-grid analytics-chart-grid-two">
                <article className="analytics-chart-card">
                  <h3 className="section-title">{t('payrollCostTrend')}</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={payrollTrend}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                      <YAxis tick={{ fill: "var(--text-secondary)" }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="totalGross" name={t('legendGross')} stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="totalNet" name={t('legendNet')} stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </article>

                <article className="analytics-chart-card">
                  <h3 className="section-title">{t('avgSalaryByDept')}</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={payrollByDept} layout="vertical">
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: "var(--text-secondary)" }} />
                      <YAxis dataKey="label" type="category" tick={{ fill: "var(--text-secondary)" }} width={100} />
                      <Tooltip />
                      <Bar dataKey="avgNet" fill={CHART_PALETTE[0]} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </article>
              </section>

              <StatRow
                items={[
                  { label: t('belowMidpoint'), value: t('peopleCount', { count: data.payroll.compensationBands.belowMidpoint }) },
                  { label: t('atMidpoint'), value: t('peopleCount', { count: data.payroll.compensationBands.atMidpoint }) },
                  { label: t('aboveMidpoint'), value: t('peopleCount', { count: data.payroll.compensationBands.aboveMidpoint }) }
                ]}
              />
            </article>
          )}

          {/* Section 4: Expenses */}
          <article className="settings-card">
            <SectionHeader
              title={t('expensesTitle')}
              description={t('expensesDescription')}
              onExport={() => exportSection("expenses")}
              exporting={exportingSection === "expenses"}
              exportingLabel={t('exporting')}
              exportCsvLabel={t('exportCsv')}
            />
            <section className="analytics-metric-grid">
              <article className="metric-card">
                <p className="metric-label">{t('totalSubmitted')}</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.totalAmount} currency={data.expenses.metrics.currency} />
                </p>
                <p className="metric-hint">{t('totalSubmittedHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('totalReimbursed')}</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.reimbursedAmount} currency={data.expenses.metrics.currency} />
                </p>
                <p className="metric-hint">{t('totalReimbursedHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('pendingReimbursement')}</p>
                <p className="metric-value">
                  <CurrencyDisplay amount={data.expenses.metrics.pendingAmount} currency={data.expenses.metrics.currency} />
                </p>
                <p className="metric-hint">{t('pendingReimbursementHint')}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">{t('avgProcessingTime')}</p>
                <p className="metric-value numeric">{t('avgProcessingDays', { days: data.expenses.metrics.avgProcessingDays })}</p>
                <p className="metric-hint">{t('avgProcessingHint')}</p>
              </article>
            </section>

            <section className="analytics-chart-grid analytics-chart-grid-two">
              <article className="analytics-chart-card">
                <h3 className="section-title">{t('byCategory')}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={expensesByCategory}
                      dataKey="totalAmount"
                      nameKey="label"
                      innerRadius={56}
                      outerRadius={88}
                      paddingAngle={2}
                    >
                      {expensesByCategory.map((row, index) => (
                        <Cell key={row.key} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </article>

              <article className="analytics-chart-card">
                <h3 className="section-title">{t('expenseTrend')}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={expensesTrend}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fill: "var(--text-secondary)" }} />
                    <Tooltip />
                    <Bar dataKey="totalAmount" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>
          </article>

          {/* Section 5: People Pipeline (HR Admin+ only) */}
          {showPipeline && (
            <article className="settings-card">
              <SectionHeader
                title={t('pipelineTitle')}
                description={t('pipelineDescription')}
                onExport={() => exportSection("pipeline")}
                exporting={exportingSection === "pipeline"}
                exportingLabel={t('exporting')}
                exportCsvLabel={t('exportCsv')}
              />
              <section className="analytics-metric-grid">
                <article className="metric-card">
                  <p className="metric-label">{t('activeOnboarding')}</p>
                  <p className="metric-value numeric">{data.pipeline.onboarding.active}</p>
                  {data.pipeline.onboarding.overdue > 0 && (
                    <p className="metric-hint metric-hint-warning">
                      {t('overdueCount', { count: data.pipeline.onboarding.overdue })}
                    </p>
                  )}
                  {data.pipeline.onboarding.overdue === 0 && (
                    <p className="metric-hint">{t('allOnTrack')}</p>
                  )}
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('reviewCycles')}</p>
                  <p className="metric-value numeric">{t('reviewCyclesActive', { count: data.pipeline.reviewCycles.active })}</p>
                  <p className="metric-hint">
                    {t('completionRate', { pct: data.pipeline.reviewCycles.completionPct })}
                  </p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('learning')}</p>
                  <p className="metric-value numeric">{t('learningCourses', { count: data.pipeline.learning.activeCourses })}</p>
                  <p className="metric-hint">
                    {t('completionRate', { pct: data.pipeline.learning.completionPct })}
                  </p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">{t('complianceHealth')}</p>
                  <p className="metric-value numeric">{data.pipeline.complianceHealth.completedOnTimePct}%</p>
                  <p className="metric-hint">{t('complianceHint')}</p>
                </article>
              </section>
            </article>
          )}
        </section>
      )}
    </>
  );
}

/* ── Export wrapper ── */

export function AnalyticsClient({ userRoles }: { userRoles: readonly UserRole[] }) {
  return <AnalyticsContent userRoles={userRoles} />;
}
