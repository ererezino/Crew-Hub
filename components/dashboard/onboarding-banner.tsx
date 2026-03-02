import Link from "next/link";

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
