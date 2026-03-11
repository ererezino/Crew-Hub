"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { ProgressRing } from "../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { OnboardingTask } from "../../../../types/onboarding";

type AppLocale = "en" | "fr";

type OnboardingInstanceClientProps = {
  instanceId: string;
};

function toneForTaskStatus(taskStatus: OnboardingTask["status"]) {
  switch (taskStatus) {
    case "pending":
      return "pending" as const;
    case "in_progress":
      return "processing" as const;
    case "completed":
      return "success" as const;
    case "blocked":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function groupTasksByCategory(tasks: readonly OnboardingTask[]): Map<string, OnboardingTask[]> {
  const groupedTasks = new Map<string, OnboardingTask[]>();

  for (const task of tasks) {
    const categoryTasks = groupedTasks.get(task.category) ?? [];
    categoryTasks.push(task);
    groupedTasks.set(task.category, categoryTasks);
  }

  return new Map([...groupedTasks.entries()].sort((leftEntry, rightEntry) =>
    leftEntry[0].localeCompare(rightEntry[0])
  ));
}

function OnboardingDetailsSkeleton() {
  return (
    <div className="onboarding-details-skeleton" aria-hidden="true">
      <div className="onboarding-details-skeleton-summary" />
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={`onboarding-details-skeleton-${index}`}
          className="onboarding-details-skeleton-section"
        />
      ))}
    </div>
  );
}

export function OnboardingInstanceClient({ instanceId }: OnboardingInstanceClientProps) {
  const t = useTranslations('onboardingInstance');
  const locale = useLocale() as AppLocale;

  const { detail, isLoading, errorMessage } = useOnboardingInstanceDetail(instanceId);

  const tasksByCategory = useMemo(
    () => groupTasksByCategory(detail?.tasks ?? []),
    [detail?.tasks]
  );

  if (isLoading) {
    return <OnboardingDetailsSkeleton />;
  }

  if (errorMessage || !detail) {
    return (
      <ErrorState
        title={t('unavailable')}
        message={errorMessage ?? t('unableToLoad')}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`${detail.instance.employeeName} - ${toSentenceCase(detail.instance.type)}`}
        description={t('template', { name: detail.instance.templateName })}
      />

      <section className="onboarding-instance-summary">
        <ProgressRing value={detail.instance.progressPercent} label={t('progress')} />
        <div className="onboarding-instance-summary-metrics">
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t('status')}</p>
            <StatusBadge
              tone={detail.instance.status === "completed" ? "success" : "processing"}
            >
              {toSentenceCase(detail.instance.status)}
            </StatusBadge>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t('started')}</p>
            <p className="onboarding-instance-metric-value">
              <time
                dateTime={detail.instance.startedAt}
                title={formatDateTimeTooltip(detail.instance.startedAt, locale)}
              >
                {formatRelativeTime(detail.instance.startedAt, locale)}
              </time>
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t('completed')}</p>
            <p className="onboarding-instance-metric-value">
              {detail.instance.completedAt ? (
                <time
                  dateTime={detail.instance.completedAt}
                  title={formatDateTimeTooltip(detail.instance.completedAt, locale)}
                >
                  {formatRelativeTime(detail.instance.completedAt, locale)}
                </time>
              ) : (
                "--"
              )}
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t('taskCompletion')}</p>
            <p className="onboarding-instance-metric-value numeric">
              {detail.instance.completedTasks}/{detail.instance.totalTasks}
            </p>
          </article>
        </div>
      </section>

      {tasksByCategory.size === 0 ? (
        <EmptyState
          title={t('noTasks')}
          description={t('noTasksDescription')}
          ctaLabel={t('backToOnboarding')}
          ctaHref="/onboarding"
        />
      ) : (
        <section className="onboarding-category-grid">
          {[...tasksByCategory.entries()].map(([category, tasks]) => (
            <article key={category} className="onboarding-category-card">
              <header className="onboarding-category-header">
                <h2 className="section-title">{category}</h2>
                <span className="pill numeric">{t('taskCount', { count: tasks.length })}</span>
              </header>
              <ul className="onboarding-task-list">
                {tasks.map((task) => (
                  <li key={task.id} className="onboarding-task-item">
                    <div className="onboarding-task-main">
                      <p className="onboarding-task-title">{task.title}</p>
                      <p className="settings-card-description">
                        {task.description ?? t('noDescription')}
                      </p>
                    </div>
                    <div className="onboarding-task-meta">
                      <StatusBadge tone={toneForTaskStatus(task.status)}>{toSentenceCase(task.status)}</StatusBadge>
                      <p className="settings-card-description">{t('assigned', { name: task.assignedToName })}</p>
                      <p className="settings-card-description">
                        {t('due')}{" "}
                        {task.dueDate ? (
                          <time dateTime={task.dueDate} title={formatDateTimeTooltip(task.dueDate, locale)}>
                            {formatRelativeTime(task.dueDate, locale)}
                          </time>
                        ) : (
                          "--"
                        )}
                      </p>
                      <p className="settings-card-description">
                        {t('completedBy', { name: task.completedByName ?? "--" })}
                      </p>
                      {task.completionGuidance ? (
                        <p className="settings-card-description">
                          {t('completionGuidance', { text: task.completionGuidance })}
                        </p>
                      ) : null}
                      {task.actionUrl ? (
                        <a
                          href={task.actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="button button-sm"
                        >
                          {task.actionLabel ?? t('openTaskAction')}
                        </a>
                      ) : null}
                      <p className="settings-card-description">{task.notes ?? t('noNotes')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
