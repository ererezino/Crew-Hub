"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useHrPaymentDetails } from "../../../../hooks/use-payment-details";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip } from "../../../../lib/datetime";
import { formatHoldCountdown, holdSecondsRemaining, methodLabel } from "../../../../lib/payment-details";

type AppLocale = "en" | "fr";
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
  const t = useTranslations('adminPaymentDetails');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

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
        title={t('title')}
        description={t('description')}
      />

      {paymentDetailsQuery.isLoading ? detailsTableSkeleton() : null}

      {!paymentDetailsQuery.isLoading && paymentDetailsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={paymentDetailsQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => paymentDetailsQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!paymentDetailsQuery.isLoading &&
      !paymentDetailsQuery.errorMessage &&
      sortedRows.length === 0 ? (
        <EmptyState
          title={t('noRecords')}
          description={t('noRecordsDescription')}
        />
      ) : null}

      {!paymentDetailsQuery.isLoading &&
      !paymentDetailsQuery.errorMessage &&
      sortedRows.length > 0 ? (
        <section className="payment-details-layout" aria-label={t('ariaLabel')}>
          <article className="payment-details-card">
            <header className="payment-details-card-header">
              <div>
                <h2 className="section-title">{t('coverageSummary')}</h2>
                <p className="settings-card-description">
                  {t('coverageDescription', { covered: sortedRows.length - missingCount, total: sortedRows.length })}
                </p>
              </div>
              <StatusBadge tone={missingCount > 0 ? "warning" : "success"}>
                {missingCount > 0 ? t('missingCount', { count: missingCount }) : t('allCovered')}
              </StatusBadge>
            </header>
          </article>

          <div className="data-table-container">
            <table className="data-table" aria-label={t('ariaLabel')}>
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
                      {t('colEmployee')}
                      <span className="numeric">
                        {nameSortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </th>
                  <th>{t('colMethod')}</th>
                  <th>{t('colDestination')}</th>
                  <th>{t('colCurrency')}</th>
                  <th>{t('colVerification')}</th>
                  <th>{t('colHold')}</th>
                  <th>{t('colStatus')}</th>
                  <th className="table-action-column">{t('colActions')}</th>
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
                            <span>{countryNameFromCode(row.countryCode, locale)}</span>
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
                      <td className="numeric">{row.crewTagFull ? `@${row.crewTagFull}` : row.maskedDestination ?? "--"}</td>
                      <td className="numeric">{row.currency ?? "--"}</td>
                      <td>
                        {row.missingDetails ? (
                          "--"
                        ) : (
                          <StatusBadge tone={row.isVerified ? "success" : "pending"}>
                            {row.isVerified ? t('verified') : tCommon('status.pending')}
                          </StatusBadge>
                        )}
                      </td>
                      <td>
                        {row.changeEffectiveAt ? (
                          <span
                            className="numeric"
                            title={formatDateTimeTooltip(row.changeEffectiveAt, locale)}
                          >
                            {holdActive ? formatHoldCountdown(secondsRemaining) : t('holdActive')}
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={row.missingDetails ? "warning" : "success"}>
                          {row.missingDetails ? t('missing') : t('onFile')}
                        </StatusBadge>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="payment-details-row-actions">
                          <Link
                            className="table-row-action"
                            href={`/people/${row.employeeId}?tab=compensation`}
                          >
                            {t('viewProfile')}
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
