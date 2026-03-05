"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { DashboardSkeleton } from "../../../components/dashboard/dashboard-skeleton";
import { WidgetErrorBoundary } from "../../../components/dashboard/widget-error-boundary";
import { EmptyState } from "../../../components/shared/empty-state";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { useDashboard } from "../../../hooks/use-dashboard";
import { formatDate, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
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
  Users,
  AlertTriangle,
  ArrowRight,
  Megaphone,
  Palmtree,
  ShieldCheck,
  BookOpen,
  BarChart3,
  ChevronRight,
  Activity
} from "lucide-react";

/* ── Animation ── */

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 18 } }
};

/* ── Greeting helpers ── */

function greetingIcon(tod: "morning" | "afternoon" | "evening") {
  if (tod === "morning") return <Sunrise size={18} />;
  if (tod === "afternoon") return <Sun size={18} />;
  return <Sunset size={18} />;
}

function greetingText(tod: "morning" | "afternoon" | "evening"): string {
  if (tod === "morning") return "Good morning";
  if (tod === "afternoon") return "Good afternoon";
  return "Good evening";
}

/* ── Quick Actions Row ── */

function QuickActionsRow({ hasTimePolicy }: { hasTimePolicy: boolean }) {
  return (
    <div className="home-quick-actions" role="list" aria-label="Quick actions">
      <Link href="/time-off" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Calendar size={20} /></span>
        <span className="home-quick-action-label">Request time off</span>
      </Link>
      <Link href="/expenses" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><Receipt size={20} /></span>
        <span className="home-quick-action-label">Submit expense</span>
      </Link>
      <Link href="/me/pay?tab=payslips" className="home-quick-action-card" role="listitem">
        <span className="home-quick-action-icon"><FileText size={20} /></span>
        <span className="home-quick-action-label">View payslips</span>
      </Link>
      {hasTimePolicy ? (
        <Link href="/time-attendance" className="home-quick-action-card" role="listitem">
          <span className="home-quick-action-icon"><Clock size={20} /></span>
          <span className="home-quick-action-label">Clock in</span>
        </Link>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════
   GREETING CARDS — one per persona
   ══════════════════════════════════════════════ */

function NewHireGreeting({ data }: { data: DashboardResponseData }) {
  const progress = data.onboardingProgress;
  const progressPct = progress && progress.tasksTotal > 0
    ? Math.round((progress.tasksCompleted / progress.tasksTotal) * 100)
    : 0;

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <h1 className="home-welcome-title">
          Welcome to {data.org?.name ?? "your team"}, {data.greeting.firstName}.
        </h1>
        {data.org?.description ? (
          <p className="home-welcome-subtitle">{data.org.description}</p>
        ) : null}

        {data.managerInfo ? (
          <div className="dashboard-manager-callout">
            {data.managerInfo.avatarUrl ? (
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
              <span className="settings-card-description">Your manager is</span>
              <strong>{data.managerInfo.name}</strong>
              {data.managerInfo.title ? (
                <span className="settings-card-description">, {data.managerInfo.title}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        {progress ? (
          <div className="dashboard-onboarding-progress">
            <p className="settings-card-description numeric">
              Onboarding: {progress.tasksCompleted} of {progress.tasksTotal} tasks complete
            </p>
            <div className="onboarding-banner-progress-track" aria-hidden="true">
              <span
                className="onboarding-banner-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <Link href="/me/onboarding" className="button button-accent">
              View your onboarding checklist
            </Link>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

function EmployeeGreeting({ data }: { data: DashboardResponseData }) {
  const totalLeave = data.leaveBalance?.totalAvailable ?? 0;
  const annualLeave = data.leaveBalance?.byType.find(
    (b) => b.leaveType.toLowerCase().includes("annual") || b.leaveType.toLowerCase().includes("vacation")
  );

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {greetingText(data.greeting.timeOfDay)}
        </p>
        <h1 className="home-welcome-title">
          {greetingText(data.greeting.timeOfDay)}, {data.greeting.firstName}.
        </h1>
        {annualLeave ? (
          <p className="home-welcome-subtitle">
            You have <strong className="numeric">{annualLeave.available}</strong> days of annual leave available.
          </p>
        ) : totalLeave > 0 ? (
          <p className="home-welcome-subtitle">
            You have <strong className="numeric">{totalLeave}</strong> days of leave available.
          </p>
        ) : null}
      </div>
      <QuickActionsRow hasTimePolicy={data.hasTimePolicy} />
    </motion.section>
  );
}

function ManagerGreeting({ data }: { data: DashboardResponseData }) {
  const approvals = data.pendingApprovals;

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {greetingText(data.greeting.timeOfDay)}
        </p>
        <h1 className="home-welcome-title">
          {greetingText(data.greeting.timeOfDay)}, {data.greeting.firstName}.
        </h1>

        {approvals && approvals.total > 0 ? (
          <div className="dashboard-approval-callout">
            <div className="dashboard-approval-callout-body">
              <p className="dashboard-approval-count numeric">
                {approvals.total} {approvals.total === 1 ? "item" : "items"} waiting for your approval
              </p>
              <p className="settings-card-description numeric">
                {approvals.leave > 0 ? `${approvals.leave} leave` : ""}
                {approvals.leave > 0 && approvals.expenses > 0 ? ", " : ""}
                {approvals.expenses > 0 ? `${approvals.expenses} expense` : ""}
                {(approvals.leave > 0 || approvals.expenses > 0) && approvals.timesheets > 0 ? ", " : ""}
                {approvals.timesheets > 0 ? `${approvals.timesheets} timesheet` : ""}
              </p>
            </div>
            <Link href="/approvals" className="button button-accent">
              Review now <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="dashboard-all-caught-up">
            <CheckCircle size={20} />
            <span>All caught up.</span>
          </div>
        )}
      </div>
      <QuickActionsRow hasTimePolicy={data.hasTimePolicy} />
    </motion.section>
  );
}

function HrAdminGreeting({ data }: { data: DashboardResponseData }) {
  const hc = data.headcount;
  const ob = data.onboardingStatus;
  const cd = data.complianceDeadlines;
  const rc = data.activeReviewCycles;

  let ctaHref = "/analytics";
  let ctaLabel = "View analytics";
  if (cd && cd.overdue > 0) {
    ctaHref = "/compliance";
    ctaLabel = "Review compliance";
  } else if (cd && cd.thisMonth > 0) {
    ctaHref = "/compliance";
    ctaLabel = "View compliance";
  } else if (ob && ob.overdue > 0) {
    ctaHref = "/onboarding";
    ctaLabel = "View onboarding";
  }

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {greetingText(data.greeting.timeOfDay)}
        </p>
        <h1 className="home-welcome-title">
          {greetingText(data.greeting.timeOfDay)}, {data.greeting.firstName}.
        </h1>
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <p className="metric-label">Active employees</p>
          <p className="metric-value numeric">{hc?.total ?? 0}</p>
          {hc && hc.delta30d > 0 ? (
            <p className="metric-description numeric">+{hc.delta30d} new this month</p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">In onboarding</p>
          <p className="metric-value numeric">{ob?.active ?? 0}</p>
          {ob && ob.overdue > 0 ? (
            <p className="metric-description" style={{ color: "var(--color-error)" }}>
              {ob.overdue} overdue
            </p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">Compliance this month</p>
          <p className="metric-value numeric">{cd?.thisMonth ?? 0}</p>
          {cd && cd.overdue > 0 ? (
            <p className="metric-description" style={{ color: "var(--color-error)" }}>
              {cd.overdue} overdue
            </p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">Active review cycles</p>
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
  let ctaLabel = "Go to payroll";
  if (expenses && expenses.financeStage > 0) {
    ctaHref = "/approvals";
    ctaLabel = "Review expenses";
  }

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {greetingText(data.greeting.timeOfDay)}
        </p>
        <h1 className="home-welcome-title">
          {greetingText(data.greeting.timeOfDay)}, {data.greeting.firstName}.
        </h1>
      </div>
      <div className="dashboard-finance-summary">
        <article className="metric-card">
          <p className="metric-label">Last payroll run</p>
          <div className="dashboard-finance-status-row">
            {payroll?.lastRunStatus ? (
              <StatusBadge tone={statusTone}>{toSentenceCase(payroll.lastRunStatus)}</StatusBadge>
            ) : (
              <span className="settings-card-description">No runs yet</span>
            )}
            {payroll?.lastRunDate ? (
              <span className="settings-card-description numeric">
                {formatRelativeTime(payroll.lastRunDate)}
              </span>
            ) : null}
          </div>
        </article>
        <article className="metric-card">
          <p className="metric-label">Pending expense approvals (finance)</p>
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
  const hc = data.headcount;
  const approvals = data.pendingApprovals;
  const payroll = data.payroll;
  const cd = data.complianceDeadlines;

  return (
    <motion.section className="home-welcome-hero" {...fadeIn}>
      <div className="home-welcome-content">
        <p className="home-welcome-eyebrow">
          {greetingIcon(data.greeting.timeOfDay)} {greetingText(data.greeting.timeOfDay)}
        </p>
        <h1 className="home-welcome-title">
          {greetingText(data.greeting.timeOfDay)}, {data.greeting.firstName}.
        </h1>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <p className="metric-label">Headcount</p>
          <p className="metric-value numeric">{hc?.total ?? 0}</p>
          {hc && hc.delta30d > 0 ? (
            <p className="metric-description numeric">+{hc.delta30d} this month</p>
          ) : null}
        </article>
        <article className="metric-card">
          <p className="metric-label">Pending approvals</p>
          <p className="metric-value numeric">{approvals?.total ?? 0}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Last payroll</p>
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
            <p className="metric-value">—</p>
          )}
        </article>
        <article className="metric-card">
          <p className="metric-label">Compliance</p>
          {cd && cd.overdue > 0 ? (
            <p className="metric-value" style={{ color: "var(--color-error)" }}>
              <span className="numeric">{cd.overdue}</span> overdue
            </p>
          ) : (
            <p className="metric-value" style={{ color: "var(--color-success)" }}>
              On track
            </p>
          )}
        </article>
      </div>

      {data.recentAuditLog && data.recentAuditLog.length > 0 ? (
        <div className="dashboard-audit-feed">
          <div className="dashboard-audit-feed-header">
            <h3 className="section-title">
              <Activity size={14} /> Recent audit log
            </h3>
            <Link href="/settings?tab=audit" className="announcement-widget-link">
              View all <ChevronRight size={14} />
            </Link>
          </div>
          <ul className="dashboard-audit-list">
            {data.recentAuditLog.map((entry) => (
              <li key={entry.id} className="dashboard-audit-item">
                <span className="dashboard-audit-actor">{entry.actorName}</span>
                <span className="dashboard-audit-action">{entry.action}</span>
                <span className="dashboard-audit-table">{entry.tableName}</span>
                <time className="dashboard-audit-time settings-card-description">
                  {formatRelativeTime(entry.timestamp)}
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
            View all <ChevronRight size={14} />
          </Link>
        ) : null}
      </header>
      {children}
    </motion.article>
  );
}

function AnnouncementsWidget({ data }: { data: DashboardResponseData }) {
  if (data.announcements.length === 0) {
    return (
      <WidgetCard title="Announcements" icon={<Megaphone size={14} />} viewAllHref="/announcements">
        <p className="settings-card-description">No announcements yet.</p>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title="Announcements" icon={<Megaphone size={14} />} viewAllHref="/announcements">
      <ul className="dashboard-widget-list">
        {data.announcements.map((a) => (
          <li key={a.id} className="dashboard-widget-list-item">
            <p className="dashboard-widget-item-title">{a.title}</p>
            <time className="settings-card-description">{formatRelativeTime(a.createdAt)}</time>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function TeamOnLeaveWidget({ data }: { data: DashboardResponseData }) {
  return (
    <WidgetCard title="Team on leave today" icon={<Palmtree size={14} />}>
      {data.teamOnLeaveToday.length === 0 ? (
        <p className="settings-card-description">No one is on leave today.</p>
      ) : (
        <ul className="dashboard-widget-list">
          {data.teamOnLeaveToday.map((person) => (
            <li key={person.id} className="dashboard-widget-list-item">
              <span>{person.name}</span>
              <StatusBadge tone="info">{person.leaveType}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function UpcomingHolidaysWidget({ data }: { data: DashboardResponseData }) {
  if (data.upcomingHolidays.length === 0) return null;

  return (
    <WidgetCard title="Upcoming holidays" icon={<Calendar size={14} />}>
      <ul className="dashboard-widget-list">
        {data.upcomingHolidays.map((h, i) => (
          <li key={`${h.date}-${i}`} className="dashboard-widget-list-item">
            <span>{h.name}</span>
            <span className="settings-card-description numeric">{formatDate(h.date)}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function LeaveBalanceWidget({ data }: { data: DashboardResponseData }) {
  if (!data.leaveBalance || data.leaveBalance.byType.length === 0) return null;

  return (
    <WidgetCard title="My leave balance" icon={<Palmtree size={14} />}>
      <ul className="dashboard-widget-list">
        {data.leaveBalance.byType.map((b) => (
          <li key={b.leaveType} className="dashboard-widget-list-item">
            <span>{b.leaveType}</span>
            <span className="numeric">
              <strong>{b.available}</strong>/{b.allocated} days
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function RecentExpensesWidget({ data }: { data: DashboardResponseData }) {
  if (data.recentExpenses.length === 0) return null;

  return (
    <WidgetCard title="Recent expenses" icon={<Receipt size={14} />} viewAllHref="/expenses">
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
  if (data.upcomingShifts.length === 0) return null;

  return (
    <WidgetCard title="Upcoming shifts" icon={<Clock size={14} />} viewAllHref="/scheduling">
      <ul className="dashboard-widget-list">
        {data.upcomingShifts.map((s) => (
          <li key={s.id} className="dashboard-widget-list-item">
            <span className="numeric">{formatDate(s.date)}</span>
            <span className="numeric">{s.startTime} – {s.endTime}</span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function PendingApprovalsWidget({ data }: { data: DashboardResponseData }) {
  if (!data.pendingApprovals) return null;

  const { leave, expenses, timesheets } = data.pendingApprovals;

  return (
    <WidgetCard title="Pending approvals" icon={<CheckCircle size={14} />} viewAllHref="/approvals">
      <div className="dashboard-approval-counters">
        <div className={`dashboard-approval-counter${leave > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{leave}</span>
          <span className="metric-label">Leave</span>
        </div>
        <div className={`dashboard-approval-counter${expenses > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{expenses}</span>
          <span className="metric-label">Expenses</span>
        </div>
        <div className={`dashboard-approval-counter${timesheets > 5 ? " dashboard-approval-counter-alert" : ""}`}>
          <span className="metric-value numeric">{timesheets}</span>
          <span className="metric-label">Timesheets</span>
        </div>
      </div>
    </WidgetCard>
  );
}

function ExpiringDocumentsWidget({ data }: { data: DashboardResponseData }) {
  if (!data.expiringDocuments || data.expiringDocuments.count === 0) return null;

  return (
    <WidgetCard title="Expiring documents" icon={<AlertTriangle size={14} />} viewAllHref="/documents">
      <p className="settings-card-description numeric" style={{ marginBottom: "var(--space-2)" }}>
        {data.expiringDocuments.count} document{data.expiringDocuments.count !== 1 ? "s" : ""} expiring in next 30 days
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
  if (!data.payroll) return null;

  return (
    <WidgetCard title="Payroll status" icon={<BarChart3 size={14} />} viewAllHref="/payroll">
      <div className="dashboard-widget-list">
        <div className="dashboard-widget-list-item">
          <span>Last run</span>
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
            <span className="settings-card-description">None</span>
          )}
        </div>
        {data.payroll.lastRunDate ? (
          <div className="dashboard-widget-list-item">
            <span>Date</span>
            <span className="settings-card-description numeric">{formatRelativeTime(data.payroll.lastRunDate)}</span>
          </div>
        ) : null}
      </div>
    </WidgetCard>
  );
}

function ExpensePipelineWidget({ data }: { data: DashboardResponseData }) {
  if (!data.expensePipeline) return null;

  const { pendingManager, pendingFinance, reimbursed } = data.expensePipeline;

  return (
    <WidgetCard title="Expense pipeline" icon={<Receipt size={14} />}>
      <div className="dashboard-pipeline">
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{pendingManager}</span>
          <span className="metric-label">Pending manager</span>
        </div>
        <ChevronRight size={14} className="dashboard-pipeline-arrow" />
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{pendingFinance}</span>
          <span className="metric-label">Pending finance</span>
        </div>
        <ChevronRight size={14} className="dashboard-pipeline-arrow" />
        <div className="dashboard-pipeline-stage">
          <span className="metric-value numeric">{reimbursed}</span>
          <span className="metric-label">Reimbursed</span>
        </div>
      </div>
    </WidgetCard>
  );
}

function ComplianceHealthWidget({ data }: { data: DashboardResponseData }) {
  if (!data.complianceHealth) return null;

  const { completed, inProgress, overdue } = data.complianceHealth;
  const total = completed + inProgress + overdue;

  return (
    <WidgetCard title="Compliance health" icon={<ShieldCheck size={14} />} viewAllHref="/compliance">
      {total === 0 ? (
        <p className="settings-card-description">No deadlines this month.</p>
      ) : (
        <div className="dashboard-compliance-bars">
          {completed > 0 ? (
            <div className="dashboard-compliance-row">
              <span>Completed</span>
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
              <span>In progress</span>
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
              <span>Overdue</span>
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
  if (!data.recentAuditLog || data.recentAuditLog.length === 0) return null;

  return (
    <WidgetCard title="Recent audit activity" icon={<Activity size={14} />} viewAllHref="/settings?tab=audit">
      <ul className="dashboard-audit-list">
        {data.recentAuditLog.map((entry) => (
          <li key={entry.id} className="dashboard-audit-item">
            <span className="dashboard-audit-actor">{entry.actorName}</span>
            <span className="dashboard-audit-action">{entry.action}</span>
            <span className="dashboard-audit-table">{entry.tableName}</span>
            <time className="settings-card-description">{formatRelativeTime(entry.timestamp)}</time>
          </li>
        ))}
      </ul>
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

      {/* Manager+ widget */}
      <WidgetErrorBoundary title="Pending approvals">
        <PendingApprovalsWidget data={data} />
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
      <WidgetErrorBoundary title="Recent audit activity">
        <AuditLogWidget data={data} />
      </WidgetErrorBoundary>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════ */

function DashboardContent() {
  const dashboardQuery = useDashboard();

  if (dashboardQuery.isPending) {
    return <DashboardSkeleton />;
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Unable to load dashboard data."
        }
        ctaLabel="Retry"
        ctaHref="/dashboard"
      />
    );
  }

  const data = dashboardQuery.data;

  return (
    <div className="home-page">
      <GreetingCard data={data} />
      <WidgetGrid data={data} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   ROOT EXPORT
   ══════════════════════════════════════════════ */

export function DashboardClient() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}
