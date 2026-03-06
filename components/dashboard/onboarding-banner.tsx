import Link from "next/link";
import { StatusBadge } from "../shared/status-badge";
import type { DashboardManagerOnboardingItem } from "../../types/dashboard";

type OnboardingBannerProps = {
  progressPercent: number;
  totalTasks: number;
  completedTasks: number;
};

export function OnboardingBanner({
  progressPercent,
  totalTasks,
  completedTasks
}: OnboardingBannerProps) {
  const remainingTasks = Math.max(0, totalTasks - completedTasks);
  const safeProgress = Number.isFinite(progressPercent)
    ? Math.min(100, Math.max(0, progressPercent))
    : 0;

  return (
    <section className="onboarding-banner" aria-label="Onboarding progress">
      <div className="onboarding-banner-copy">
        <h2 className="section-title">Welcome to Crew Hub</h2>
        <p className="settings-card-description">
          You have <span className="numeric">{remainingTasks}</span> onboarding tasks remaining.
        </p>
        <p className="settings-card-description numeric">
          {completedTasks}/{totalTasks} complete ({safeProgress.toFixed(0)}%)
        </p>
      </div>

      <div className="onboarding-banner-actions">
        <div className="onboarding-banner-progress-track" aria-hidden="true">
          <span
            className="onboarding-banner-progress-fill"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
        <Link href="/me/onboarding" className="button button-accent">
          View Tasks
        </Link>
      </div>
    </section>
  );
}

type ManagerOnboardingWidgetProps = {
  reports: DashboardManagerOnboardingItem[];
};

function progressPercent(tasksCompleted: number, tasksTotal: number): number {
  if (tasksTotal <= 0) {
    return 0;
  }

  return Math.round((tasksCompleted / tasksTotal) * 100);
}

export function ManagerOnboardingWidget({ reports }: ManagerOnboardingWidgetProps) {
  if (reports.length === 0) {
    return null;
  }

  return (
    <section className="settings-card" aria-label="Manager onboarding progress">
      <header className="announcements-section-header">
        <div>
          <h2 className="section-title">Direct Report Onboarding</h2>
          <p className="settings-card-description">
            Track onboarding progress for your direct reports and unblock overdue manager tasks.
          </p>
        </div>
        <Link href="/onboarding" className="button button-subtle">
          Open onboarding
        </Link>
      </header>

      <div className="documents-grid">
        {reports.map((report) => {
          const completion = progressPercent(report.tasksCompleted, report.tasksTotal);
          const hasOverdue = report.overdueManagerTaskCount > 0;

          return (
            <article key={report.instanceId} className="settings-card">
              <div className="documents-row-actions" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  {report.employeeAvatarUrl ? (
                    <img
                      src={report.employeeAvatarUrl}
                      alt={report.employeeName}
                      className="dashboard-manager-avatar"
                      loading="lazy"
                    />
                  ) : (
                    <span className="dashboard-manager-avatar-placeholder">
                      {report.employeeName.charAt(0)}
                    </span>
                  )}
                  <div className="documents-cell-copy">
                    <p className="documents-cell-title">{report.employeeName}</p>
                    <p className="documents-cell-description numeric">
                      Day {report.daysSinceStart} · {report.tasksCompleted}/{report.tasksTotal} tasks
                    </p>
                  </div>
                </div>
                <StatusBadge tone={hasOverdue ? "error" : "processing"}>
                  {hasOverdue
                    ? `${report.overdueManagerTaskCount} manager task${report.overdueManagerTaskCount === 1 ? "" : "s"} overdue`
                    : "On track"}
                </StatusBadge>
              </div>

              <div
                className="onboarding-banner-progress-track"
                aria-hidden="true"
                style={{ marginTop: "var(--space-3)" }}
              >
                <span
                  className="onboarding-banner-progress-fill"
                  style={{ width: `${completion}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
