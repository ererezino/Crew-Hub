"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { SlidePanel } from "../../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { formatRelativeTime } from "../../../../../lib/datetime";

type AppLocale = "en" | "fr";

/* ── Types ── */

type SectionDetail = {
  id: string;
  hub_id: string;
  name: string;
  icon: string | null;
  description: string | null;
};

type PageType = "document" | "runbook" | "contact_list" | "reference_list" | "table" | "link";

type SectionPage = {
  id: string;
  section_id: string;
  title: string;
  type: PageType;
  icon: string | null;
  url: string | null;
  updated_at: string | null;
  structured_data: Record<string, unknown>[] | null;
};

type SectionClientProps = {
  hubId: string;
  sectionId: string;
  isLeadOrAdmin: boolean;
};

/* ── Helpers ── */

function toneForPageType(type: PageType) {
  switch (type) {
    case "document":
      return "info" as const;
    case "runbook":
      return "processing" as const;
    case "contact_list":
      return "success" as const;
    case "reference_list":
      return "draft" as const;
    case "table":
      return "pending" as const;
    case "link":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

const PAGE_TYPE_LABEL_KEYS: Record<PageType, string> = {
  document: "typeDocument",
  runbook: "typeRunbook",
  contact_list: "typeContacts",
  reference_list: "typeReference",
  table: "typeTable",
  link: "typeLink"
};

/* ── Component ── */

export function SectionClient({ hubId, sectionId, isLeadOrAdmin }: SectionClientProps) {
  const t = useTranslations('teamHubSection');
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const [section, setSection] = useState<SectionDetail | null>(null);
  const [pages, setPages] = useState<SectionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddPageOpen, setIsAddPageOpen] = useState(false);
  const [addPageBusy, setAddPageBusy] = useState(false);
  const [addPageError, setAddPageError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sectionRes, pagesRes] = await Promise.all([
        fetch(`/api/v1/team-hubs/${hubId}/sections/${sectionId}`),
        fetch(`/api/v1/team-hubs/${hubId}/sections/${sectionId}/pages`)
      ]);

      if (!sectionRes.ok) {
        throw new Error(t('errorLoadSection'));
      }

      if (!pagesRes.ok) {
        throw new Error(t('errorLoadPages'));
      }

      const sectionEnvelope = await sectionRes.json();
      const pagesEnvelope = await pagesRes.json();

      setSection(sectionEnvelope.data?.section ?? null);
      setPages(Array.isArray(pagesEnvelope) ? pagesEnvelope : pagesEnvelope.data?.pages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon('error.generic'));
    } finally {
      setLoading(false);
    }
  }, [hubId, sectionId, t, tCommon]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddPage = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAddPageBusy(true);
      setAddPageError(null);
      const form = event.currentTarget;
      const fd = new FormData(form);

      try {
        const res = await fetch(`/api/v1/team-hubs/${hubId}/sections/${sectionId}/pages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: fd.get("title"),
            pageType: fd.get("pageType") || "document",
            content: fd.get("content") || undefined,
            icon: fd.get("icon") || undefined
          })
        });

        if (!res.ok) {
          const envelope = await res.json().catch(() => null);
          throw new Error(envelope?.error?.message ?? t('errorCreatePage'));
        }

        setIsAddPageOpen(false);
        setAddPageError(null);
        form.reset();
        fetchData();
      } catch (err) {
        setAddPageError(err instanceof Error ? err.message : t('errorCreatePage'));
      } finally {
        setAddPageBusy(false);
      }
    },
    [hubId, sectionId, fetchData, t]
  );

  if (loading) {
    return (
      <>
        <PageHeader title={t('loadingTitle')} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="card" style={{ padding: "var(--space-4)" }}>
              <div className="skeleton-block" style={{ height: 18, width: "45%" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (error || !section) {
    return (
      <>
        <PageHeader title={t('loadingTitle')} />
        <EmptyState
          title={t('unavailable')}
          description={error ?? t('notFound')}
          ctaLabel={t('backToHub')}
          ctaHref={`/team-hub/${hubId}`}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={section.name}
        description={section.description ?? undefined}
        actions={
          isLeadOrAdmin ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => {
                setAddPageError(null);
                setIsAddPageOpen(true);
              }}
            >
              {t('addPage')}
            </button>
          ) : undefined
        }
      />

      <nav style={{ marginBottom: "var(--space-4)" }}>
        <Link href={`/team-hub/${hubId}`} style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}>
          &larr; {t('backToHub')}
        </Link>
      </nav>

      {pages.length === 0 ? (
        <EmptyState
          title={t('noPages')}
          description={t('noPagesDescription')}
          ctaLabel={undefined}
          ctaHref={undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {pages.map((page) => {
            /* contact_list: render inline table */
            if (page.type === "contact_list" && page.structured_data && page.structured_data.length > 0) {
              return (
                <article key={page.id} className="card" style={{ padding: "var(--space-4)" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "var(--space-3)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      {page.icon ? (
                        <span style={{ fontSize: "var(--font-lg)" }} role="img" aria-hidden="true">
                          {page.icon}
                        </span>
                      ) : null}
                      <h4 style={{ margin: 0, fontWeight: 600 }}>{page.title}</h4>
                      <StatusBadge tone={toneForPageType(page.type)}>
                        {td(PAGE_TYPE_LABEL_KEYS[page.type])}
                      </StatusBadge>
                    </div>
                    {page.updated_at ? (
                      <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                        {formatRelativeTime(page.updated_at, locale)}
                      </span>
                    ) : null}
                  </div>
                  <ContactTable data={page.structured_data} noDataLabel={t('noContacts')} />
                </article>
              );
            }

            /* link: render as external link */
            if (page.type === "link" && page.url) {
              return (
                <a
                  key={page.id}
                  href={page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <article className="card" style={{ padding: "var(--space-4)", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        {page.icon ? (
                          <span style={{ fontSize: "var(--font-lg)" }} role="img" aria-hidden="true">
                            {page.icon}
                          </span>
                        ) : null}
                        <h4 style={{ margin: 0, fontWeight: 600 }}>{page.title}</h4>
                        <StatusBadge tone={toneForPageType(page.type)}>
                          {td(PAGE_TYPE_LABEL_KEYS[page.type])}
                        </StatusBadge>
                        <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                          &#8599;
                        </span>
                      </div>
                      {page.updated_at ? (
                        <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                          {formatRelativeTime(page.updated_at, locale)}
                        </span>
                      ) : null}
                    </div>
                  </article>
                </a>
              );
            }

            /* document / runbook / reference_list / table: link to page view */
            return (
              <Link
                key={page.id}
                href={`/team-hub/${hubId}/${sectionId}/${page.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <article className="card" style={{ padding: "var(--space-4)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      {page.icon ? (
                        <span style={{ fontSize: "var(--font-lg)" }} role="img" aria-hidden="true">
                          {page.icon}
                        </span>
                      ) : null}
                      <h4 style={{ margin: 0, fontWeight: 600 }}>{page.title}</h4>
                      <StatusBadge tone={toneForPageType(page.type)}>
                        {td(PAGE_TYPE_LABEL_KEYS[page.type])}
                      </StatusBadge>
                    </div>
                    {page.updated_at ? (
                      <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                        {formatRelativeTime(page.updated_at, locale)}
                      </span>
                    ) : null}
                  </div>
                </article>
              </Link>
            );
          })}
        </div>
      )}

      <SlidePanel
        isOpen={isAddPageOpen}
        title={t('addPagePanel')}
        description={t('addPageDescription')}
        onClose={() => {
          if (!addPageBusy) {
            setAddPageError(null);
          }
          setIsAddPageOpen(false);
        }}
      >
        <form onSubmit={handleAddPage} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <label className="field-label">
            {t('titleLabel')}
            <input
              name="title"
              type="text"
              className="input"
              required
              maxLength={300}
              placeholder={t('titlePlaceholder')}
              autoFocus
            />
          </label>

          <label className="field-label">
            {t('typeLabel')}
            <select name="pageType" className="input" defaultValue="document">
              <option value="document">{t('typeDocument')}</option>
              <option value="runbook">{t('typeRunbook')}</option>
              <option value="contact_list">{t('typeContacts')}</option>
              <option value="reference_list">{t('typeReference')}</option>
              <option value="table">{t('typeTable')}</option>
              <option value="link">{t('typeLink')}</option>
            </select>
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
            {t('contentLabel')}
            <textarea
              name="content"
              className="input"
              rows={5}
              placeholder={t('contentPlaceholder')}
            />
          </label>

          {addPageError ? <p className="form-field-error">{addPageError}</p> : null}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setAddPageError(null);
                setIsAddPageOpen(false);
              }}
            >
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={addPageBusy}>
              {addPageBusy ? t('adding') : t('addPage')}
            </button>
          </div>
        </form>
      </SlidePanel>
    </>
  );
}

/* ── Contact Table (inline) ── */

function ContactTable({ data, noDataLabel }: { data: Record<string, unknown>[]; noDataLabel: string }) {
  if (data.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-sm)" }}>{noDataLabel}</p>;
  }

  const columns = Object.keys(data[0]);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-sm)" }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-3)",
                  borderBottom: "1px solid var(--color-border)",
                  fontWeight: 600,
                  textTransform: "capitalize",
                  whiteSpace: "nowrap"
                }}
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td
                  key={col}
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    borderBottom: "1px solid var(--color-border)",
                    whiteSpace: "nowrap"
                  }}
                >
                  {String(row[col] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
