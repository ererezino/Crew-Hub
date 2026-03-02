"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useAdminSurveys } from "../../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import type { SurveyLaunchResponse, SurveyRecord } from "../../../../types/surveys";

type SortDirection = "asc" | "desc";

function toDateTimeValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

function toneForSurveyStatus(
  status: SurveyRecord["status"]
): "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing" {
  switch (status) {
    case "active":
      return "success";
    case "closed":
      return "draft";
    case "archived":
      return "processing";
    default:
      return "pending";
  }
}

function adminSurveysSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`admin-surveys-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`admin-surveys-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function AdminSurveysClient() {
  const adminQuery = useAdminSurveys();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [launchingSurveyId, setLaunchingSurveyId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const surveys = useMemo(() => {
    const rows = adminQuery.data?.surveys ?? [];

    return [...rows].sort((leftSurvey, rightSurvey) => {
      const comparison = leftSurvey.title.localeCompare(rightSurvey.title);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [adminQuery.data?.surveys, sortDirection]);

  const activeCount = surveys.filter((survey) => survey.status === "active").length;
  const draftCount = surveys.filter((survey) => survey.status === "draft").length;
  const totalResponses = surveys.reduce(
    (sum, survey) => sum + survey.responseCount,
    0
  );

  const launchSurvey = async (surveyId: string) => {
    setLaunchingSurveyId(surveyId);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/surveys/${surveyId}/launch`, {
        method: "POST"
      });

      const payload = (await response.json()) as SurveyLaunchResponse;

      if (!response.ok || !payload.data?.survey) {
        setErrorMessage(payload.error?.message ?? "Unable to launch survey.");
        return;
      }

      setFeedbackMessage("Survey launched successfully.");
      adminQuery.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to launch survey.");
    } finally {
      setLaunchingSurveyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Survey Admin"
        description="Create, launch, and review survey response coverage across the organization."
        actions={
          <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
            <Link href="/admin/surveys/new" className="button button-accent">
              New survey
            </Link>
            <Link href="/surveys" className="button">
              Employee view
            </Link>
          </div>
        }
      />

      {adminQuery.isLoading ? adminSurveysSkeleton() : null}

      {!adminQuery.isLoading && (adminQuery.errorMessage || errorMessage) ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Survey admin is unavailable"
            description={errorMessage ?? adminQuery.errorMessage ?? "Unable to load survey admin."}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              setErrorMessage(null);
              adminQuery.refresh();
            }}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!adminQuery.isLoading && !adminQuery.errorMessage && !errorMessage ? (
        <section className="compensation-layout" aria-label="Survey admin overview">
          <section className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Surveys</p>
              <p className="metric-value numeric">{surveys.length}</p>
              <p className="metric-description">Total surveys in this org.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Active</p>
              <p className="metric-value numeric">{activeCount}</p>
              <p className="metric-description">Currently collecting responses.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Draft</p>
              <p className="metric-value numeric">{draftCount}</p>
              <p className="metric-description">Ready to review and launch.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Responses</p>
              <p className="metric-value numeric">{totalResponses}</p>
              <p className="metric-description">All responses captured so far.</p>
            </article>
          </section>

          {feedbackMessage ? <p className="settings-feedback">{feedbackMessage}</p> : null}

          {surveys.length === 0 ? (
            <EmptyState
              title="No surveys yet"
              description="Create your first survey to collect team feedback."
              ctaLabel="Create survey"
              ctaHref="/admin/surveys/new"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Survey admin table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((currentValue) =>
                            currentValue === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        Survey
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Questions</th>
                    <th>Responses</th>
                    <th>Window</th>
                    <th>Updated</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {surveys.map((survey) => {
                    const startDate = toDateTimeValue(survey.startDate);
                    const endDate = toDateTimeValue(survey.endDate);

                    return (
                      <tr key={survey.id} className="data-table-row">
                        <td>
                          <p>{survey.title}</p>
                          <p className="metric-description">{survey.description ?? "No description"}</p>
                        </td>
                        <td>
                          <StatusBadge tone={toneForSurveyStatus(survey.status)}>{survey.status}</StatusBadge>
                        </td>
                        <td>
                          <StatusBadge tone="info">{survey.type}</StatusBadge>
                        </td>
                        <td className="numeric">{survey.questions.length}</td>
                        <td className="numeric">{survey.responseCount}</td>
                        <td>
                          {startDate ? (
                            <div>
                              <time dateTime={startDate} title={formatDateTimeTooltip(startDate)}>
                                {formatRelativeTime(startDate)}
                              </time>
                              {endDate ? (
                                <>
                                  {" "}→{" "}
                                  <time dateTime={endDate} title={formatDateTimeTooltip(endDate)}>
                                    {formatRelativeTime(endDate)}
                                  </time>
                                </>
                              ) : null}
                            </div>
                          ) : (
                            <span className="metric-description">No window set</span>
                          )}
                        </td>
                        <td>
                          <time dateTime={survey.updatedAt} title={formatDateTimeTooltip(survey.updatedAt)}>
                            {formatRelativeTime(survey.updatedAt)}
                          </time>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="documents-row-actions">
                            <Link href={`/surveys/${survey.id}`} className="table-row-action">
                              Preview
                            </Link>
                            <Link
                              href={`/admin/surveys/${survey.id}/results`}
                              className="table-row-action"
                            >
                              Results
                            </Link>
                            {survey.status === "draft" ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => launchSurvey(survey.id)}
                                disabled={launchingSurveyId === survey.id}
                              >
                                {launchingSurveyId === survey.id ? "Launching..." : "Launch"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
