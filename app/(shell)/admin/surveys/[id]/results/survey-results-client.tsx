"use client";

import Link from "next/link";

import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../../components/shared/status-badge";
import { useSurveyResults } from "../../../../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../../lib/datetime";

function surveyResultsSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`survey-results-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`survey-results-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function SurveyResultsClient({ surveyId }: { surveyId: string }) {
  const resultsQuery = useSurveyResults(surveyId);
  const survey = resultsQuery.data?.survey;

  return (
    <>
      <PageHeader
        title={survey?.title?.length ? `${survey.title} Results` : "Survey Results"}
        description="Review response coverage, question trends, and export data for analysis."
        actions={
          <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
            <Link href="/admin/surveys" className="button">
              Back to admin
            </Link>
            <a
              href={`/api/v1/surveys/${surveyId}/results/export`}
              className="button button-accent"
            >
              Export CSV
            </a>
          </div>
        }
      />

      {resultsQuery.isLoading ? surveyResultsSkeleton() : null}

      {!resultsQuery.isLoading && resultsQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Survey results are unavailable"
            description={resultsQuery.errorMessage}
            ctaLabel="Back to survey admin"
            ctaHref="/admin/surveys"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => resultsQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!resultsQuery.isLoading && !resultsQuery.errorMessage && !survey?.id ? (
        <EmptyState
          title="Survey not found"
          description="The selected survey was not found or may no longer exist."
          ctaLabel="Back to survey admin"
          ctaHref="/admin/surveys"
        />
      ) : null}

      {!resultsQuery.isLoading && !resultsQuery.errorMessage && survey?.id ? (
        <section className="compensation-layout" aria-label="Survey results overview">
          <section className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Responses</p>
              <p className="metric-value numeric">{resultsQuery.data?.totalResponses ?? 0}</p>
              <p className="metric-description">Total submitted responses.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Min threshold</p>
              <p className="metric-value numeric">{resultsQuery.data?.minResponsesForResults ?? 0}</p>
              <p className="metric-description">Responses required to reveal analytics.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Question count</p>
              <p className="metric-value numeric">{survey.questions.length}</p>
              <p className="metric-description">Questions configured in this survey.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Status</p>
              <p className="metric-value">
                <StatusBadge tone={resultsQuery.data?.hasMinimumResponses ? "success" : "warning"}>
                  {resultsQuery.data?.hasMinimumResponses ? "Visible" : "Hidden"}
                </StatusBadge>
              </p>
              <p className="metric-description">Result visibility based on anonymity threshold.</p>
            </article>
          </section>

          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Survey metadata</h2>
                <p className="settings-card-description">
                  Type: {survey.type} • Created {formatRelativeTime(survey.createdAt)}
                </p>
              </div>
              <StatusBadge tone="info">{survey.status}</StatusBadge>
            </header>
            <p className="metric-description">
              Last updated{" "}
              <time dateTime={survey.updatedAt} title={formatDateTimeTooltip(survey.updatedAt)}>
                {formatRelativeTime(survey.updatedAt)}
              </time>
              .
            </p>
          </article>

          {resultsQuery.data?.message ? (
            <article className="settings-card">
              <p className="form-submit-error">{resultsQuery.data.message}</p>
            </article>
          ) : null}

          {(resultsQuery.data?.questionResults ?? []).map((questionResult) => (
            <article key={questionResult.questionId} className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">{questionResult.questionText}</h2>
                  <p className="settings-card-description">
                    Responses: <span className="numeric">{questionResult.responseCount}</span>
                  </p>
                </div>
                <StatusBadge tone="processing">{questionResult.questionType}</StatusBadge>
              </header>

              {questionResult.questionType === "rating" ? (
                <p className="metric-description">
                  Average score: <span className="numeric">{questionResult.averageScore ?? "--"}</span>
                </p>
              ) : null}

              {questionResult.optionBreakdown.length > 0 ? (
                <div className="data-table-container">
                  <table className="data-table" aria-label={`Breakdown for ${questionResult.questionText}`}>
                    <thead>
                      <tr>
                        <th>Option</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionResult.optionBreakdown.map((row) => (
                        <tr key={`${questionResult.questionId}-${row.option}`} className="data-table-row">
                          <td>{row.option}</td>
                          <td className="numeric">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {questionResult.textResponses.length > 0 ? (
                <ul className="announcement-widget-list">
                  {questionResult.textResponses.slice(0, 20).map((response, index) => (
                    <li key={`${questionResult.questionId}-text-${index}`} className="announcement-widget-item">
                      <p className="announcement-item-body">{response}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
