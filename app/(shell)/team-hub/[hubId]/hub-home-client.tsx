"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";

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
  const [hub, setHub] = useState<HubDetail | null>(null);
  const [sections, setSections] = useState<HubSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [hubRes, sectionsRes] = await Promise.all([
        fetch(`/api/v1/team-hubs/${hubId}`),
        fetch(`/api/v1/team-hubs/${hubId}/sections`)
      ]);

      if (!hubRes.ok) {
        throw new Error("Failed to load hub details.");
      }

      if (!sectionsRes.ok) {
        throw new Error("Failed to load hub sections.");
      }

      const hubEnvelope = await hubRes.json();
      const sectionsEnvelope = await sectionsRes.json();

      setHub(hubEnvelope.data?.hub ?? null);
      setSections(Array.isArray(sectionsEnvelope) ? sectionsEnvelope : sectionsEnvelope.data?.sections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <>
        <PageHeader title="Team Hub" />
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
        <PageHeader title="Team Hub" />
        <EmptyState
          title="Unable to load hub"
          description={error ?? "Hub not found."}
          ctaLabel="Back to Team Hub"
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
        actions={undefined}
      />

      <nav style={{ marginBottom: "var(--space-4)" }}>
        <Link href="/team-hub" style={{ fontSize: "var(--font-sm)", color: "var(--color-text-muted)" }}>
          &larr; All Hubs
        </Link>
      </nav>

      {sections.length === 0 ? (
        <EmptyState
          title="No sections yet"
          description="This hub doesn't have any sections. Sections help organize your pages into logical groups."
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
                  {section.page_count} {section.page_count === 1 ? "page" : "pages"}
                </p>
              </article>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
