"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";

/* ── Types ── */

type HubDetail = {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
};

type HubSection = {
  id: string;
  hub_id: string;
  name: string;
  icon: string | null;
  position: number;
  page_count: number;
};

type HubHomeClientProps = {
  hubId: string;
  isLeadOrAdmin: boolean;
};

/* ── Component ── */

export function HubHomeClient({ hubId, isLeadOrAdmin }: HubHomeClientProps) {
  const t = useTranslations('hubHome');
  const tCommon = useTranslations('common');

  const [hub, setHub] = useState<HubDetail | null>(null);
  const [sections, setSections] = useState<HubSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [addSectionBusy, setAddSectionBusy] = useState(false);
  const [addSectionError, setAddSectionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [hubRes, sectionsRes] = await Promise.all([
        fetch(`/api/v1/team-hubs/${hubId}`),
        fetch(`/api/v1/team-hubs/${hubId}/sections`)
      ]);

      if (!hubRes.ok) {
        throw new Error(t('failedToLoadHub'));
      }

      if (!sectionsRes.ok) {
        throw new Error(t('failedToLoadSections'));
      }

      const hubEnvelope = await hubRes.json();
      const sectionsEnvelope = await sectionsRes.json();

      setHub(hubEnvelope.data?.hub ?? null);
      setSections(Array.isArray(sectionsEnvelope) ? sectionsEnvelope : sectionsEnvelope.data?.sections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [hubId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddSection = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAddSectionBusy(true);
      setAddSectionError(null);
      const form = event.currentTarget;
      const fd = new FormData(form);

      try {
        const res = await fetch(`/api/v1/team-hubs/${hubId}/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"),
            description: fd.get("description") || undefined,
            icon: fd.get("icon") || undefined
          })
        });

        if (!res.ok) {
          const envelope = await res.json().catch(() => null);
          throw new Error(envelope?.error?.message ?? t('failedToCreateSection'));
        }

        setIsAddSectionOpen(false);
        setAddSectionError(null);
        form.reset();
        fetchData();
      } catch (err) {
        setAddSectionError(err instanceof Error ? err.message : t('failedToCreateSection'));
      } finally {
        setAddSectionBusy(false);
      }
    },
    [hubId, fetchData, t]
  );

  if (loading) {
    return (
      <>
        <PageHeader title={t('title')} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--space-4)"
          }}
        >
          {[1, 2, 3].map((n) => (
            <div key={n} className="card" style={{ padding: "var(--space-5)" }}>
              <div className="skeleton-block" style={{ height: 20, width: "50%", marginBottom: "var(--space-2)" }} />
              <div className="skeleton-block" style={{ height: 14, width: "30%" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (error || !hub) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState
          title={t('unableToLoad')}
          description={error ?? t('hubNotFound')}
          ctaLabel={t('backToTeamHub')}
          ctaHref="/team-hub"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={hub.name}
        description={hub.description ?? undefined}
        actions={
          isLeadOrAdmin ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => {
                setAddSectionError(null);
                setIsAddSectionOpen(true);
              }}
            >
              {t('addSection')}
            </button>
          ) : undefined
        }
      />

      <nav style={{ marginBottom: "var(--space-4)" }}>
        <Link href="/team-hub" style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}>
          &larr; {t('allHubs')}
        </Link>
      </nav>

      {sections.length === 0 ? (
        <EmptyState
          title={t('noSections')}
          description={t('noSectionsDescription')}
          ctaLabel={undefined}
          ctaHref={undefined}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--space-4)"
          }}
        >
          {sections.map((section) => (
            <Link
              key={section.id}
              href={`/team-hub/${hubId}/${section.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <article className="card" style={{ padding: "var(--space-5)", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {section.icon ? (
                    <span style={{ fontSize: "var(--font-xl)" }} role="img" aria-hidden="true">
                      {section.icon}
                    </span>
                  ) : null}
                  <h3 style={{ margin: 0, fontSize: "var(--font-lg)", fontWeight: 600 }}>
                    {section.name}
                  </h3>
                </div>
                <p
                  style={{
                    margin: "var(--space-2) 0 0",
                    fontSize: "var(--font-xs)",
                    color: "var(--color-text-muted)"
                  }}
                >
                  {t('pageCount', { count: section.page_count })}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}

      <SlidePanel
        isOpen={isAddSectionOpen}
        title={t('addSectionPanelTitle')}
        description={t('addSectionPanelDescription')}
        onClose={() => {
          if (!addSectionBusy) {
            setAddSectionError(null);
          }
          setIsAddSectionOpen(false);
        }}
      >
        <form onSubmit={handleAddSection} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <label className="field-label">
            {t('nameLabel')}
            <input
              name="name"
              type="text"
              className="input"
              required
              maxLength={200}
              placeholder={t('namePlaceholder')}
              autoFocus
            />
          </label>

          <label className="field-label">
            {t('iconLabel')}
            <input
              name="icon"
              type="text"
              className="input"
              maxLength={4}
              placeholder={t('iconPlaceholder')}
            />
          </label>

          <label className="field-label">
            {t('descriptionLabel')}
            <textarea
              name="description"
              className="input"
              rows={3}
              maxLength={2000}
              placeholder={t('descriptionPlaceholder')}
            />
          </label>

          {addSectionError ? <p className="form-field-error">{addSectionError}</p> : null}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setAddSectionError(null);
                setIsAddSectionOpen(false);
              }}
            >
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={addSectionBusy}>
              {addSectionBusy ? t('adding') : t('addSection')}
            </button>
          </div>
        </form>
      </SlidePanel>
    </>
  );
}
