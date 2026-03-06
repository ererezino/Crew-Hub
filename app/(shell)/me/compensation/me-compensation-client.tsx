"use client";

import { CompensationOverview } from "../../../../components/shared/compensation-overview";
import { CompensationSkeleton } from "../../../../components/shared/compensation-skeleton";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { useMeCompensation } from "../../../../hooks/use-compensation";

type MeCompensationClientProps = {
  embedded?: boolean;
};

export function MeCompensationClient({ embedded = false }: MeCompensationClientProps) {
  const compensationQuery = useMeCompensation();

  const content = (
    <>
      {compensationQuery.isLoading ? <CompensationSkeleton /> : null}

      {!compensationQuery.isLoading && compensationQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Compensation is unavailable"
            description={compensationQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => compensationQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!compensationQuery.isLoading &&
      !compensationQuery.errorMessage &&
      !compensationQuery.data ? (
        <EmptyState
          title="No compensation profile found"
          description="Compensation details will appear here after records are configured."
          ctaLabel="Go to dashboard"
          ctaHref="/dashboard"
        />
      ) : null}

      {!compensationQuery.isLoading &&
      !compensationQuery.errorMessage &&
      compensationQuery.data ? (
        <CompensationOverview snapshot={compensationQuery.data} />
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <>
      <PageHeader
        title="Compensation"
        description="Manage salary, allowances, and equity for team members."
      />
      {content}
    </>
  );
}
