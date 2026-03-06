"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useHrPaymentDetails } from "../../../../hooks/use-payment-details";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip } from "../../../../lib/datetime";
import { formatHoldCountdown, holdSecondsRemaining, methodLabel } from "../../../../lib/payment-details";

type SortDirection = "asc" | "desc";

function detailsTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`payment-details-row-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function AdminPaymentDetailsClient() {
  const paymentDetailsQuery = useHrPaymentDetails();

  const [nameSortDirection, setNameSortDirection] = useState<SortDirection>("asc");
  const [currentTick, setCurrentTick] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const sortedRows = useMemo(() => {
    const rows = paymentDetailsQuery.data?.rows ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      const comparison = leftRow.fullName.localeCompare(rightRow.fullName);

      if (nameSortDirection === "asc") {
        return comparison;
      }

      return comparison * -1;
    });
  }, [nameSortDirection, paymentDetailsQuery.data?.rows]);

  const missingCount = useMemo(
    () => sortedRows.filter((row) => row.missingDetails).length,
    [sortedRows]
  );

  return (
    <>
      <PageHeader
        title="Payment Details"
        description="Review masked employee payment destinations, hold windows, and missing records."
      />

      {paymentDetailsQuery.isLoading ? detailsTableSkeleton() : null}

      {!paymentDetailsQuery.isLoading && paymentDetailsQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Payment details are unavailable"
            description={paymentDetailsQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => paymentDetailsQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!paymentDetailsQuery.isLoading &&
      !paymentDetailsQuery.errorMessage &&
      sortedRows.length === 0 ? (
        <EmptyState
          title="No employee records found"
          description="Seed employee data or complete onboarding profiles to populate payment details."
        />
      ) : null}

      {!paymentDetailsQuery.isLoading &&
      !paymentDetailsQuery.errorMessage &&
      sortedRows.length > 0 ? (
        <section className="payment-details-layout" aria-label="Employee payment details table">
          <article className="payment-details-card">
            <header className="payment-details-card-header">
              <div>
                <h2 className="section-title">Coverage summary</h2>
                <p className="settings-card-description">
                  {sortedRows.length - missingCount} of {sortedRows.length} employees have primary payment details.
                </p>
              </div>
              <StatusBadge tone={missingCount > 0 ? "warning" : "success"}>
                {missingCount > 0 ? `${missingCount} missing` : "All covered"}
              </StatusBadge>
            </header>
          </article>

          <div className="data-table-container">
            <table className="data-table" aria-label="Employee payment details">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort-trigger"
                      onClick={() =>
                        setNameSortDirection((currentDirection) =>
                          currentDirection === "asc" ? "desc" : "asc"
                        )
                      }
                    >
                      Employee
                      <span className="numeric">
                        {nameSortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </th>
                  <th>Method</th>
                  <th>Destination</th>
                  <th>Currency</th>
                  <th>Verification</th>
                  <th>Hold</th>
                  <th>Status</th>
                  <th className="table-action-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const secondsRemaining = row.changeEffectiveAt
                    ? holdSecondsRemaining(row.changeEffectiveAt, new Date(currentTick))
                    : 0;

                  const holdActive = secondsRemaining > 0;

                  return (
                    <tr key={row.employeeId} className="data-table-row">
                      <td>
                        <div className="payment-details-employee-cell">
                          <p className="payment-details-employee-name">{row.fullName}</p>
                          <p className="settings-card-description">{row.email}</p>
                          <p className="settings-card-description country-chip">
                            <span>{countryFlagFromCode(row.countryCode)}</span>
                            <span>{countryNameFromCode(row.countryCode)}</span>
                          </p>
                        </div>
                      </td>
                      <td>
                        {row.paymentMethod ? (
                          <StatusBadge tone="info">{methodLabel(row.paymentMethod)}</StatusBadge>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="numeric">{row.maskedDestination ?? "--"}</td>
                      <td className="numeric">{row.currency ?? "--"}</td>
                      <td>
                        {row.missingDetails ? (
                          "--"
                        ) : (
                          <StatusBadge tone={row.isVerified ? "success" : "pending"}>
                            {row.isVerified ? "Verified" : "Pending"}
                          </StatusBadge>
                        )}
                      </td>
                      <td>
                        {row.changeEffectiveAt ? (
                          <span
                            className="numeric"
                            title={formatDateTimeTooltip(row.changeEffectiveAt)}
                          >
                            {holdActive ? formatHoldCountdown(secondsRemaining) : "Active"}
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={row.missingDetails ? "warning" : "success"}>
                          {row.missingDetails ? "Missing" : "On file"}
                        </StatusBadge>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="payment-details-row-actions">
                          <Link
                            className="table-row-action"
                            href={`/people/${row.employeeId}?tab=compensation`}
                          >
                            View profile
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
