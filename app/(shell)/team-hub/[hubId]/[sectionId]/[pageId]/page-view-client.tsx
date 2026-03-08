"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { SlidePanel } from "../../../../../../components/shared/slide-panel";
import { formatRelativeTime } from "../../../../../../lib/datetime";

/* ── Types ── */

type PageType = "document" | "runbook" | "contact_list" | "reference_list" | "table" | "link";

type TeamHubPage = {
  id: string;
  section_id: string;
  title: string;
  type: PageType;
  content: string | null;
  icon: string | null;
  url: string | null;
  structured_data: Record<string, unknown>[] | null;
  author_name: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type PageViewClientProps = {
  hubId: string;
  sectionId: string;
  pageId: string;
  isLeadOrAdmin: boolean;
};

/* ── Markdown renderer (simple) ── */

function renderMarkdown(raw: string): React.ReactNode[] {
  const lines = raw.split("\n");
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* Headings */
    if (line.startsWith("### ")) {
      nodes.push(
        <h4 key={i} style={{ margin: "var(--space-3) 0 var(--space-1)" }}>
          {applyInlineFormatting(line.slice(4))}
        </h4>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(
        <h3 key={i} style={{ margin: "var(--space-4) 0 var(--space-2)" }}>
          {applyInlineFormatting(line.slice(3))}
        </h3>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      nodes.push(
        <h2 key={i} style={{ margin: "var(--space-5) 0 var(--space-2)" }}>
          {applyInlineFormatting(line.slice(2))}
        </h2>
      );
      continue;
    }

    /* Empty lines */
    if (line.trim() === "") {
      continue;
    }

    /* Paragraph */
    nodes.push(
      <p key={i} style={{ margin: "0 0 var(--space-2)", lineHeight: 1.6 }}>
        {applyInlineFormatting(line)}
      </p>
    );
  }

  return nodes;
}

function applyInlineFormatting(text: string): React.ReactNode {
  /* Replace **bold** with <strong> */
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/* ── Component ── */

export function PageViewClient({ hubId, sectionId, pageId, isLeadOrAdmin }: PageViewClientProps) {
  const [page, setPage] = useState<TeamHubPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Edit panel state */
  const [editOpen, setEditOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* Search state for reference_list */
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/team-hubs/pages/${pageId}`);

      if (!response.ok) {
        throw new Error("Failed to load page.");
      }

      const envelope = await response.json();
      setPage(envelope.data?.page ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setSaveError(null);

      try {
        const response = await fetch(`/api/v1/team-hubs/pages/${pageId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent })
        });

        if (!response.ok) {
          throw new Error("Failed to save changes.");
        }

        const updatedEnvelope = await response.json();
        setPage(updatedEnvelope.data?.page ?? page);
        setEditOpen(false);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    },
    [pageId, editContent]
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Page" />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="skeleton-block" style={{ height: 28, width: "50%" }} />
          <div className="skeleton-block" style={{ height: 16, width: "30%" }} />
          <div className="skeleton-block" style={{ height: 200, width: "100%" }} />
        </div>
      </>
    );
  }

  if (error || !page) {
    return (
      <>
        <PageHeader title="Page" />
        <EmptyState
          title="Unable to load page"
          description={error ?? "Page not found."}
          ctaLabel="Back to section"
          ctaHref={`/team-hub/${hubId}/${sectionId}`}
        />
      </>
    );
  }

  /* Link type: show redirect button */
  if (page.type === "link" && page.url) {
    return (
      <>
        <PageHeader title={page.title} />
        <nav style={{ marginBottom: "var(--space-4)" }}>
          <Link
            href={`/team-hub/${hubId}/${sectionId}`}
            style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}
          >
            &larr; Back to section
          </Link>
        </nav>
        <div className="card" style={{ padding: "var(--space-5)", textAlign: "center" }}>
          <p style={{ marginBottom: "var(--space-4)", color: "var(--color-text-secondary)" }}>
            This page links to an external resource.
          </p>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-accent"
          >
            Go to {page.url}
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={page.title}
        actions={
          isLeadOrAdmin && (page.type === "document" || page.type === "runbook") ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setEditContent(page.content ?? "");
                setEditOpen(true);
              }}
            >
              Edit
            </button>
          ) : undefined
        }
      />

      <nav style={{ marginBottom: "var(--space-3)" }}>
        <Link
          href={`/team-hub/${hubId}/${sectionId}`}
          style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}
        >
          &larr; Back to section
        </Link>
      </nav>

      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          marginBottom: "var(--space-4)",
          fontSize: "var(--font-sm)",
          color: "var(--color-text-muted)"
        }}
      >
        {page.author_name ? <span>By {page.author_name}</span> : null}
        {page.updated_at ? <span>Updated {formatRelativeTime(page.updated_at)}</span> : null}
      </div>

      {/* Document / Runbook content */}
      {(page.type === "document" || page.type === "runbook") && page.content ? (
        <div className="card" style={{ padding: "var(--space-5)" }}>
          {renderMarkdown(page.content)}
        </div>
      ) : null}

      {/* Contact list as table */}
      {page.type === "contact_list" && page.structured_data ? (
        <DataTable data={page.structured_data} />
      ) : null}

      {/* Reference list (searchable) */}
      {page.type === "reference_list" && page.structured_data ? (
        <div>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <input
              type="search"
              placeholder="Search references..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input"
              style={{ maxWidth: 400, width: "100%" }}
            />
          </div>
          <SearchableList data={page.structured_data} query={searchQuery} />
        </div>
      ) : null}

      {/* Table */}
      {page.type === "table" && page.structured_data ? (
        <DataTable data={page.structured_data} />
      ) : null}

      {/* Fallback for pages with no renderable content */}
      {!page.content && !page.structured_data && page.type !== "link" ? (
        <EmptyState
          title="No content"
          description="This page doesn't have any content yet."
        />
      ) : null}

      {/* Edit slide panel */}
      <SlidePanel
        isOpen={editOpen}
        title={`Edit: ${page.title}`}
        description="Update the page content below."
        onClose={() => setEditOpen(false)}
      >
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", height: "100%" }}>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="input"
            style={{
              flex: 1,
              minHeight: 300,
              fontFamily: "monospace",
              fontSize: "var(--font-sm)",
              resize: "vertical"
            }}
          />
          {saveError ? (
            <p style={{ color: "var(--color-error)", fontSize: "var(--font-sm)", margin: 0 }}>
              {saveError}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </SlidePanel>
    </>
  );
}

/* ── Data Table ── */

function DataTable({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-sm)" }}>No data.</p>;
  }

  const columns = Object.keys(data[0]);

  return (
    <div className="card" style={{ padding: "var(--space-4)", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-sm)" }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-3)",
                  borderBottom: "2px solid var(--color-border)",
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

/* ── Searchable List (for reference_list) ── */

function SearchableList({ data, query }: { data: Record<string, unknown>[]; query: string }) {
  const lowerQuery = query.toLowerCase();

  const filtered = query
    ? data.filter((item) =>
        Object.values(item).some((val) =>
          String(val ?? "")
            .toLowerCase()
            .includes(lowerQuery)
        )
      )
    : data;

  if (filtered.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-sm)" }}>
        {query ? "No matching results." : "No references."}
      </p>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {filtered.map((item, idx) => (
        <article key={idx} className="card" style={{ padding: "var(--space-4)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            {columns.map((col) => (
              <div key={col} style={{ fontSize: "var(--font-sm)" }}>
                <span style={{ fontWeight: 600, textTransform: "capitalize", marginRight: "var(--space-2)" }}>
                  {col.replace(/_/g, " ")}:
                </span>
                <span style={{ color: "var(--color-text-secondary)" }}>{String(item[col] ?? "")}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
