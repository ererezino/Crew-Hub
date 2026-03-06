"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";

/* ── Types ── */

type TeamHub = {
  id: string;
  name: string;
  department: string | null;
  description: string | null;
  section_count: number;
  page_count: number;
};

type TeamHubClientProps = {
  isAdmin: boolean;
};

/* ── Component ── */

export function TeamHubClient({ isAdmin }: TeamHubClientProps) {
  const [hubs, setHubs] = useState<TeamHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHubs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/team-hubs");

      if (!response.ok) {
        throw new Error("Failed to load team hubs.");
      }

      const data = await response.json();
      const items: TeamHub[] = Array.isArray(data) ? data : data.hubs ?? [];
      setHubs(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  if (loading) {
    return (
      <>
        <PageHeader
          title="Team Hub"
          description="Your department's knowledge base: guides, contacts, and resources."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--space-4)"
          }}
        >
          {[1, 2, 3].map((n) => (
            <div key={n} className="card" style={{ padding: "var(--space-5)" }}>
              <div className="skeleton-block" style={{ height: 24, width: "60%", marginBottom: "var(--space-2)" }} />
              <div className="skeleton-block" style={{ height: 16, width: "40%", marginBottom: "var(--space-3)" }} />
              <div className="skeleton-block" style={{ height: 14, width: "80%" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Team Hub"
          description="Your department's knowledge base: guides, contacts, and resources."
        />
        <EmptyState
          title="Unable to load hubs"
          description={error}
          ctaLabel="Retry"
          onCtaClick={fetchHubs}
        />
      </>
    );
  }

  if (hubs.length === 0) {
    return (
      <>
        <PageHeader
          title="Team Hub"
          description="Your department's knowledge base: guides, contacts, and resources."
        />
        <EmptyState
          title="No team hubs available"
          description="You don't have access to any team hubs yet. Contact your administrator for access."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  /* Single hub: navigate directly */
  if (hubs.length === 1 && !isAdmin) {
    return <HubHome hub={hubs[0]} />;
  }

  return (
    <>
      <PageHeader
        title="Team Hub"
        description="Your department's knowledge base: guides, contacts, and resources."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "var(--space-4)"
        }}
      >
        {hubs.map((hub) => (
          <Link
            key={hub.id}
            href={`/team-hub/${hub.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <article className="card" style={{ padding: "var(--space-5)", cursor: "pointer" }}>
              <h3 style={{ margin: 0, fontSize: "var(--font-lg)", fontWeight: 600 }}>
                {hub.name}
              </h3>
              {hub.department ? (
                <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}>
                  {hub.department}
                </p>
              ) : null}
              {hub.description ? (
                <p style={{ margin: "var(--space-2) 0 0", fontSize: "var(--font-sm)", color: "var(--color-text-secondary)" }}>
                  {hub.description}
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  marginTop: "var(--space-3)",
                  fontSize: "var(--font-xs)",
                  color: "var(--color-text-muted)"
                }}
              >
                <span>{hub.section_count} {hub.section_count === 1 ? "section" : "sections"}</span>
                <span>{hub.page_count} {hub.page_count === 1 ? "page" : "pages"}</span>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ── Inline Hub Home (for single-hub users) ── */

function HubHome({ hub }: { hub: TeamHub }) {
  return (
    <>
      <PageHeader
        title={hub.name}
        description={hub.description ?? "Your department's knowledge base."}
      />
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-sm)" }}>
        Redirecting to your hub...
      </p>
      <meta httpEquiv="refresh" content={`0;url=/team-hub/${hub.id}`} />
    </>
  );
}
