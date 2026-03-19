"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

type AppLocale = "en" | "fr";

import { DecisionCard } from "../../../components/dashboard/decision-card";
import { DashboardSkeleton } from "../../../components/dashboard/dashboard-skeleton";
import { HealthAlerts } from "../../../components/dashboard/health-alerts";
import { ManagerOnboardingWidget, OnboardingBanner } from "../../../components/dashboard/onboarding-banner";
import { PasskeyNudgeBanner } from "../../../components/dashboard/passkey-nudge-banner";
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
  Activity,
  Banknote,
  CircleDot,
  History,
  Zap,
  Ban
} from "lucide-react";

/* ── Greeting helpers ── */

function greetingIcon(tod: "morning" | "afternoon" | "evening") {
  if (tod === "morning") return <Sunrise size={16} />;
  if (tod === "afternoon") return <Sun size={16} />;
  return <Sunset size={16} />;
}

/* ══════════════════════════════════════════════
   GREETING HERO — clean, minimal for all roles
   ══════════════════════════════════════════════ */

function GreetingHero({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  const isNewHire = data.persona === "new_hire";

  return (
    <section className="home-welcome-hero dashboard-fade-in">
      <div className="home-welcome-content">
        {!isNewHire ? (
          <p className="home-welcome-eyebrow">
            {greetingIcon(data.greeting.timeOfDay)} {t(`greeting.${data.greeting.timeOfDay}` as never)}
          </p>
        ) : null}

        <h1 className="home-welcome-title">
          {isNewHire
            ? t('newHire.welcome', { org: data.org?.name ?? t('newHire.yourTeam'), firstName: data.greeting.firstName })
            : `${data.greeting.firstName}.`
          }
        </h1>

        {isNewHire && data.org?.description ? (
          <p className="home-welcome-subtitle">{data.org.description}</p>
        ) : null}

        {!isNewHire && data.persona === "employee" && (() => {
          const annualLeave = data.leaveBalance?.byType.find(
            (b) => b.leaveType.toLowerCase().includes("annual") || b.leaveType.toLowerCase().includes("vacation")
          );
          const totalLeave = data.leaveBalance?.totalAvailable ?? 0;
          if (annualLeave) {
            return <p className="home-welcome-subtitle">{t('employee.annualLeaveAvailable', { count: annualLeave.available })}</p>;
          }
          if (totalLeave > 0) {
            return <p className="home-welcome-subtitle">{t('employee.leaveAvailable', { count: totalLeave })}</p>;
          }
          return null;
        })()}

        {isNewHire && data.managerInfo ? (
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
    </section>
  );
}

/* ══════════════════════════════════════════════
   QUICK ACTIONS — compact pill row
   ══════════════════════════════════════════════ */

function QuickActionsRow() {
  const t = useTranslations('dashboard');
  return (
    <div className="home-quick-actions" role="list" aria-label={t('quickActions.ariaLabel')}>
      <Link href="/time-off" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Calendar size={16} /></span>
        <span className="home-quick-action-label">{t('quickActions.requestTimeOff')}</span>
      </Link>
      <Link href="/expenses" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Receipt size={16} /></span>
        <span className="home-quick-action-label">{t('quickActions.submitExpense')}</span>
      </Link>
      <Link href="/me/pay?tab=payslips" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><FileText size={16} /></span>
        <span className="home-quick-action-label">{t('quickActions.viewPayslips')}</span>
      </Link>
    </div>
  );
}

/* ══════════════════════════════════════════════
   METRICS STRIP — extracted from admin heroes
   ══════════════════════════════════════════════ */

function HrMetricsStrip({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const hc = data.headcount;
  const ob = data.onboardingStatus;
  const cd = data.complianceDeadlines;
  const rc = data.activeReviewCycles;

  return (
    <section className="dashboard-metrics-strip">
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
    </section>
  );
}

function FinanceMetricsStrip({ data }: { data: DashboardResponseData }) {
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

  return (
    <section className="dashboard-metrics-strip">
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
    </section>
  );
}

function SuperAdminMetricsStrip({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const hc = data.headcount;
  const approvals = data.pendingApprovals;
  const payroll = data.payroll;
  const cd = data.complianceDeadlines;

  return (
    <section className="dashboard-metrics-strip">
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
    </section>
  );
}

/* ══════════════════════════════════════════════
   ADMIN CTA BANNERS — separated from hero
   ══════════════════════════════════════════════ */

function HrAdminCTA({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const cd = data.complianceDeadlines;
  const ob = data.onboardingStatus;

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
    <div className="dashboard-action-banner">
      <span className="settings-card-description">
        {cd && cd.overdue > 0
          ? t('hrAdmin.overdue', { count: cd.overdue })
          : t('hrAdmin.viewAnalytics')}
      </span>
      <Link href={ctaHref} className="button button-accent">
        {ctaLabel} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function FinanceAdminCTA({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const expenses = data.pendingExpenseApprovals;

  let ctaHref = "/payroll";
  let ctaLabel = t('financeAdmin.goToPayroll');
  if (expenses && expenses.financeStage > 0) {
    ctaHref = "/approvals";
    ctaLabel = t('financeAdmin.reviewExpenses');
  }

  return (
    <div className="dashboard-action-banner">
      <span className="settings-card-description">
        {expenses && expenses.financeStage > 0
          ? t('financeAdmin.pendingExpenseApprovals')
          : t('financeAdmin.goToPayroll')}
      </span>
      <Link href={ctaHref} className="button button-accent">
        {ctaLabel} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function ManagerApprovalBanner({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const approvals = data.pendingApprovals;

  if (!approvals || approvals.total === 0) {
    return (
      <div className="dashboard-all-caught-up">
        <CheckCircle size={18} />
        <span>{t('manager.allCaughtUp')}</span>
      </div>
    );
  }

  return (
    <div className="dashboard-approval-callout">
      <div className="dashboard-approval-callout-body">
        <p className="dashboard-approval-count numeric">
          {t('manager.itemsWaiting', { count: approvals.total })}
        </p>
        <p className="settings-card-description numeric">
          {approvals.leave > 0 ? t('manager.leaveCount', { count: approvals.leave }) : ""}
          {approvals.leave > 0 && approvals.expenses > 0 ? ", " : ""}
          {approvals.expenses > 0 ? t('manager.expenseCount', { count: approvals.expenses }) : ""}
        </p>
      </div>
      <Link href="/approvals" className="button button-accent">
        {t('manager.reviewNow')} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

/* ══════════════════════════════════════════════
   EXPENSE SNAPSHOT — super admin, below metrics
   ══════════════════════════════════════════════ */

function ExpenseSnapshot({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const expenseSpendSummary = data.expenseSpendSummary;

  if (!expenseSpendSummary) return null;

  return (
    <article className="metric-card oversight-expense-snapshot">
      <div className="oversight-expense-header">
        <p className="metric-label">{t('superAdmin.expenseSnapshot')}</p>
        {expenseSpendSummary.mixedCurrency ? (
          <span className="settings-card-description">{t('superAdmin.primaryCurrencyView')}</span>
        ) : null}
      </div>
      <div className="dashboard-pipeline oversight-expense-pipeline">
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
    <article
      className={`home-card dashboard-widget${fullWidth ? " dashboard-widget-full" : ""}`}
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
    </article>
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
            <span className="numeric">{s.startTime} - {s.endTime}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function PendingApprovalsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.pendingApprovals) return null;

  const { leave, expenses } = data.pendingApprovals;

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
      </div>
    </WidgetCard>
  );
}

function ExpiringDocumentsWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');

  if (!data.expiringDocuments || data.expiringDocuments.count === 0) return null;

  return (
    <WidgetCard title={t('widget.expiringDocuments')} icon={<AlertTriangle size={14} />} viewAllHref="/documents">
      <p className="settings-card-description numeric oversight-expiring-docs-desc">
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
   FINANCE OVERSIGHT — FINANCE_APPROVER + SUPER_ADMIN
   ══════════════════════════════════════════════ */

function FinanceOversightSection({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const locale = useLocale() as AppLocale;
  const oversight = data.financeOversight;

  if (!oversight) return null;

  const totalItems =
    oversight.pendingPayrollApprovals.length +
    oversight.pendingSalaryApprovals.count +
    oversight.historicalAwaitingAction.length +
    oversight.completionGaps.length +
    oversight.payoutBlockers.length +
    oversight.activeCycles.length;

  return (
    <section className="oversight-section" aria-label={td('financeOversight.title')}>
      <h2 className="oversight-section-title">
        <ShieldCheck size={16} /> {td('financeOversight.title')}
      </h2>

      {totalItems === 0 ? (
        <div className="oversight-all-clear">
          <CheckCircle size={18} />
          <span>{td('financeOversight.noOversightItems')}</span>
        </div>
      ) : (
        <div className="oversight-grid">
          {/* 1. Awaiting Approval */}
          {oversight.pendingPayrollApprovals.length > 0 ? (
            <article className="oversight-card oversight-card-urgent">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-urgent">
                  <CheckCircle size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.awaitingApproval')}</h3>
                <span className="oversight-card-count">{oversight.pendingPayrollApprovals.length}</span>
              </header>
              <ul className="oversight-card-list">
                {oversight.pendingPayrollApprovals.map((run) => (
                  <li key={run.id} className="oversight-card-item">
                    <span className="oversight-item-period">{run.payPeriod}</span>
                    <span className="oversight-item-meta settings-card-description">
                      {td('financeOversight.employees', { count: run.employeeCount })}
                    </span>
                    <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-accent button-sm">
                      {td('financeOversight.approveRun')}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {/* 2. Salary Changes Pending */}
          {oversight.pendingSalaryApprovals.count > 0 ? (
            <article className="oversight-card oversight-card-attention">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-attention">
                  <Banknote size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.salaryChangesPending')}</h3>
                <span className="oversight-card-count">{oversight.pendingSalaryApprovals.count}</span>
              </header>
              <p className="oversight-card-description settings-card-description">
                {td('financeOversight.salaryChangesPendingDesc', { count: oversight.pendingSalaryApprovals.count })}
              </p>
              <Link href="/admin/compensation" className="oversight-item-action button button-subtle button-sm">
                {td('financeOversight.viewSalary')} <ChevronRight size={12} />
              </Link>
            </article>
          ) : null}

          {/* 3. Historical Runs Awaiting Action */}
          {oversight.historicalAwaitingAction.length > 0 ? (
            <article className="oversight-card">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-info">
                  <History size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.historicalAwaitingAction')}</h3>
                <span className="oversight-card-count">{oversight.historicalAwaitingAction.length}</span>
              </header>
              <ul className="oversight-card-list">
                {oversight.historicalAwaitingAction.map((run) => (
                  <li key={run.id} className="oversight-card-item">
                    <span className="oversight-item-period">{run.payPeriod}</span>
                    <StatusBadge tone={run.nextStep === "publish" ? "success" : run.nextStep === "authorize" ? "processing" : "draft"}>
                      {td('financeOversight.nextStep', { step: toSentenceCase(run.nextStep) })}
                    </StatusBadge>
                    <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-subtle button-sm">
                      {td('financeOversight.viewRun')}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {/* 4. Completion Gaps */}
          {oversight.completionGaps.length > 0 ? (
            <article className="oversight-card oversight-card-warning">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-warning">
                  <CircleDot size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.completionGaps')}</h3>
                <span className="oversight-card-count">{oversight.completionGaps.length}</span>
              </header>
              <ul className="oversight-card-list">
                {oversight.completionGaps.map((run) => (
                  <li key={run.id} className="oversight-card-item">
                    <span className="oversight-item-period">{run.payPeriod}</span>
                    <StatusBadge tone={run.status === "approved" ? "success" : run.status === "processing" ? "processing" : "draft"}>
                      {toSentenceCase(run.status)}
                    </StatusBadge>
                    <span className="oversight-item-meta settings-card-description">
                      {td('financeOversight.stuckSince', { date: formatRelativeTime(run.createdAt, locale) })}
                    </span>
                    <Link href={`/payroll/runs/${run.id}`} className="oversight-item-action button button-subtle button-sm">
                      {td('financeOversight.viewRun')}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {/* 5. Payout Blockers */}
          {oversight.payoutBlockers.length > 0 ? (
            <article className="oversight-card oversight-card-danger">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-danger">
                  <Ban size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.payoutBlockers')}</h3>
                <span className="oversight-card-count">{oversight.payoutBlockers.length}</span>
              </header>
              <ul className="oversight-card-list">
                {oversight.payoutBlockers.map((blocker) => (
                  <li key={blocker.runId} className="oversight-card-item">
                    <span className="oversight-item-meta settings-card-description">
                      {td('financeOversight.flaggedItems', { count: blocker.flaggedCount })}
                    </span>
                    <Link href={`/payroll/runs/${blocker.runId}`} className="oversight-item-action button button-subtle button-sm">
                      {td('financeOversight.viewRun')}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {/* 6. Active Payout Cycles */}
          {oversight.activeCycles.length > 0 ? (
            <article className="oversight-card">
              <header className="oversight-card-header">
                <span className="oversight-card-icon oversight-icon-info">
                  <Zap size={14} />
                </span>
                <h3 className="oversight-card-title">{td('financeOversight.activeCycles')}</h3>
                <span className="oversight-card-count">{oversight.activeCycles.length}</span>
              </header>
              <ul className="oversight-card-list">
                {oversight.activeCycles.map((cycle) => (
                  <li key={cycle.cycleId} className="oversight-card-item">
                    <span className="oversight-item-period">{cycle.label ?? cycle.payPeriod}</span>
                    <StatusBadge tone={cycle.status === "processing" ? "processing" : cycle.status === "ready" ? "pending" : "draft"}>
                      {toSentenceCase(cycle.status)}
                    </StatusBadge>
                    <span className="oversight-item-meta settings-card-description">
                      <CurrencyDisplay amount={cycle.totalNet} currency={cycle.currency} />
                    </span>
                    <Link href={`/payroll/runs/${cycle.runId}`} className="oversight-item-action button button-subtle button-sm">
                      {td('financeOversight.viewRun')}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════
   AUDIT FEED WIDGET — for super admin
   ══════════════════════════════════════════════ */

function AuditFeedWidget({ data }: { data: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  if (!data.recentAuditLog || data.recentAuditLog.length === 0) return null;

  return (
    <WidgetCard
      title={t('superAdmin.recentAuditLog')}
      icon={<Activity size={14} />}
      viewAllHref="/settings?tab=audit"
      fullWidth
    >
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
    </WidgetCard>
  );
}

/* ══════════════════════════════════════════════
   WIDGET GRID
   ══════════════════════════════════════════════ */

function WidgetGrid({ data }: { data: DashboardResponseData }) {
  return (
    <div className="dashboard-widget-grid">
      {/* Manager+ action widgets first */}
      <WidgetErrorBoundary title="Pending decisions">
        <PendingDecisionsWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Pending approvals">
        <PendingApprovalsWidget data={data} />
      </WidgetErrorBoundary>

      {/* Employee personal widgets */}
      <WidgetErrorBoundary title="My leave balance">
        <LeaveBalanceWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Recent expenses">
        <RecentExpensesWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Upcoming shifts">
        <UpcomingShiftsWidget data={data} />
      </WidgetErrorBoundary>

      {/* Universal informational widgets */}
      <WidgetErrorBoundary title="Announcements">
        <AnnouncementsWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Team on leave today">
        <TeamOnLeaveWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Upcoming holidays">
        <UpcomingHolidaysWidget data={data} />
      </WidgetErrorBoundary>

      {/* Admin-specific widgets */}
      <WidgetErrorBoundary title="Expiring documents">
        <ExpiringDocumentsWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Payroll status">
        <PayrollStatusWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Expense pipeline">
        <ExpensePipelineWidget data={data} />
      </WidgetErrorBoundary>
      <WidgetErrorBoundary title="Compliance health">
        <ComplianceHealthWidget data={data} />
      </WidgetErrorBoundary>

      {/* Super admin audit feed */}
      <WidgetErrorBoundary title="Audit feed">
        <AuditFeedWidget data={data} />
      </WidgetErrorBoundary>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════ */

function DashboardContent({ initialData }: { initialData?: DashboardResponseData }) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const dashboardQuery = useDashboard(initialData);

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
      {/* Setup checklist for super admin */}
      {data.persona === "super_admin" && <SetupChecklist />}

      {/* Onboarding banner for new hires */}
      {shouldShowOnboardingBanner ? (
        <OnboardingBanner
          progressPercent={onboardingProgressPercent}
          totalTasks={onboardingProgress.tasksTotal}
          completedTasks={onboardingProgress.tasksCompleted}
        />
      ) : null}

      {/* Clean greeting hero — all roles */}
      <GreetingHero data={data} />

      {/* Role-specific metrics strip — separated from hero */}
      {data.persona === "hr_admin" && <HrMetricsStrip data={data} />}
      {(data.persona === "finance_admin" || data.persona === "finance_approver") && <FinanceMetricsStrip data={data} />}
      {data.persona === "super_admin" && <SuperAdminMetricsStrip data={data} />}

      {/* Finance oversight — approver + super admin only */}
      {(data.persona === "finance_approver" || data.persona === "super_admin") && (
        <WidgetErrorBoundary title="Finance oversight">
          <FinanceOversightSection data={data} />
        </WidgetErrorBoundary>
      )}

      {/* Expense snapshot for super admin */}
      {data.persona === "super_admin" && <ExpenseSnapshot data={data} />}

      {/* Quick actions for employee/manager */}
      {(data.persona === "employee" || data.persona === "manager") && <QuickActionsRow />}

      {/* Manager approval banner */}
      {data.persona === "manager" && <ManagerApprovalBanner data={data} />}

      {/* Admin CTA banners */}
      {data.persona === "hr_admin" && <HrAdminCTA data={data} />}
      {(data.persona === "finance_admin" || data.persona === "finance_approver") && <FinanceAdminCTA data={data} />}

      <PasskeyNudgeBanner />

      {/* Manager onboarding widget */}
      {shouldShowManagerOnboarding ? (
        <ManagerOnboardingWidget reports={data.managerOnboarding!} />
      ) : null}

      {/* Health alerts for admins */}
      {showHealthAlerts ? <HealthAlerts alerts={data.healthAlerts!} /> : null}

      {/* Widget grid */}
      <WidgetGrid data={data} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   ROOT EXPORT
   ══════════════════════════════════════════════ */

export function DashboardClient({ initialData }: { initialData?: DashboardResponseData }) {
  return <DashboardContent initialData={initialData} />;
}
