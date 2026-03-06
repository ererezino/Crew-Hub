"use client";

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
    <section aria-label="People compensation tab">
      {isLoading ? <CompensationSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <>
          <EmptyState
            title="Compensation data is unavailable"
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
            Retry
          </button>
        </>
      ) : null}

      {!isLoading && !errorMessage && !snapshot ? (
        <EmptyState
          title="No compensation profile found"
          description="No compensation records were found for this crew member."
          ctaLabel="Back to people"
          ctaHref="/people"
        />
      ) : null}

      {!isLoading && !errorMessage && snapshot ? (
        <CompensationOverview snapshot={snapshot} showEmployeeSummary={mode === "admin"} />
      ) : null}
    </section>
  );
}
