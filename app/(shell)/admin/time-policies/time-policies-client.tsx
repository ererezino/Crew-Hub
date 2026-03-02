"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeAttendancePolicies } from "../../../../hooks/use-time-attendance";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";

type SortDirection = "asc" | "desc";

function policiesSkeleton() {
  return (
    <div className="timeoff-table-skeleton" aria-hidden="true">
      <div className="timeoff-table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`time-policy-skeleton-${index}`} className="timeoff-table-skeleton-row" />
      ))}
    </div>
  );
}

export function TimePoliciesClient() {
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
      <PageHeader
        title="Time Policies"
        description="Review attendance rules for overtime thresholds, breaks, and rounding behavior."
      />

      {policiesQuery.isLoading ? policiesSkeleton() : null}

      {!policiesQuery.isLoading && policiesQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Time policies are unavailable"
            description={policiesQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => policiesQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!policiesQuery.isLoading && !policiesQuery.errorMessage && sortedPolicies.length === 0 ? (
        <EmptyState
          title="No policies configured"
          description="Create an attendance policy to enforce breaks and overtime rules."
          ctaLabel="Open Time & Attendance"
          ctaHref="/time-attendance"
        />
      ) : null}

      {!policiesQuery.isLoading && !policiesQuery.errorMessage && sortedPolicies.length > 0 ? (
        <section className="compensation-layout" aria-label="Time policies table">
          <article className="compensation-summary-card">
            <div>
              <h2 className="section-title">Policy coverage</h2>
              <p className="settings-card-description">
                {sortedPolicies.length} attendance policies configured for Crew Hub.
              </p>
            </div>
            <StatusBadge tone="info">Read-only</StatusBadge>
          </article>

          <div className="data-table-container">
            <table className="data-table" aria-label="Attendance policies">
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
                      Policy
                      <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                  <th>Country</th>
                  <th>Weekly target</th>
                  <th>Daily max</th>
                  <th>Break rule</th>
                  <th>Rounding</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="table-action-column">Actions</th>
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
                            : "All departments"}
                        </p>
                      </div>
                    </td>
                    <td>{policy.countryCode ?? "Global"}</td>
                    <td className="numeric">{policy.weeklyHoursTarget.toFixed(2)}h</td>
                    <td className="numeric">{policy.dailyHoursMax.toFixed(2)}h</td>
                    <td className="numeric">
                      After {policy.breakAfterHours.toFixed(2)}h / {policy.breakDurationMinutes}m
                    </td>
                    <td>{policy.roundingRule.replace("_", " ")}</td>
                    <td>
                      <StatusBadge tone={policy.isActive ? "success" : "draft"}>
                        {policy.isActive ? "Active" : "Inactive"}
                      </StatusBadge>
                    </td>
                    <td>
                      <span title={formatDateTimeTooltip(policy.updatedAt)}>
                        {formatRelativeTime(policy.updatedAt)}
                      </span>
                    </td>
                    <td className="table-row-action-cell">
                      <div className="timeatt-row-actions">
                        <button type="button" className="table-row-action">
                          View
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
