"use client";

import { useLocale, useTranslations } from "next-intl";
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
import { formatMonth, formatRelativeTime } from "../../../../../../lib/datetime";
import type {
  SurveyHeatmapData,
  SurveyTrendData
} from "../../../../../../types/surveys";

type AppLocale = "en" | "fr";

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

// ── Heatmap Component ──

function SentimentHeatmap({ heatmap }: { heatmap: SurveyHeatmapData }) {
  const t = useTranslations('surveyResults');

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
          <h2 className="section-title">{t('heatmapTitle')}</h2>
          <p className="settings-card-description">
            {t('heatmapDescription')}
          </p>
        </div>
      </header>

      <div className="survey-heatmap-container">
        <table className="survey-heatmap" aria-label={t('heatmapAriaLabel')}>
          <thead>
            <tr>
              <th>{t('department')}</th>
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
                      title={isProtected ? t('responsesBelow', { count }) : t('responsesCount', { count })}
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
  const t = useTranslations('surveyResults');
  const locale = useLocale() as AppLocale;

  const trendDirectionLabel = useMemo(() => {
    switch (trend.trendDirection) {
      case "up":
        return t('trendUp');
      case "down":
        return t('trendDown');
      case "flat":
        return t('trendFlat');
    }
  }, [trend.trendDirection, t]);

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
            ? formatMonth(point.closedAt, locale)
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
  }, [trend.points, locale]);

  return (
    <article className="settings-card">
      <header className="announcement-item-header">
        <div>
          <h2 className="section-title">{t('trendTitle')}</h2>
          <p className="survey-trend-summary">
            {t('trendSummary', { count: trend.instanceCount, direction: trendDirectionLabel })}
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
  const t = useTranslations('surveyResults');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const resultsQuery = useSurveyResults(surveyId);
  const survey = resultsQuery.data?.survey;
  const isProtected = resultsQuery.data?.protected ?? false;

  return (
    <>
      <PageHeader
        title={survey?.title?.length ? t('titleWithName', { title: survey.title }) : t('fallbackTitle')}
        description={t('description')}
        actions={
          <>
            <Link href="/admin/surveys" className="button">
              {t('backToAdmin')}
            </Link>
            {!isProtected ? (
              <a
                href={`/api/v1/surveys/${surveyId}/results/export`}
                className="button button-accent"
              >
                {t('exportCsv')}
              </a>
            ) : null}
          </>
        }
      />

      {resultsQuery.isLoading ? surveyResultsSkeleton() : null}

      {!resultsQuery.isLoading && resultsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={resultsQuery.errorMessage}
            ctaLabel={t('backToSurveyAdmin')}
            ctaHref="/admin/surveys"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => resultsQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!resultsQuery.isLoading && !resultsQuery.errorMessage && !survey?.id ? (
        <EmptyState
          title={t('notFound')}
          description={t('notFoundDescription')}
          ctaLabel={t('backToSurveyAdmin')}
          ctaHref="/admin/surveys"
        />
      ) : null}

      {!resultsQuery.isLoading && !resultsQuery.errorMessage && survey?.id ? (
        <section className="compensation-layout" aria-label={t('overviewAriaLabel')}>
          {/* ── Metrics ── */}
          <section className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t('responses')}</p>
              <p className="metric-value numeric">{resultsQuery.data?.totalResponses ?? 0}</p>
              <p className="metric-description">{t('responsesDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('minThreshold')}</p>
              <p className="metric-value numeric">{resultsQuery.data?.minResponsesForResults ?? 0}</p>
              <p className="metric-description">{t('minThresholdDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('questionCount')}</p>
              <p className="metric-value numeric">{survey.questions.length}</p>
              <p className="metric-description">{t('questionCountDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('status')}</p>
              <p className="metric-value">
                <StatusBadge tone={resultsQuery.data?.hasMinimumResponses ? "success" : "warning"}>
                  {isProtected ? t('statusProtected') : resultsQuery.data?.hasMinimumResponses ? t('statusVisible') : t('statusHidden')}
                </StatusBadge>
              </p>
              <p className="metric-description">
                {isProtected
                  ? t('statusProtectedDescription')
                  : t('statusThresholdDescription')}
              </p>
            </article>
          </section>

          {/* ── Survey metadata ── */}
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">{t('metadata')}</h2>
                <p className="settings-card-description">
                  {t('metadataType', { type: survey.type })} • {t('metadataCreated', { date: formatRelativeTime(survey.createdAt, locale) })}
                  {survey.isAnonymous ? ` • ${t('anonymous')}` : ""}
                </p>
              </div>
              <StatusBadge tone="info">{survey.status}</StatusBadge>
            </header>
            <p className="metric-description">
              {t('lastUpdated', { date: formatRelativeTime(survey.updatedAt, locale) })}
            </p>
          </article>

          {/* ── Protected message ── */}
          {isProtected ? (
            <article className="settings-card">
              <p className="form-submit-error">
                {resultsQuery.data?.message ?? t('protectedMessage')}
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
                      {t('questionResponses', { count: questionResult.responseCount })}
                    </p>
                  </div>
                  <StatusBadge tone="processing">{questionResult.questionType}</StatusBadge>
                </header>

                {questionResult.questionType === "rating" ? (
                  <p className="metric-description">
                    {t('averageScore', { score: questionResult.averageScore ?? "--" })}
                  </p>
                ) : null}

                {questionResult.optionBreakdown.length > 0 ? (
                  <div className="data-table-container">
                    <table className="data-table" aria-label={t('breakdownAriaLabel', { question: questionResult.questionText })}>
                      <thead>
                        <tr>
                          <th>{t('optionColumn')}</th>
                          <th>{t('countColumn')}</th>
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
