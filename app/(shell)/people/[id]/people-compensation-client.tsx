"use client";

import { useTranslations } from "next-intl";

import { CompensationOverview } from "../../../../components/shared/compensation-overview";
import { CompensationSkeleton } from "../../../../components/shared/compensation-skeleton";
import { EmptyState } from "../../../../components/shared/empty-state";
import { useAdminCompensation, useMeCompensation } from "../../../../hooks/use-compensation";

type PeopleCompensationClientProps = {
  employeeId: string;
  mode: "admin" | "me";
};

export function PeopleCompensationClient({
  employeeId,
  mode
}: PeopleCompensationClientProps) {
  const t = useTranslations('compensation');
  const tCommon = useTranslations('common');

  const adminQuery = useAdminCompensation({
    employeeId: mode === "admin" ? employeeId : null,
    enabled: mode === "admin"
  });
  const meQuery = useMeCompensation(mode === "me");

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
    </section>
  );
}
