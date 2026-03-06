"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../../components/shared/status-badge";
import { useSurveyResults } from "../../../../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../../lib/datetime";
import type {
  SurveyHeatmapData,
  SurveyTrendData
} from "../../../../../../types/surveys";

// ── Helpers ──

const LINE_COLORS = [
  "var(--color-accent)",
  "var(--status-info-text)",
  "var(--status-success-text)",
  "var(--status-warning-text)",
  "var(--status-error-text)",
  "var(--status-pending-text)",
  "var(--status-draft-text)",
  "var(--text-secondary)"
];

function heatmapCellClass(score: number | null, isProtected: boolean): string {
  if (isProtected || score === null) return "heatmap-cell-protected";
  if (score < 3.0) return "heatmap-cell-red";
  if (score < 4.0) return "heatmap-cell-amber";
  return "heatmap-cell-green";
}

function trendArrow(direction: "up" | "down" | "flat"): string {
  switch (direction) {
    case "up":
      return "↑ up";
    case "down":
      return "↓ down";
    case "flat":
      return "→ flat";
  }
}

// ── Heatmap Component ──

function SentimentHeatmap({ heatmap }: { heatmap: SurveyHeatmapData }) {
  const cellLookup = useMemo(() => {
    const map = new Map<string, { averageScore: number | null; responseCount: number; protected: boolean }>();

    for (const cell of heatmap.cells) {
      map.set(`${cell.department}::${cell.questionId}`, cell);
    }

    return map;
  }, [heatmap.cells]);

  return (
    <article className="settings-card">
      <header className="announcement-item-header">
        <div>
          <h2 className="section-title">Sentiment heatmap</h2>
          <p className="settings-card-description">
            Average score by department and question. Cells with insufficient responses show &quot;-&quot;.
          </p>
        </div>
      </header>

      <div className="survey-heatmap-container">
        <table className="survey-heatmap" aria-label="Sentiment heatmap">
          <thead>
            <tr>
              <th>Department</th>
              {heatmap.questions.map((q) => (
                <th key={q.id} title={q.text}>
                  {q.text.length > 30 ? `${q.text.slice(0, 27)}...` : q.text}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.departments.map((dept) => (
              <tr key={dept}>
                <td>{dept}</td>
                {heatmap.questions.map((q) => {
                  const cell = cellLookup.get(`${dept}::${q.id}`);
                  const score = cell?.averageScore ?? null;
                  const isProtected = cell?.protected ?? true;
                  const count = cell?.responseCount ?? 0;

                  return (
                    <td
                      key={`${dept}-${q.id}`}
                      className={heatmapCellClass(score, isProtected)}
                      title={isProtected ? `${count} responses (below threshold)` : `${count} responses`}
                    >
                      {isProtected || score === null ? "-" : score.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

// ── Trend Chart Component ──

function TrendChart({ trend }: { trend: SurveyTrendData }) {
  // Build chart data: each point is { closedAt, [questionText]: averageScore }
  const { chartData, questionLabels } = useMemo(() => {
    const instanceMap = new Map<string, Record<string, unknown>>();
    const labels = new Set<string>();

    for (const point of trend.points) {
      const key = `${point.surveyId}::${point.closedAt}`;

      if (!instanceMap.has(key)) {
        instanceMap.set(key, {
          closedAt: point.closedAt,
          label: point.closedAt
            ? new Date(point.closedAt + "T00:00:00.000Z").toLocaleDateString("en-US", {
                month: "short",
                year: "numeric"
              })
            : point.surveyId.slice(0, 8)
        });
      }

      const entry = instanceMap.get(key)!;
      const shortLabel =
        point.questionText.length > 25
          ? point.questionText.slice(0, 22) + "..."
          : point.questionText;
      entry[shortLabel] = point.averageScore;
      labels.add(shortLabel);
    }

    return {
      chartData: [...instanceMap.values()],
      questionLabels: [...labels]
    };
  }, [trend.points]);

  return (
    <article className="settings-card">
      <header className="announcement-item-header">
        <div>
          <h2 className="section-title">Score trend</h2>
          <p className="survey-trend-summary">
            {trend.instanceCount} survey instances, average score trending{" "}
            <strong>{trendArrow(trend.trendDirection)}</strong>
          </p>
        </div>
      </header>

      <div className="survey-trend-chart">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--text-muted)" }}
            />
            <YAxis
              domain={[0, 5]}
              tick={{ fill: "var(--text-muted)" }}
            />
            <Tooltip />
            <Legend />
            {questionLabels.map((label, index) => (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={LINE_COLORS[index % LINE_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

// ── Skeleton ──

function surveyResultsSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`survey-results-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`survey-results-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

// ── Main ──

export function SurveyResultsClient({ surveyId }: { surveyId: string }) {
  const resultsQuery = useSurveyResults(surveyId);
  const survey = resultsQuery.data?.survey;
  const isProtected = resultsQuery.data?.protected ?? false;

  return (
    <>
      <PageHeader
        title={survey?.title?.length ? `${survey.title} Results` : "Survey Results"}
        description="Review response coverage, question trends, and export data for analysis."
        actions={
          <>
            <Link href="/admin/surveys" className="button">
              Back to admin
            </Link>
            {!isProtected ? (
              <a
                href={`/api/v1/surveys/${surveyId}/results/export`}
                className="button button-accent"
              >
                Export CSV
              </a>
            ) : null}
          </>
        }
      />

      {resultsQuery.isLoading ? surveyResultsSkeleton() : null}

      {!resultsQuery.isLoading && resultsQuery.errorMessage ? (
        <>
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
        </>
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
          {/* ── Metrics ── */}
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
                  {isProtected ? "Protected" : resultsQuery.data?.hasMinimumResponses ? "Visible" : "Hidden"}
                </StatusBadge>
              </p>
              <p className="metric-description">
                {isProtected
                  ? "Results protected by anonymity."
                  : "Result visibility based on anonymity threshold."}
              </p>
            </article>
          </section>

          {/* ── Survey metadata ── */}
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Survey metadata</h2>
                <p className="settings-card-description">
                  Type: {survey.type} • Created {formatRelativeTime(survey.createdAt)}
                  {survey.isAnonymous ? " • Anonymous" : ""}
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

          {/* ── Protected message ── */}
          {isProtected ? (
            <article className="settings-card">
              <p className="form-submit-error">
                {resultsQuery.data?.message ?? "Not enough responses to display results."}
              </p>
            </article>
          ) : null}

          {/* ── Non-protected message ── */}
          {!isProtected && resultsQuery.data?.message ? (
            <article className="settings-card">
              <p className="form-submit-error">{resultsQuery.data.message}</p>
            </article>
          ) : null}

          {/* ── Heatmap ── */}
          {!isProtected && resultsQuery.data?.heatmap ? (
            <SentimentHeatmap heatmap={resultsQuery.data.heatmap} />
          ) : null}

          {/* ── Trend chart ── */}
          {!isProtected && resultsQuery.data?.trend ? (
            <TrendChart trend={resultsQuery.data.trend} />
          ) : null}

          {/* ── Question results ── */}
          {!isProtected &&
            (resultsQuery.data?.questionResults ?? []).map((questionResult) => (
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
