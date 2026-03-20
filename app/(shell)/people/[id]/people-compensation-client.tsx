"use client";

import { useTranslations } from "next-intl";

import { CompensationOverview } from "../../../../components/shared/compensation-overview";
import { CompensationSkeleton } from "../../../../components/shared/compensation-skeleton";
import { EmptyState } from "../../../../components/shared/empty-state";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useAdminCompensation, useMeCompensation } from "../../../../hooks/use-compensation";
import { useHrPaymentDetails } from "../../../../hooks/use-payment-details";
import { methodLabel, holdActive } from "../../../../lib/payment-details";

type PeopleCompensationClientProps = {
  employeeId: string;
  mode: "admin" | "me";
};

export function PeopleCompensationClient({
  employeeId,
  mode
}: PeopleCompensationClientProps) {
  const t = useTranslations('compensation');
  const tPay = useTranslations('compensationPaymentDetails');
  const tCommon = useTranslations('common');

  const adminQuery = useAdminCompensation({
    employeeId: mode === "admin" ? employeeId : null,
    enabled: mode === "admin"
  });
  const meQuery = useMeCompensation(mode === "me");
  const paymentQuery = useHrPaymentDetails({ enabled: mode === "admin" });

  const isLoading = mode === "admin" ? adminQuery.isLoading : meQuery.isLoading;
  const errorMessage = mode === "admin" ? adminQuery.errorMessage : meQuery.errorMessage;

  const snapshot =
    mode === "admin"
      ? adminQuery.data?.selectedEmployee
        ? {
            employee: adminQuery.data.selectedEmployee,
            salaryRecords: adminQuery.data.salaryRecords,
            allowances: adminQuery.data.allowances,
            equityGrants: adminQuery.data.equityGrants
          }
        : null
      : meQuery.data;

  const employeePaymentRow = (() => {
    if (mode !== "admin" || !paymentQuery.data?.rows) return null;
    return paymentQuery.data.rows.find((row) => row.employeeId === employeeId) ?? null;
  })();

  return (
    <section aria-label={t('ariaLabel')}>
      {isLoading ? <CompensationSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <>
          <EmptyState
            title={t('dataUnavailable')}
            description={errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              if (mode === "admin") {
                adminQuery.refresh();
              } else {
                meQuery.refresh();
              }
            }}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!isLoading && !errorMessage && !snapshot ? (
        <EmptyState
          title={t('noProfile')}
          description={t('noRecords')}
          ctaLabel={t('backToCrew')}
          ctaHref="/people"
        />
      ) : null}

      {!isLoading && !errorMessage && snapshot ? (
        <CompensationOverview snapshot={snapshot} showEmployeeSummary={mode === "admin"} />
      ) : null}

      {mode === "admin" && !paymentQuery.isLoading && !paymentQuery.errorMessage ? (
        <section className="compensation-section" aria-label={tPay('heading')}>
          <div className="timeoff-section-header">
            <h2 className="section-title">{tPay('heading')}</h2>
            <p className="settings-card-description">{tPay('description')}</p>
          </div>

          {employeePaymentRow && !employeePaymentRow.missingDetails ? (
            <article className="compensation-salary-card">
              <header className="compensation-salary-header">
                <div>
                  <p className="metric-label">{tPay('methodLabel')}</p>
                  <p className="compensation-salary-value">
                    {methodLabel(employeePaymentRow.paymentMethod!)}
                  </p>
                </div>
                <StatusBadge tone={employeePaymentRow.isVerified ? "success" : "pending"}>
                  {employeePaymentRow.isVerified ? tPay('verified') : tPay('pendingVerification')}
                </StatusBadge>
              </header>

              <dl className="compensation-salary-meta">
                <div>
                  <dt>{tPay('destinationLabel')}</dt>
                  <dd className="numeric">
                    {employeePaymentRow.crewTagFull
                      ? `@${employeePaymentRow.crewTagFull}`
                      : employeePaymentRow.maskedDestination ?? "--"}
                  </dd>
                </div>
                <div>
                  <dt>{tPay('currencyLabel')}</dt>
                  <dd className="numeric">{employeePaymentRow.currency ?? "--"}</dd>
                </div>
                <div>
                  <dt>{tPay('holdLabel')}</dt>
                  <dd>
                    {employeePaymentRow.changeEffectiveAt && holdActive(employeePaymentRow.changeEffectiveAt) ? (
                      <StatusBadge tone="warning">{tPay('holdActiveStatus')}</StatusBadge>
                    ) : (
                      tPay('noHold')
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          ) : (
            <EmptyState
              title={tPay('noDetailsTitle')}
              description={tPay('noDetailsDescription')}
            />
          )}
        </section>
      ) : null}
    </section>
  );
}
