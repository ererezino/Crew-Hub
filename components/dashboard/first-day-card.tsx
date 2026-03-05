"use client";

import Link from "next/link";
import { CheckCircle, Circle, ChevronRight } from "lucide-react";

import { toSentenceCase } from "../../lib/format-labels";
import type { DashboardResponseData } from "../../types/dashboard";

type FirstDayCardProps = {
  data: DashboardResponseData;
};

function TaskRow({
  task
}: {
  task: { id: string; title: string; category: string; status: string };
}) {
  const isComplete = task.status === "completed";
  return (
    <li className="first-day-task-row">
      <span className="first-day-task-icon" aria-hidden="true">
        {isComplete ? (
          <CheckCircle size={16} className="first-day-check" />
        ) : (
          <Circle size={16} className="first-day-circle" />
        )}
      </span>
      <span className="first-day-task-title">{task.title}</span>
      <span className="first-day-task-category">
        {toSentenceCase(task.category)}
      </span>
    </li>
  );
}

export function FirstDayCard({ data }: FirstDayCardProps) {
  const tasks = data.firstDayTasks;
  if (!tasks) return null;

  const hasTodayTasks = tasks.today.length > 0;
  const hasWeekTasks = tasks.thisWeek.length > 0;

  if (!hasTodayTasks && !hasWeekTasks) return null;

  const instanceId = data.onboardingProgress?.instanceId;

  return (
    <section className="first-day-card" aria-label="First day tasks">
      <div className="first-day-header">
        <h2 className="first-day-heading">Your first tasks</h2>
        {instanceId ? (
          <Link href="/me/onboarding" className="first-day-view-all">
            View all <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>

      {hasTodayTasks ? (
        <div className="first-day-section">
          <h3 className="first-day-section-label">Due today</h3>
          <ul className="first-day-task-list" role="list">
            {tasks.today.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </div>
      ) : null}

      {hasWeekTasks ? (
        <div className="first-day-section">
          <h3 className="first-day-section-label">This week</h3>
          <ul className="first-day-task-list" role="list">
            {tasks.thisWeek.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
