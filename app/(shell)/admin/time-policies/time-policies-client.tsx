"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeAttendancePolicies } from "../../../../hooks/use-time-attendance";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";

function policiesSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`time-policy-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function TimePoliciesClient({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('timePolicies');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const policiesQuery = useTimeAttendancePolicies();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedPolicies = useMemo(() => {
    const rows = policiesQuery.data?.policies ?? [];

    return [...rows].sort((leftPolicy, rightPolicy) => {
      const comparison = leftPolicy.name.localeCompare(rightPolicy.name);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [policiesQuery.data?.policies, sortDirection]);

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
      ) : null}

      {policiesQuery.isLoading ? policiesSkeleton() : null}

      {!policiesQuery.isLoading && policiesQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={policiesQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => policiesQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!policiesQuery.isLoading && !policiesQuery.errorMessage && sortedPolicies.length === 0 ? (
        <EmptyState
          title={t('noPolicies')}
          description={t('noPoliciesDescription')}
        />
      ) : null}

      {!policiesQuery.isLoading && !policiesQuery.errorMessage && sortedPolicies.length > 0 ? (
        <section className="compensation-layout" aria-label={t('ariaLabel')}>
          <article className="metric-card">
            <div>
              <h2 className="section-title">{t('policyCoverage')}</h2>
              <p className="settings-card-description">
                {t('policyCoverageDescription', { count: sortedPolicies.length })}
              </p>
            </div>
            <StatusBadge tone="info">{t('readOnly')}</StatusBadge>
          </article>

          <div className="data-table-container">
            <table className="data-table" aria-label={t('tableAriaLabel')}>
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort-trigger"
                      onClick={() =>
                        setSortDirection((currentDirection) =>
                          currentDirection === "asc" ? "desc" : "asc"
                        )
                      }
                    >
                      {t('colPolicy')}
                      <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                  <th>{t('colCountry')}</th>
                  <th>{t('colWeeklyTarget')}</th>
                  <th>{t('colDailyMax')}</th>
                  <th>{t('colBreakRule')}</th>
                  <th>{t('colRounding')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colUpdated')}</th>
                  <th className="table-action-column">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedPolicies.map((policy) => (
                  <tr key={policy.id} className="data-table-row">
                    <td>
                      <div className="documents-cell-copy">
                        <p className="documents-cell-title">{policy.name}</p>
                        <p className="documents-cell-description">
                          {policy.appliesToDepartments && policy.appliesToDepartments.length > 0
                            ? policy.appliesToDepartments.join(", ")
                            : t('allDepartments')}
                        </p>
                      </div>
                    </td>
                    <td>{policy.countryCode ?? t('global')}</td>
                    <td className="numeric">{tCommon('hoursValue', { value: policy.weeklyHoursTarget.toFixed(2) })}</td>
                    <td className="numeric">{tCommon('hoursValue', { value: policy.dailyHoursMax.toFixed(2) })}</td>
                    <td className="numeric">
                      {t('breakRule', { hours: policy.breakAfterHours.toFixed(2), minutes: policy.breakDurationMinutes })}
                    </td>
                    <td>{toSentenceCase(policy.roundingRule)}</td>
                    <td>
                      <StatusBadge tone={policy.isActive ? "success" : "draft"}>
                        {policy.isActive ? tCommon('status.active') : tCommon('status.inactive')}
                      </StatusBadge>
                    </td>
                    <td>
                      <span title={formatDateTimeTooltip(policy.updatedAt, locale)}>
                        {formatRelativeTime(policy.updatedAt, locale)}
                      </span>
                    </td>
                    <td className="table-row-action-cell">
                      <div className="timeatt-row-actions">
                        <button type="button" className="table-row-action">
                          {t('view')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
