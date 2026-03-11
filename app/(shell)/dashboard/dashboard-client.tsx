"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

type AppLocale = "en" | "fr";

import { DecisionCard } from "../../../components/dashboard/decision-card";
import { DashboardSkeleton } from "../../../components/dashboard/dashboard-skeleton";
import { HealthAlerts } from "../../../components/dashboard/health-alerts";
import { ManagerOnboardingWidget, OnboardingBanner } from "../../../components/dashboard/onboarding-banner";
import { SetupChecklist } from "../../../components/dashboard/setup-checklist";
import { WidgetErrorBoundary } from "../../../components/dashboard/widget-error-boundary";
import { EmptyState } from "../../../components/shared/empty-state";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { useDashboard } from "../../../hooks/use-dashboard";
import { formatDate, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import { formatLeaveTypeLabel } from "../../../lib/time-off";
import type { DashboardResponseData } from "../../../types/dashboard";

import {
  Calendar,
  Receipt,
  FileText,
  Clock,
  CheckCircle,
  Sunrise,
  Sun,
  Sunset,
  AlertTriangle,
  ArrowRight,
  Megaphone,
  Palmtree,
  ShieldCheck,
  BarChart3,
  ChevronRight,
  Activity
} from "lucide-react";

/* ── Animation ── */

const fadeIn = {
  initial: { y: 8 },
  animate: { y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 18 } }
};

/* ── Greeting helpers ── */

function greetingIcon(tod: "morning" | "afternoon" | "evening") {
  if (tod === "morning") return <Sunrise size={18} />;
  if (tod === "afternoon") return <Sun size={18} />;
  return <Sunset size={18} />;
}

/* ── Quick Actions Row ── */

function QuickActionsRow({ hasTimePolicy }: { hasTimePolicy: boolean }) {
  const t = useTranslations('dashboard');
  return (
    <div className="home-quick-actions" role="list" aria-label={t('quickActions.ariaLabel')}>
      <Link href="/time-off" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Calendar size={20} /></span>
        <span className="home-quick-action-label">{t('quickActions.requestTimeOff')}</span>
      </Link>
      <Link href="/expenses" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Receipt size={20} /></span>
        <span className="home-quick-action-label">{t('quickActions.submitExpense')}</span>
      </Link>
      <Link href="/me/pay?tab=payslips" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><FileText size={20} /></span>
        <span className="home-quick-action-label">{t('quickActions.viewPayslips')}</span>
      </Link>
      {hasTimePolicy ? (
        <Link href="/time-attendance" className="home-quick-action-card" role="listitem">
          <span className="home-quick-action-icon"><Clock size={20} /></span>
          <span className="home-quick-action-label">{t('quickActions.clockIn')}</span>
        </Link>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════
   GREETING CARDS — one per persona
   ══════════════════════════════════════════════ */

function NewHireGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <h1 className="home-welcome-title">
          {t('newHire.welcome', { org: data.org?.name ?? t('newHire.yourTeam'), firstName: data.greeting.firstName })}
        </h1>
        {data.org?.description ? (
          <p className="home-welcome-subtitle">{data.org.description}</p>
        ) : null}

        {data.managerInfo ? (
          <div className="dashboard-manager-callout">
            {data.managerInfo.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.managerInfo.avatarUrl}
                alt={data.managerInfo.name}
                className="dashboard-manager-avatar"
                loading="lazy"
              />
            ) : (
              <span className="dashboard-manager-avatar-placeholder">
                {data.managerInfo.name.charAt(0)}
              </span>
            )}
            <span className="dashboard-manager-info">
              <span className="settings-card-description">{t('newHire.yourManager')}</span>
              <strong>{data.managerInfo.name}</strong>
              {data.managerInfo.title ? (
                <span className="settings-card-description">, {data.managerInfo.title}</span>
              ) : null}
            </span>
          </div>
        ) : null}

      </div>
    </motion.section>
  );
}

function EmployeeGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const totalLeave = data.leaveBalance?.totalAvailable ?? 0;
  const annualLeave = data.leaveBalance?.byType.find(
    (b) => b.leaveType.toLowerCase().includes("annual") || b.leaveType.toLowerCase().includes("vacation")
  );

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
        </p>
        <h1 className="home-welcome-title">
          {data.greeting.firstName}.
        </h1>
        {annualLeave ? (
          <p className="home-welcome-subtitle">
            {t('employee.annualLeaveAvailable', { count: annualLeave.available })}
          </p>
        ) : totalLeave > 0 ? (
          <p className="home-welcome-subtitle">
            {t('employee.leaveAvailable', { count: totalLeave })}
          </p>
        ) : null}
      </div>
      <QuickActionsRow hasTimePolicy={data.hasTimePolicy} />
    </motion.section>
  );
}

function ManagerGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const approvals = data.pendingApprovals;

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
        </p>
        <h1 className="home-welcome-title">
          {data.greeting.firstName}.
        </h1>

        {approvals && approvals.total > 0 ? (
          <div className="dashboard-approval-callout">
            <div className="dashboard-approval-callout-body">
              <p className="dashboard-approval-count numeric">
                {t('manager.itemsWaiting', { count: approvals.total })}
              </p>
              <p className="settings-card-description numeric">
                {approvals.leave > 0 ? t('manager.leaveCount', { count: approvals.leave }) : ""}
                {approvals.leave > 0 && approvals.expenses > 0 ? ", " : ""}
                {approvals.expenses > 0 ? t('manager.expenseCount', { count: approvals.expenses }) : ""}
                {(approvals.leave > 0 || approvals.expenses > 0) && approvals.timesheets > 0 ? ", " : ""}
                {approvals.timesheets > 0 ? t('manager.timesheetCount', { count: approvals.timesheets }) : ""}
              </p>
            </div>
            <Link href="/approvals" className="button button-accent">
              {t('manager.reviewNow')} <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="dashboard-all-caught-up">
            <CheckCircle size={20} />
            <span>{t('manager.allCaughtUp')}</span>
          </div>
        )}
      </div>
      <QuickActionsRow hasTimePolicy={data.hasTimePolicy} />
    </motion.section>
  );
}

function HrAdminGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const hc = data.headcount;
  const ob = data.onboardingStatus;
  const cd = data.complianceDeadlines;
  const rc = data.activeReviewCycles;

  let ctaHref = "/analytics";
  let ctaLabel = t('hrAdmin.viewAnalytics');
  if (cd && cd.overdue > 0) {
    ctaHref = "/compliance";
    ctaLabel = t('hrAdmin.reviewCompliance');
  } else if (cd && cd.thisMonth > 0) {
    ctaHref = "/compliance";
    ctaLabel = t('hrAdmin.viewCompliance');
  } else if (ob && ob.overdue > 0) {
    ctaHref = "/onboarding";
    ctaLabel = t('hrAdmin.viewOnboarding');
  }

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
        </p>
        <h1 className="home-welcome-title">
          {data.greeting.firstName}.
        </h1>
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <p className="metric-label">{t('hrAdmin.activePeople')}</p>
          <p className="metric-value numeric">{hc?.total ?? 0}</p>
          {hc && hc.delta30d > 0 ? (
            <p className="metric-description numeric">{t('hrAdmin.newThisMonth', { count: hc.delta30d })}</p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('hrAdmin.inOnboarding')}</p>
          <p className="metric-value numeric">{ob?.active ?? 0}</p>
          {ob && ob.overdue > 0 ? (
            <p className="metric-description" style={{ color: "var(--color-error)" }}>
              {t('hrAdmin.overdue', { count: ob.overdue })}
            </p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('hrAdmin.complianceThisMonth')}</p>
          <p className="metric-value numeric">{cd?.thisMonth ?? 0}</p>
          {cd && cd.overdue > 0 ? (
            <p className="metric-description" style={{ color: "var(--color-error)" }}>
              {t('hrAdmin.overdue', { count: cd.overdue })}
            </p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('hrAdmin.activeReviewCycles')}</p>
          <p className="metric-value numeric">{rc ?? 0}</p>
        </article>
      </div>
      <Link href={ctaHref} className="button button-accent" style={{ marginTop: "var(--space-4)" }}>
        {ctaLabel} <ArrowRight size={14} />
      </Link>
    </motion.section>
  );
}

function FinanceAdminGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;
  const payroll = data.payroll;
  const expenses = data.pendingExpenseApprovals;

  const statusTone = (() => {
    if (!payroll?.lastRunStatus) return "draft" as const;
    if (payroll.lastRunStatus === "approved" || payroll.lastRunStatus === "completed") return "success" as const;
    if (payroll.lastRunStatus === "processing") return "processing" as const;
    if (payroll.lastRunStatus === "rejected") return "error" as const;
    return "draft" as const;
  })();

  let ctaHref = "/payroll";
  let ctaLabel = t('financeAdmin.goToPayroll');
  if (expenses && expenses.financeStage > 0) {
    ctaHref = "/approvals";
    ctaLabel = t('financeAdmin.reviewExpenses');
  }

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
        </p>
        <h1 className="home-welcome-title">
          {data.greeting.firstName}.
        </h1>
      </div>
      <div className="dashboard-finance-summary">
        <article className="metric-card">
          <p className="metric-label">{t('financeAdmin.lastPayrollRun')}</p>
          <div className="dashboard-finance-status-row">
            {payroll?.lastRunStatus ? (
              <StatusBadge tone={statusTone}>{toSentenceCase(payroll.lastRunStatus)}</StatusBadge>
            ) : (
              <span className="settings-card-description">{t('financeAdmin.noRunsYet')}</span>
            )}
            {payroll?.lastRunDate ? (
              <span className="settings-card-description numeric">
                {formatRelativeTime(payroll.lastRunDate, locale)}
              </span>
            ) : null}
          </div>
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('financeAdmin.pendingExpenseApprovals')}</p>
          <p className="metric-value numeric">{expenses?.financeStage ?? 0}</p>
        </article>
      </div>
      <Link href={ctaHref} className="button button-accent" style={{ marginTop: "var(--space-4)" }}>
        {ctaLabel} <ArrowRight size={14} />
      </Link>
    </motion.section>
  );
}

function SuperAdminGreeting({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const hc = data.headcount;
  const approvals = data.pendingApprovals;
  const payroll = data.payroll;
  const cd = data.complianceDeadlines;
  const expenseSpendSummary = data.expenseSpendSummary;

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
        </p>
        <h1 className="home-welcome-title">
          {data.greeting.firstName}.
        </h1>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <p className="metric-label">{t('superAdmin.headcount')}</p>
          <p className="metric-value numeric">{hc?.total ?? 0}</p>
          {hc && hc.delta30d > 0 ? (
            <p className="metric-description numeric">{t('superAdmin.newThisMonth', { count: hc.delta30d })}</p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('superAdmin.pendingApprovals')}</p>
          <p className="metric-value numeric">{approvals?.total ?? 0}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('superAdmin.lastPayroll')}</p>
          {payroll?.lastRunStatus ? (
            <StatusBadge
              tone={
                payroll.lastRunStatus === "approved" || payroll.lastRunStatus === "completed"
                  ? "success"
                  : payroll.lastRunStatus === "processing"
                    ? "processing"
                    : "draft"
              }
            >
              {toSentenceCase(payroll.lastRunStatus)}
            </StatusBadge>
          ) : (
            <p className="metric-value">-</p>
          )}
        </article>
        <article className="metric-card">
          <p className="metric-label">{t('superAdmin.compliance')}</p>
          {cd && cd.overdue > 0 ? (
            <p className="metric-value" style={{ color: "var(--color-error)" }}>
              {t('superAdmin.overdue', { count: cd.overdue })}
            </p>
          ) : (
            <p className="metric-value" style={{ color: "var(--color-success)" }}>
              {t('superAdmin.onTrack')}
            </p>
          )}
        </article>
      </div>

      {expenseSpendSummary ? (
        <article className="metric-card" style={{ marginTop: "var(--space-4)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center" }}>
            <p className="metric-label">{t('superAdmin.expenseSnapshot')}</p>
            {expenseSpendSummary.mixedCurrency ? (
              <span className="settings-card-description">{t('superAdmin.primaryCurrencyView')}</span>
            ) : null}
          </div>
          <div className="dashboard-pipeline" style={{ marginTop: "var(--space-2)" }}>
            <div className="dashboard-pipeline-stage">
              <span className="metric-label">{t('superAdmin.thisMonth')}</span>
              <span className="metric-value">
                <CurrencyDisplay
                  amount={expenseSpendSummary.monthToDate}
                  currency={expenseSpendSummary.currency}
                />
              </span>
            </div>
            <ChevronRight size={14} className="dashboard-pipeline-arrow" />
            <div className="dashboard-pipeline-stage">
              <span className="metric-label">{t('superAdmin.yearToDate')}</span>
              <span className="metric-value">
                <CurrencyDisplay
                  amount={expenseSpendSummary.yearToDate}
                  currency={expenseSpendSummary.currency}
                />
              </span>
            </div>
          </div>
        </article>
      ) : null}

      {data.recentAuditLog && data.recentAuditLog.length > 0 ? (
        <div className="dashboard-audit-feed">
          <div className="dashboard-audit-feed-header">
            <h3 className="section-title">
              <Activity size={14} /> {t('superAdmin.recentAuditLog')}
            </h3>
            <Link href="/settings?tab=audit" className="announcement-widget-link">
              {tCommon('viewAll')} <ChevronRight size={14} />
            </Link>
          </div>
          <ul className="dashboard-audit-list">
            {data.recentAuditLog.map((entry) => (
              <li key={entry.id} className="dashboard-audit-item">
                <span className="dashboard-audit-actor">{entry.actorName}</span>
                <span className="dashboard-audit-action">{entry.action}</span>
                <span className="dashboard-audit-table">{entry.tableName}</span>
                <time className="dashboard-audit-time settings-card-description">
                  {formatRelativeTime(entry.timestamp, locale)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </motion.section>
  );
}

/* ══════════════════════════════════════════════
   WIDGETS — each handles its own empty/error state
   ══════════════════════════════════════════════ */

function WidgetCard({
  title,
  icon,
  children,
  fullWidth,
  viewAllHref
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  fullWidth?: boolean;
  viewAllHref?: string;
}) {
  const tCommon = useTranslations('common');
  return (
    <motion.article
      className={`home-card dashboard-widget${fullWidth ? " dashboard-widget-full" : ""}`}
      variants={fadeIn}
    >
      <header className="dashboard-widget-header">
        <h3 className="section-title">
          {icon} {title}
        </h3>
        {viewAllHref ? (
          <Link href={viewAllHref} className="announcement-widget-link">
            {tCommon('viewAll')} <ChevronRight size={14} />
          </Link>
        ) : null}
      </header>
      {children}
    </motion.article>
  );
}

function AnnouncementsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;

  if (data.announcements.length === 0) {
    return (
      <WidgetCard title={t('widget.announcements')} icon={<Megaphone size={14} />} viewAllHref="/announcements">
        <p className="settings-card-description">{t('widget.noAnnouncements')}</p>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title={t('widget.announcements')} icon={<Megaphone size={14} />} viewAllHref="/announcements">
      <ul className="dashboard-widget-list">
        {data.announcements.map((a) => (
          <li key={a.id} className="dashboard-widget-list-item">
            <p className="dashboard-widget-item-title">{a.title}</p>
            <time className="settings-card-description">{formatRelativeTime(a.createdAt, locale)}</time>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function TeamOnLeaveWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  return (
    <WidgetCard title={t('widget.teamOnLeave')} icon={<Palmtree size={14} />}>
      {data.teamOnLeaveToday.length === 0 ? (
        <p className="settings-card-description">{t('widget.noOneOnLeave')}</p>
      ) : (
        <ul className="dashboard-widget-list">
          {data.teamOnLeaveToday.map((person) => (
            <li key={person.id} className="dashboard-widget-list-item">
              <span>{person.name}</span>
              <StatusBadge tone="info">{formatLeaveTypeLabel(person.leaveType)}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function UpcomingHolidaysWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;

  if (data.upcomingHolidays.length === 0) return null;

  return (
    <WidgetCard title={t('widget.upcomingHolidays')} icon={<Calendar size={14} />}>
      <ul className="dashboard-widget-list">
        {data.upcomingHolidays.map((h, i) => (
          <li key={`${h.date}-${i}`} className="dashboard-widget-list-item">
            <span>{h.name}</span>
            <span className="settings-card-description numeric">{formatDate(h.date, locale)}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function LeaveBalanceWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.leaveBalance || data.leaveBalance.byType.length === 0) return null;

  return (
    <WidgetCard title={t('widget.myLeaveBalance')} icon={<Palmtree size={14} />}>
      <ul className="dashboard-widget-list">
        {data.leaveBalance.byType.map((b) => (
          <li key={b.leaveType} className="dashboard-widget-list-item">
            <span>{formatLeaveTypeLabel(b.leaveType)}</span>
            <span className="numeric">
              <strong>{b.available}</strong>/{b.allocated} {t('widget.days')}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function RecentExpensesWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (data.recentExpenses.length === 0) return null;

  return (
    <WidgetCard title={t('widget.recentExpenses')} icon={<Receipt size={14} />} viewAllHref="/expenses">
      <ul className="dashboard-widget-list">
        {data.recentExpenses.map((e) => (
          <li key={e.id} className="dashboard-widget-list-item">
            <span>{e.description}</span>
            <div className="dashboard-expense-meta">
              <CurrencyDisplay amount={e.amount} currency={e.currency} />
              <StatusBadge
                tone={
                  e.status === "reimbursed"
                    ? "success"
                    : e.status === "rejected"
                      ? "error"
                      : "pending"
                }
              >
                {toSentenceCase(e.status)}
              </StatusBadge>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function UpcomingShiftsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;

  if (data.upcomingShifts.length === 0) return null;

  return (
    <WidgetCard title={t('widget.upcomingShifts')} icon={<Clock size={14} />} viewAllHref="/scheduling">
      <ul className="dashboard-widget-list">
        {data.upcomingShifts.map((s) => (
          <li key={s.id} className="dashboard-widget-list-item">
            <span className="numeric">{formatDate(s.date, locale)}</span>
            <span className="numeric">{s.startTime} – {s.endTime}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function PendingApprovalsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.pendingApprovals) return null;

  const { leave, expenses, timesheets } = data.pendingApprovals;

  return (
    <WidgetCard title={t('widget.pendingApprovals')} icon={<CheckCircle size={14} />} viewAllHref="/approvals">
      <div className="dashboard-approval-counters">
        <div className={`dashboard-approval-counter${leave > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{leave}</span>
          <span className="metric-label">{t('widget.leave')}</span>
        </div>
        <div className={`dashboard-approval-counter${expenses > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{expenses}</span>
          <span className="metric-label">{t('widget.expenses')}</span>
        </div>
        <div className={`dashboard-approval-counter${timesheets > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{timesheets}</span>
          <span className="metric-label">{t('widget.timesheets')}</span>
        </div>
      </div>
    </WidgetCard>
  );
}

function ExpiringDocumentsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.expiringDocuments || data.expiringDocuments.count === 0) return null;

  return (
    <WidgetCard title={t('widget.expiringDocuments')} icon={<AlertTriangle size={14} />} viewAllHref="/documents">
      <p className="settings-card-description numeric" style={{ marginBottom: "var(--space-2)" }}>
        {t('widget.documentsExpiring', { count: data.expiringDocuments.count })}
      </p>
      <ul className="dashboard-widget-list">
        {data.expiringDocuments.items.map((d) => (
          <li key={d.id} className="dashboard-widget-list-item">
            <span>{d.title}</span>
            <span className="settings-card-description numeric">{d.expiryDate}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function PayrollStatusWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;

  if (!data.payroll) return null;

  return (
    <WidgetCard title={t('widget.payrollStatus')} icon={<BarChart3 size={14} />} viewAllHref="/payroll">
      <div className="dashboard-widget-list">
        <div className="dashboard-widget-list-item">
          <span>{t('widget.lastRun')}</span>
          {data.payroll.lastRunStatus ? (
            <StatusBadge
              tone={
                data.payroll.lastRunStatus === "approved" || data.payroll.lastRunStatus === "completed"
                  ? "success"
                  : data.payroll.lastRunStatus === "processing"
                    ? "processing"
                    : "draft"
              }
            >
              {toSentenceCase(data.payroll.lastRunStatus)}
            </StatusBadge>
          ) : (
            <span className="settings-card-description">{t('widget.none')}</span>
          )}
        </div>
        {data.payroll.lastRunDate ? (
          <div className="dashboard-widget-list-item">
            <span>{t('widget.date')}</span>
            <span className="settings-card-description numeric">{formatRelativeTime(data.payroll.lastRunDate, locale)}</span>
          </div>
        ) : null}
      </div>
    </WidgetCard>
  );
}

function ExpensePipelineWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.expensePipeline) return null;

  const { pendingManager, pendingFinance, reimbursed } = data.expensePipeline;

  return (
    <WidgetCard title={t('widget.expensePipeline')} icon={<Receipt size={14} />}>
      <div className="dashboard-pipeline">
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{pendingManager}</span>
          <span className="metric-label">{t('widget.pendingManager')}</span>
        </div>
        <ChevronRight size={14} className="dashboard-pipeline-arrow" />
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{pendingFinance}</span>
          <span className="metric-label">{t('widget.pendingFinance')}</span>
        </div>
        <ChevronRight size={14} className="dashboard-pipeline-arrow" />
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{reimbursed}</span>
          <span className="metric-label">{t('widget.reimbursed')}</span>
        </div>
      </div>
    </WidgetCard>
  );
}

function ComplianceHealthWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.complianceHealth) return null;

  const { completed, inProgress, overdue } = data.complianceHealth;
  const total = completed + inProgress + overdue;

  return (
    <WidgetCard title={t('widget.complianceHealth')} icon={<ShieldCheck size={14} />} viewAllHref="/compliance">
      {total === 0 ? (
        <p className="settings-card-description">{t('widget.noDeadlines')}</p>
      ) : (
        <div className="dashboard-compliance-bars">
          {completed > 0 ? (
            <div className="dashboard-compliance-row">
              <span>{t('widget.completed')}</span>
              <div className="dashboard-compliance-bar-track">
                <span
                  className="dashboard-compliance-bar-fill dashboard-compliance-bar-success"
                  style={{ width: `${(completed / total) * 100}%` }}
                />
              </div>
              <span className="numeric">{completed}</span>
            </div>
          ) : null}
          {inProgress > 0 ? (
            <div className="dashboard-compliance-row">
              <span>{t('widget.inProgress')}</span>
              <div className="dashboard-compliance-bar-track">
                <span
                  className="dashboard-compliance-bar-fill dashboard-compliance-bar-info"
                  style={{ width: `${(inProgress / total) * 100}%` }}
                />
              </div>
              <span className="numeric">{inProgress}</span>
            </div>
          ) : null}
          {overdue > 0 ? (
            <div className="dashboard-compliance-row">
              <span>{t('widget.overdue')}</span>
              <div className="dashboard-compliance-bar-track">
                <span
                  className="dashboard-compliance-bar-fill dashboard-compliance-bar-error"
                  style={{ width: `${(overdue / total) * 100}%` }}
                />
              </div>
              <span className="numeric">{overdue}</span>
            </div>
          ) : null}
        </div>
      )}
    </WidgetCard>
  );
}

function AuditLogWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;

  if (!data.recentAuditLog || data.recentAuditLog.length === 0) return null;

  return (
    <WidgetCard title={t('widget.recentAuditActivity')} icon={<Activity size={14} />} viewAllHref="/settings?tab=audit">
      <ul className="dashboard-audit-list">
        {data.recentAuditLog.map((entry) => (
          <li key={entry.id} className="dashboard-audit-item">
            <span className="dashboard-audit-actor">{entry.actorName}</span>
            <span className="dashboard-audit-action">{entry.action}</span>
            <span className="dashboard-audit-table">{entry.tableName}</span>
            <time className="settings-card-description">{formatRelativeTime(entry.timestamp, locale)}</time>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function PendingDecisionsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const queryClient = useQueryClient();
  const items = data.pendingApprovalItems;

  const handleApprove = useCallback(
    async (id: string) => {
      const item = items?.find((i) => i.id === id);
      if (!item) return;

      const endpoint =
        item.type === "leave"
          ? `/api/v1/time-off/requests/${id}`
          : `/api/v1/expenses/${id}`;

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          (payload as { error?: { message?: string } } | null)?.error?.message ??
            t('widget.failedApprove')
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    [items, queryClient, t]
  );

  const handleDecline = useCallback(
    async (id: string, reason?: string) => {
      const item = items?.find((i) => i.id === id);
      if (!item) return;

      const endpoint =
        item.type === "leave"
          ? `/api/v1/time-off/requests/${id}`
          : `/api/v1/expenses/${id}`;

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          ...(reason ? { rejectionReason: reason } : {}),
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          (payload as { error?: { message?: string } } | null)?.error?.message ??
            t('widget.failedDecline')
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    [items, queryClient, t]
  );

  if (!items || items.length === 0) return null;

  return (
    <WidgetCard
      title={t('widget.pendingDecisions')}
      icon={<CheckCircle size={14} />}
      viewAllHref="/approvals"
      fullWidth
    >
      <div className="decision-cards-section">
        {items.map((item) => (
          <DecisionCard
            key={item.id}
            id={item.id}
            type={item.type}
            title={item.title}
            subtitle={item.subtitle}
            detail={item.detail}
            date={item.date}
            onApprove={handleApprove}
            onDecline={handleDecline}
          />
        ))}
      </div>
    </WidgetCard>
  );
}

/* ══════════════════════════════════════════════
   GREETING CARD SWITCH
   ══════════════════════════════════════════════ */

function GreetingCard({ data }: { data: DashboardResponseData }) {
  switch (data.persona) {
    case "new_hire":
      return <NewHireGreeting data={data} />;
    case "employee":
      return <EmployeeGreeting data={data} />;
    case "manager":
      return <ManagerGreeting data={data} />;
    case "hr_admin":
      return <HrAdminGreeting data={data} />;
    case "finance_admin":
      return <FinanceAdminGreeting data={data} />;
    case "super_admin":
      return <SuperAdminGreeting data={data} />;
    default:
      return <EmployeeGreeting data={data} />;
  }
}

/* ══════════════════════════════════════════════
   WIDGET GRID
   ══════════════════════════════════════════════ */

function WidgetGrid({ data }: { data: DashboardResponseData }) {
  return (
    <motion.div
      className="dashboard-widget-grid"
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
    >
      {/* Universal widgets (all roles) */}
      <WidgetErrorBoundary title="Announcements">
        <AnnouncementsWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Team on leave today">
        <TeamOnLeaveWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Upcoming holidays">
        <UpcomingHolidaysWidget data={data} />
      </WidgetErrorBoundary>

      {/* Employee+ widgets */}
      <WidgetErrorBoundary title="My leave balance">
        <LeaveBalanceWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Recent expenses">
        <RecentExpensesWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Upcoming shifts">
        <UpcomingShiftsWidget data={data} />
      </WidgetErrorBoundary>

      {/* Manager+ widgets */}
      <WidgetErrorBoundary title="Pending approvals">
        <PendingApprovalsWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Pending decisions">
        <PendingDecisionsWidget data={data} />
      </WidgetErrorBoundary>

      {/* HR Admin+ widgets */}
      <WidgetErrorBoundary title="Expiring documents">
        <ExpiringDocumentsWidget data={data} />
      </WidgetErrorBoundary>

      {/* Finance Admin+ widgets */}
      <WidgetErrorBoundary title="Payroll status">
        <PayrollStatusWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Expense pipeline">
        <ExpensePipelineWidget data={data} />
      </WidgetErrorBoundary>

      {/* Super Admin widgets */}
      <WidgetErrorBoundary title="Compliance health">
        <ComplianceHealthWidget data={data} />
      </WidgetErrorBoundary>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════ */

function DashboardContent() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const dashboardQuery = useDashboard();

  if (dashboardQuery.isPending) {
    return <DashboardSkeleton />;
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <EmptyState
        title={t('unavailable')}
        description={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : t('unableToLoad')
        }
        ctaLabel={tCommon('retry')}
        ctaHref="/dashboard"
      />
    );
  }

  const data = dashboardQuery.data;
  const showHealthAlerts =
    (data.persona === "super_admin" || data.persona === "hr_admin") &&
    data.healthAlerts &&
    data.healthAlerts.length > 0;
  const onboardingProgress = data.onboardingProgress;
  const shouldShowOnboardingBanner = data.persona === "new_hire" && onboardingProgress;
  const shouldShowManagerOnboarding =
    data.persona === "manager" &&
    Array.isArray(data.managerOnboarding) &&
    data.managerOnboarding.length > 0;
  const onboardingProgressPercent =
    onboardingProgress && onboardingProgress.tasksTotal > 0
      ? Math.round((onboardingProgress.tasksCompleted / onboardingProgress.tasksTotal) * 100)
      : 0;

  return (
    <div className="home-page">
      {data.persona === "super_admin" && <SetupChecklist />}
      {shouldShowOnboardingBanner ? (
        <OnboardingBanner
          progressPercent={onboardingProgressPercent}
          totalTasks={onboardingProgress.tasksTotal}
          completedTasks={onboardingProgress.tasksCompleted}
        />
      ) : null}
      <GreetingCard data={data} />
      {shouldShowManagerOnboarding ? (
        <ManagerOnboardingWidget reports={data.managerOnboarding!} />
      ) : null}
      {showHealthAlerts ? <HealthAlerts alerts={data.healthAlerts!} /> : null}
      <WidgetGrid data={data} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   ROOT EXPORT
   ══════════════════════════════════════════════ */

export function DashboardClient() {
  return <DashboardContent />;
}
