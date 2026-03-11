"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { ProgressRing } from "../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail, useOnboardingInstances } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { OnboardingTask } from "../../../../types/onboarding";

type AppLocale = "en" | "fr";

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

function MyOnboardingSkeleton() {
  return (
    <div className="onboarding-details-skeleton" aria-hidden="true">
      <div className="onboarding-details-skeleton-summary" />
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={`my-onboarding-skeleton-${index}`}
          className="onboarding-details-skeleton-section"
        />
      ))}
    </div>
  );
}

export function MyOnboardingClient() {
  const t = useTranslations('myOnboarding');
  const locale = useLocale() as AppLocale;

  const { instances, isLoading: isInstancesLoading, errorMessage: instancesError } =
    useOnboardingInstances({
      scope: "me"
    });

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const resolvedSelectedInstanceId = useMemo(() => {
    if (instances.length === 0) {
      return null;
    }

    if (selectedInstanceId && instances.some((instance) => instance.id === selectedInstanceId)) {
      return selectedInstanceId;
    }

    const activeInstance = instances.find((instance) => instance.status === "active");
    return activeInstance?.id ?? instances[0]?.id ?? null;
  }, [instances, selectedInstanceId]);

  const {
    detail,
    isLoading: isDetailLoading,
    errorMessage: detailError
  } = useOnboardingInstanceDetail(resolvedSelectedInstanceId);

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === resolvedSelectedInstanceId) ?? null,
    [instances, resolvedSelectedInstanceId]
  );

  if (isInstancesLoading) {
    return <MyOnboardingSkeleton />;
  }

  if (instancesError) {
    return (
      <ErrorState
        title={t('unavailable')}
        message={instancesError}
      />
    );
  }

  if (instances.length === 0) {
    return (
      <>
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
        <EmptyState
          title={t('noInstance')}
          description={t('noInstanceDescription')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      <section className="page-tabs" aria-label={t('instancesAriaLabel')}>
        {instances.map((instance) => (
          <button
            key={instance.id}
            type="button"
            className={
              resolvedSelectedInstanceId === instance.id
                ? "page-tab page-tab-active"
                : "page-tab"
            }
            onClick={() => setSelectedInstanceId(instance.id)}
          >
            {instance.templateName}
          </button>
        ))}
      </section>

      {isDetailLoading ? <MyOnboardingSkeleton /> : null}

      {!isDetailLoading && detailError ? (
        <ErrorState
          title={t('selectedUnavailable')}
          message={detailError}
        />
      ) : null}

      {!isDetailLoading && !detailError && detail && selectedInstance ? (
        <>
          <section className="onboarding-instance-summary">
            <ProgressRing value={detail.instance.progressPercent} label={t('statusLabel')} />
            <div className="onboarding-instance-summary-metrics">
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">{t('templateLabel')}</p>
                <p className="onboarding-instance-metric-value">{detail.instance.templateName}</p>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">{t('statusLabel')}</p>
                <StatusBadge
                  tone={selectedInstance.status === "completed" ? "success" : "processing"}
                >
                  {toSentenceCase(selectedInstance.status)}
                </StatusBadge>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">{t('startedLabel')}</p>
                <p className="onboarding-instance-metric-value">
                  <time
                    dateTime={selectedInstance.startedAt}
                    title={formatDateTimeTooltip(selectedInstance.startedAt, locale)}
                  >
                    {formatRelativeTime(selectedInstance.startedAt, locale)}
                  </time>
                </p>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">{t('tasksDone')}</p>
                <p className="onboarding-instance-metric-value numeric">
                  {detail.instance.completedTasks}/{detail.instance.totalTasks}
                </p>
              </article>
            </div>
          </section>

          {detail.tasks.length === 0 ? (
            <EmptyState
              title={t('noTasksYet')}
              description={t('noTasksYetDescription')}
            />
          ) : (
            <section className="my-onboarding-task-list">
              {detail.tasks.map((task) => (
                <article key={task.id} className="my-onboarding-task-card">
                  <header className="my-onboarding-task-card-header">
                    <h2 className="section-title">{task.title}</h2>
                    <div className="my-onboarding-task-badges">
                      {task.taskType === "e_signature" && task.status === "completed" ? (
                        <StatusBadge tone="success">{t('signed')}</StatusBadge>
                      ) : (
                        <StatusBadge tone={toneForTaskStatus(task.status)}>{toSentenceCase(task.status)}</StatusBadge>
                      )}
                    </div>
                  </header>
                  <p className="settings-card-description">
                    {task.description ?? t('noDescription')}
                  </p>
                  <p className="settings-card-description">{t('category', { name: toSentenceCase(task.category) })}</p>
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
                  {task.completionGuidance ? (
                    <p className="settings-card-description">
                      {t('completionGuidance', { text: task.completionGuidance })}
                    </p>
                  ) : null}
                  {task.actionUrl && task.taskType !== "e_signature" ? (
                    <a
                      href={task.actionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button button-sm"
                    >
                      {task.actionLabel ?? t('openTaskAction')}
                    </a>
                  ) : null}
                  {task.taskType === "e_signature" && task.status !== "completed" ? (
                    <Link href="/signatures" className="button button-accent button-sm">
                      {t('signNow')}
                    </Link>
                  ) : null}
                  <p className="settings-card-description">
                    {t('completedBy', { name: task.completedByName ?? "--" })}
                  </p>
                </article>
              ))}
            </section>
          )}

          <footer className="my-onboarding-footer">
            <Link className="button" href={`/onboarding/${detail.instance.id}`}>
              {t('openFullView')}
            </Link>
          </footer>
        </>
      ) : null}
    </>
  );
}
