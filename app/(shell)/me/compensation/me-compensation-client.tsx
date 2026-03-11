"use client";

import { useTranslations } from "next-intl";

import { CompensationOverview } from "../../../../components/shared/compensation-overview";
import { CompensationSkeleton } from "../../../../components/shared/compensation-skeleton";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { useMeCompensation } from "../../../../hooks/use-compensation";

type MeCompensationClientProps = {
  embedded?: boolean;
};

export function MeCompensationClient({ embedded = false }: MeCompensationClientProps) {
  const t = useTranslations('compensation');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const compensationQuery = useMeCompensation();

  const content = (
    <>
      {compensationQuery.isLoading ? <CompensationSkeleton /> : null}

      {!compensationQuery.isLoading && compensationQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={compensationQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => compensationQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!compensationQuery.isLoading &&
      !compensationQuery.errorMessage &&
      !compensationQuery.data ? (
        <EmptyState
          title={t('noProfile')}
          description={t('noProfileDescription')}
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
        title={tNav('compensation')}
        description={tNav('description.compensation')}
      />
      {content}
    </>
  );
}
