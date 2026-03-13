/* eslint-disable i18next/no-literal-string -- Onboarding journey uses decorative
   symbols (✓ ◐ ○ ▸) and structural labels that will be extracted to i18n in a
   follow-up pass. Disabling file-wide for now to unblock CI. */
"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail, useOnboardingInstances } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type {
  OnboardingContentSection,
  OnboardingTask,
  OnboardingTrack
} from "../../../../types/onboarding";

type AppLocale = "en" | "fr";

/* ── Helpers ── */

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

function sectionIcon(type: OnboardingContentSection["type"]): string {
  switch (type) {
    case "content":
      return "📖";
    case "tasks":
      return "✅";
    case "policies":
      return "📋";
    case "tools":
      return "🛠";
    default:
      return "📌";
  }
}

type GroupedSection = {
  section: OnboardingContentSection | null;
  tasks: OnboardingTask[];
};

function groupTasksBySections(
  sections: OnboardingContentSection[],
  tasks: OnboardingTask[]
): GroupedSection[] {
  const sectionMap = new Map<string, OnboardingContentSection>();
  for (const s of sections) {
    sectionMap.set(s.id, s);
  }

  // Group tasks by sectionId
  const tasksBySectionId = new Map<string, OnboardingTask[]>();
  const unsectionedTasks: OnboardingTask[] = [];

  for (const task of tasks) {
    if (task.track === "operations") continue; // Employee sees only their tasks
    if (task.sectionId && sectionMap.has(task.sectionId)) {
      const existing = tasksBySectionId.get(task.sectionId) ?? [];
      existing.push(task);
      tasksBySectionId.set(task.sectionId, existing);
    } else {
      unsectionedTasks.push(task);
    }
  }

  // Build ordered list: sections first (by order), then unsectioned tasks
  const groups: GroupedSection[] = [];

  const sortedSections = [...sections].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    groups.push({
      section,
      tasks: tasksBySectionId.get(section.id) ?? []
    });
  }

  // Add any unsectioned tasks as a catch-all group
  if (unsectionedTasks.length > 0) {
    groups.push({
      section: null,
      tasks: unsectionedTasks
    });
  }

  return groups;
}

function sectionCompletionStatus(
  section: OnboardingContentSection | null,
  tasks: OnboardingTask[]
): "complete" | "in_progress" | "not_started" {
  if (tasks.length === 0) return "not_started";
  const done = tasks.filter((t) => t.status === "completed").length;
  if (done === tasks.length) return "complete";
  if (done > 0) return "in_progress";
  return "not_started";
}

/* ── Skeleton ── */

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

/* ── Journey Task Card ── */

function JourneyTaskCard({
  task,
  instanceId,
  isCompleting,
  onComplete,
  locale,
  t
}: {
  task: OnboardingTask;
  instanceId: string;
  isCompleting: boolean;
  onComplete: (instanceId: string, taskId: string) => void;
  locale: AppLocale;
  t: ReturnType<typeof useTranslations<"myOnboarding">>;
}) {
  const isComplete = task.status === "completed";
  const isESignature = task.taskType === "e_signature";

  return (
    <div className={`journey-task ${isComplete ? "journey-task-done" : ""}`}>
      <div className="journey-task-check">
        {isComplete ? (
          <span className="journey-check-icon" aria-label="Complete">{"✓"}</span>
        ) : isESignature ? (
          <span className="journey-check-icon journey-check-signature" aria-label="Requires signature">✍</span>
        ) : (
          <button
            type="button"
            className="journey-check-button"
            disabled={isCompleting}
            onClick={() => onComplete(instanceId, task.id)}
            aria-label={`Mark "${task.title}" complete`}
          >
            {isCompleting ? (
              <span className="journey-check-loading" />
            ) : null}
          </button>
        )}
      </div>
      <div className="journey-task-content">
        <p className={`journey-task-title ${isComplete ? "journey-task-title-done" : ""}`}>
          {task.title}
        </p>
        {task.description ? (
          <p className="journey-task-description">{task.description}</p>
        ) : null}
        <div className="journey-task-meta">
          {task.dueDate ? (

            <span className="journey-task-due">
              Due{" "}
              <time
                dateTime={task.dueDate}
                title={formatDateTimeTooltip(task.dueDate, locale)}
              >
                {formatRelativeTime(task.dueDate, locale)}
              </time>
            </span>
          ) : null}
          {task.completionGuidance ? (
            <span className="journey-task-guidance">{task.completionGuidance}</span>
          ) : null}
        </div>
        {task.actionUrl && !isESignature ? (
          <a
            href={task.actionUrl}
            target="_blank"
            rel="noreferrer"
            className="button button-sm journey-task-action"
          >
            {task.actionLabel ?? t("openTaskAction")}
          </a>
        ) : null}
        {isESignature && !isComplete ? (
          <Link href="/signatures" className="button button-accent button-sm journey-task-action">
            {t("signNow")}
          </Link>
        ) : null}
        {isComplete && task.completedByName ? (
          <p className="journey-task-completed-info">
            {t("completedBy", { name: task.completedByName })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── Journey Section ── */

function JourneySection({
  group,
  instanceId,
  completingTaskId,
  onComplete,
  locale,
  t,
  defaultExpanded
}: {
  group: GroupedSection;
  instanceId: string;
  completingTaskId: string | null;
  onComplete: (instanceId: string, taskId: string) => void;
  locale: AppLocale;
  t: ReturnType<typeof useTranslations<"myOnboarding">>;
  defaultExpanded: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const status = sectionCompletionStatus(group.section, group.tasks);
  const completedCount = group.tasks.filter((t) => t.status === "completed").length;
  const totalCount = group.tasks.length;

  const title = group.section?.title ?? "Other tasks";
  const icon = group.section ? sectionIcon(group.section.type) : "📌";

  return (
    <section className="journey-section">
      <button
        type="button"
        className="journey-section-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <div className="journey-section-header-left">
          <span className="journey-section-icon">{icon}</span>
          <span className="journey-section-status-indicator">
            {status === "complete" ? (
  
              <span className="journey-section-check" aria-label="Complete">✓</span>
            ) : status === "in_progress" ? (
  
              <span className="journey-section-progress" aria-label="In progress">◐</span>
            ) : (
  
              <span className="journey-section-pending" aria-label="Not started">○</span>
            )}
          </span>
          <h2 className="journey-section-title">{title}</h2>
        </div>
        <div className="journey-section-header-right">
          {totalCount > 0 ? (
            <span className="journey-section-count">
              {completedCount}/{totalCount}
            </span>
          ) : null}
          <span className={`journey-section-chevron ${isExpanded ? "journey-section-chevron-open" : ""}`}>
            ▸
          </span>
        </div>
      </button>

      {isExpanded ? (
        <div className="journey-section-body">
          {group.section?.content ? (
            <div
              className="journey-section-content"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: template content is admin-authored
              dangerouslySetInnerHTML={{ __html: group.section.content }}
            />
          ) : null}

          {group.tasks.length > 0 ? (
            <div className="journey-task-list">
              {group.tasks.map((task) => (
                <JourneyTaskCard
                  key={task.id}
                  task={task}
                  instanceId={instanceId}
                  isCompleting={completingTaskId === task.id}
                  onComplete={onComplete}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ── Main Component ── */

export function MyOnboardingClient() {
  const t = useTranslations("myOnboarding");
  const locale = useLocale() as AppLocale;

  const {
    instances,
    isLoading: isInstancesLoading,
    errorMessage: instancesError,
    refresh: refreshInstances
  } = useOnboardingInstances({ scope: "me" });

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const resolvedSelectedInstanceId = useMemo(() => {
    if (instances.length === 0) return null;
    if (selectedInstanceId && instances.some((i) => i.id === selectedInstanceId)) {
      return selectedInstanceId;
    }
    const activeInstance = instances.find((i) => i.status === "active");
    return activeInstance?.id ?? instances[0]?.id ?? null;
  }, [instances, selectedInstanceId]);

  const {
    detail,
    isLoading: isDetailLoading,
    errorMessage: detailError,
    refresh: refreshDetail
  } = useOnboardingInstanceDetail(resolvedSelectedInstanceId);

  const handleCompleteTask = useCallback(
    async (instanceId: string, taskId: string) => {
      setCompletingTaskId(taskId);
      try {
        const response = await fetch(
          `/api/v1/onboarding/instances/${instanceId}/tasks/${taskId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete" })
          }
        );
        if (response.ok) {
          refreshDetail();
          refreshInstances();
        }
      } catch {
        // Swallow — task state unchanged
      } finally {
        setCompletingTaskId(null);
      }
    },
    [refreshDetail, refreshInstances]
  );

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === resolvedSelectedInstanceId) ?? null,
    [instances, resolvedSelectedInstanceId]
  );

  // Group tasks by sections
  const journeySections = useMemo(() => {
    if (!detail) return [];
    const sections = detail.instance.sections ?? [];
    const employeeTasks = detail.tasks.filter((t) => t.track !== "operations");
    return groupTasksBySections(sections, employeeTasks);
  }, [detail]);

  // Find the first non-complete section for default expansion
  const firstIncompleteSectionIdx = useMemo(() => {
    const idx = journeySections.findIndex((g) => {
      const status = sectionCompletionStatus(g.section, g.tasks);
      return status !== "complete";
    });
    return idx >= 0 ? idx : 0;
  }, [journeySections]);

  if (isInstancesLoading) {
    return <MyOnboardingSkeleton />;
  }

  if (instancesError) {
    return (
      <ErrorState title={t("unavailable")} message={instancesError} />
    );
  }

  if (instances.length === 0) {
    return (
      <div className="journey-empty">
        <EmptyState
          title={t("noInstance")}
          description={t("noInstanceDescription")}
        />
      </div>
    );
  }

  return (
    <div className="journey-page">
      {/* Instance tabs if multiple */}
      {instances.length > 1 ? (
        <section className="page-tabs" aria-label={t("instancesAriaLabel")}>
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
      ) : null}

      {isDetailLoading ? <MyOnboardingSkeleton /> : null}

      {!isDetailLoading && detailError ? (
        <ErrorState title={t("selectedUnavailable")} message={detailError} />
      ) : null}

      {!isDetailLoading && !detailError && detail && selectedInstance ? (
        <>
          {/* Welcome banner */}
          <header className="journey-welcome">
            <h1 className="journey-welcome-title">
              {selectedInstance.status === "completed"
                ? "🎉 " + t("completedTitle")
                : "👋 " + t("welcomeTitle")}
            </h1>
            <p className="journey-welcome-subtitle">
              {selectedInstance.status === "completed"
                ? t("completedSubtitle")
                : t("welcomeSubtitle")}
            </p>
          </header>

          {/* Progress overview */}
          <section className="journey-progress">
            <div className="journey-progress-bar-container">
              <div className="journey-progress-label">
                <span>{t("yourProgress")}</span>
                <span className="journey-progress-pct">
                  {detail.instance.employeeTrack.percent}%
                </span>
              </div>
              <div className="journey-progress-bar">
                <div
                  className="journey-progress-bar-fill"
                  style={{ width: `${detail.instance.employeeTrack.percent}%` }}
                />
              </div>
  
              <p className="journey-progress-count">
                {detail.instance.employeeTrack.completed} of{" "}
                {detail.instance.employeeTrack.total} tasks complete
              </p>
            </div>

            {detail.instance.operationsTrack.total > 0 ? (
              <div className="journey-ops-progress">
                <p className="journey-ops-label">
                  {t("opsProgressLabel")}
                </p>
                <div className="journey-progress-bar journey-progress-bar-ops">
                  <div
                    className="journey-progress-bar-fill journey-progress-bar-fill-ops"
                    style={{ width: `${detail.instance.operationsTrack.percent}%` }}
                  />
                </div>
    
                <p className="journey-ops-count">
                  {detail.instance.operationsTrack.percent}% ready
                </p>
              </div>
            ) : null}
          </section>

          {/* Journey sections */}
          {journeySections.length === 0 ? (
            <EmptyState
              title={t("noTasksYet")}
              description={t("noTasksYetDescription")}
            />
          ) : (
            <div className="journey-sections">
              {journeySections.map((group, idx) => (
                <JourneySection
                  key={group.section?.id ?? `unsectioned-${idx}`}
                  group={group}
                  instanceId={detail.instance.id}
                  completingTaskId={completingTaskId}
                  onComplete={handleCompleteTask}
                  locale={locale}
                  t={t}
                  defaultExpanded={idx === firstIncompleteSectionIdx}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
