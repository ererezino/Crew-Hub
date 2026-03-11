"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";

type AppLocale = "en" | "fr";

type EmployeeDocument = {
  id: string;
  title: string;
  category: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
};

type EmployeeComplianceData = {
  documents: EmployeeDocument[];
};

function documentTone(daysUntil: number | null): "success" | "error" | "pending" {
  if (daysUntil === null) return "success";
  if (daysUntil < 0) return "error";
  if (daysUntil <= 30) return "pending";
  return "success";
}

export function ComplianceEmployeeClient({ userId }: { userId: string }) {
  const t = useTranslations('compliancePage');
  const tNav = useTranslations('nav');
  const locale = useLocale() as AppLocale;

  const [data, setData] = useState<EmployeeComplianceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function documentStatusLabel(daysUntil: number | null): string {
    if (daysUntil === null) return t('noExpiry');
    if (daysUntil < 0) return t('expired');
    if (daysUntil === 0) return t('expiresToday');
    if (daysUntil <= 30) return t('expiresInDays', { count: daysUntil });
    return t('valid');
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(`/api/v1/compliance/employee?userId=${userId}`);
        const json = await response.json();

        if (cancelled) return;

        if (!response.ok || json.error) {
          setErrorMessage(json.error?.message ?? t('unableToLoad'));
          return;
        }

        setData(json.data ?? { documents: [] });
      } catch {
        if (!cancelled) {
          setErrorMessage(t('unableToLoad'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [userId, t]);

  const hasDocuments = data && data.documents.length > 0;

  return (
    <>
      <PageHeader
        title={tNav('compliance')}
        description={tNav('description.compliance')}
      />

      {isLoading ? (
        <section className="compliance-skeleton" aria-hidden="true">
          <div className="compliance-skeleton-metrics">
            <div className="compliance-skeleton-card" />
            <div className="compliance-skeleton-card" />
          </div>
        </section>
      ) : null}

      {!isLoading && errorMessage ? (
        <ErrorState
          title={t('dataUnavailable')}
          message={errorMessage}
        />
      ) : null}

      {!isLoading && !errorMessage && !hasDocuments ? (
        <EmptyState
          title={t('upToDate')}
          description={t('upToDateDescription')}
        />
      ) : null}

      {!isLoading && !errorMessage && hasDocuments ? (
        <section className="settings-layout">
          <div className="compliance-employee-cards">
            {data.documents.map((doc) => (
              <article key={doc.id} className="settings-card">
                <div className="compliance-employee-card-content">
                  <div>
                    <h3 className="settings-card-title">{doc.title}</h3>
                    <p className="settings-card-description">
                      {toSentenceCase(doc.category)}
                      {doc.expiryDate ? (
                        <> &middot; {t('expires', { date: formatRelativeTime(doc.expiryDate, locale) })}</>
                      ) : null}
                    </p>
                  </div>
                  <StatusBadge tone={documentTone(doc.daysUntilExpiry)}>
                    {documentStatusLabel(doc.daysUntilExpiry)}
                  </StatusBadge>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
