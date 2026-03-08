"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { formatRelativeTime } from "../../../../../lib/datetime";

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

function labelForPageType(type: PageType): string {
  switch (type) {
    case "document":
      return "Document";
    case "runbook":
      return "Runbook";
    case "contact_list":
      return "Contacts";
    case "reference_list":
      return "Reference";
    case "table":
      return "Table";
    case "link":
      return "Link";
    default:
      return type;
  }
}

/* ── Component ── */

export function SectionClient({ hubId, sectionId, isLeadOrAdmin }: SectionClientProps) {
  const [section, setSection] = useState<SectionDetail | null>(null);
  const [pages, setPages] = useState<SectionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sectionRes, pagesRes] = await Promise.all([
        fetch(`/api/v1/team-hubs/${hubId}/sections/${sectionId}`),
        fetch(`/api/v1/team-hubs/${hubId}/sections/${sectionId}/pages`)
      ]);

      if (!sectionRes.ok) {
        throw new Error("Failed to load section details.");
      }

      if (!pagesRes.ok) {
        throw new Error("Failed to load pages.");
      }

      const sectionEnvelope = await sectionRes.json();
      const pagesEnvelope = await pagesRes.json();

      setSection(sectionEnvelope.data?.section ?? null);
      setPages(Array.isArray(pagesEnvelope) ? pagesEnvelope : pagesEnvelope.data?.pages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }, [hubId, sectionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <>
        <PageHeader title="Section" />
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
        <PageHeader title="Section" />
        <EmptyState
          title="Unable to load section"
          description={error ?? "Section not found."}
          ctaLabel="Back to hub"
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
        actions={undefined}
      />

      <nav style={{ marginBottom: "var(--space-4)" }}>
        <Link href={`/team-hub/${hubId}`} style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}>
          &larr; Back to hub
        </Link>
      </nav>

      {pages.length === 0 ? (
        <EmptyState
          title="No pages yet"
          description="This section doesn't have any pages. Add documents, contacts, runbooks, and more."
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
                        {labelForPageType(page.type)}
                      </StatusBadge>
                    </div>
                    {page.updated_at ? (
                      <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                        {formatRelativeTime(page.updated_at)}
                      </span>
                    ) : null}
                  </div>
                  <ContactTable data={page.structured_data} />
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
                          {labelForPageType(page.type)}
                        </StatusBadge>
                        <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                          &#8599;
                        </span>
                      </div>
                      {page.updated_at ? (
                        <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                          {formatRelativeTime(page.updated_at)}
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
                        {labelForPageType(page.type)}
                      </StatusBadge>
                    </div>
                    {page.updated_at ? (
                      <span style={{ fontSize: "var(--font-xs)", color: "var(--color-text-muted)" }}>
                        {formatRelativeTime(page.updated_at)}
                      </span>
                    ) : null}
                  </div>
                </article>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── Contact Table (inline) ── */

function ContactTable({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-sm)" }}>No contacts.</p>;
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
