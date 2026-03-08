"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { FeatureBanner } from "../../../components/shared/feature-banner";
import { NavIcon } from "../../../components/shared/nav-icon";
import { PageHeader } from "../../../components/shared/page-header";

/* ── Types ── */

type TeamHub = {
  id: string;
  name: string;
  department: string | null;
  description: string | null;
  icon: string | null;
  sectionCount?: number;
  pageCount?: number;
  /* API may return snake_case from envelope parsing */
  section_count?: number;
  page_count?: number;
};

type TeamHubClientProps = {
  isAdmin: boolean;
  userDepartment: string | null;
  userName: string;
};

/* ── Department → color mapping ── */

const DEPT_COLORS: Record<string, { gradient: string; accent: string; light: string }> = {
  marketing: { gradient: "linear-gradient(135deg, #f59e0b, #f97316)", accent: "#f59e0b", light: "#fffbeb" },
  "content & marketing": { gradient: "linear-gradient(135deg, #f59e0b, #f97316)", accent: "#f59e0b", light: "#fffbeb" },
  "customer success": { gradient: "linear-gradient(135deg, #10b981, #059669)", accent: "#10b981", light: "#ecfdf5" },
  engineering: { gradient: "linear-gradient(135deg, #6366f1, #4f46e5)", accent: "#6366f1", light: "#eef2ff" },
  finance: { gradient: "linear-gradient(135deg, #0ea5e9, #0284c7)", accent: "#0ea5e9", light: "#f0f9ff" },
  hr: { gradient: "linear-gradient(135deg, #ec4899, #db2777)", accent: "#ec4899", light: "#fdf2f8" },
  "human resources": { gradient: "linear-gradient(135deg, #ec4899, #db2777)", accent: "#ec4899", light: "#fdf2f8" },
  operations: { gradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)", accent: "#8b5cf6", light: "#f5f3ff" },
  sales: { gradient: "linear-gradient(135deg, #ef4444, #dc2626)", accent: "#ef4444", light: "#fef2f2" },
  design: { gradient: "linear-gradient(135deg, #f472b6, #ec4899)", accent: "#f472b6", light: "#fdf2f8" },
  legal: { gradient: "linear-gradient(135deg, #64748b, #475569)", accent: "#64748b", light: "#f8fafc" }
};

const DEFAULT_DEPT_COLOR = { gradient: "linear-gradient(135deg, #94a3b8, #64748b)", accent: "#64748b", light: "#f8fafc" };

const DEPT_ICONS: Record<string, string> = {
  marketing: "Megaphone",
  "content & marketing": "Megaphone",
  "customer success": "Headphones",
  engineering: "Code",
  finance: "Coins",
  hr: "Users",
  "human resources": "Users",
  operations: "Settings",
  sales: "Target",
  design: "PenTool",
  legal: "ScrollText"
};

function getDeptColor(department: string | null) {
  if (!department) return DEFAULT_DEPT_COLOR;
  return DEPT_COLORS[department.toLowerCase()] ?? DEFAULT_DEPT_COLOR;
}

function getDeptIcon(department: string | null, hubIcon: string | null) {
  if (hubIcon) return hubIcon;
  if (!department) return "BookOpen";
  return DEPT_ICONS[department.toLowerCase()] ?? "BookOpen";
}

function getHubCounts(hub: TeamHub) {
  const sections = hub.sectionCount ?? hub.section_count ?? 0;
  const pages = hub.pageCount ?? hub.page_count ?? 0;
  return { sections, pages };
}

/* ── Component ── */

export function TeamHubClient({ isAdmin, userDepartment, userName }: TeamHubClientProps) {
  const [hubs, setHubs] = useState<TeamHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestedHubIds, setRequestedHubIds] = useState<Set<string>>(new Set());
  const [requestingHubId, setRequestingHubId] = useState<string | null>(null);

  const fetchHubs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/team-hubs");

      if (!response.ok) {
        throw new Error("Failed to load team hubs.");
      }

      const envelope = await response.json();
      const items: TeamHub[] = Array.isArray(envelope) ? envelope : envelope.data?.hubs ?? [];
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

  const isOwnTeam = useCallback(
    (hub: TeamHub) => {
      if (isAdmin) return true;
      if (!userDepartment || !hub.department) return false;
      return hub.department.toLowerCase() === userDepartment.toLowerCase();
    },
    [isAdmin, userDepartment]
  );

  const handleRequestAccess = useCallback(
    async (hub: TeamHub) => {
      if (requestingHubId || requestedHubIds.has(hub.id)) return;

      setRequestingHubId(hub.id);
      try {
        await fetch("/api/v1/notifications/request-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hubId: hub.id,
            hubName: hub.name,
            department: hub.department,
            reason: `${userName} is requesting access to the ${hub.name} team hub.`
          })
        });
      } catch {
        // Best effort
      }
      setRequestedHubIds((prev) => new Set([...prev, hub.id]));
      setRequestingHubId(null);
    },
    [requestedHubIds, requestingHubId, userName]
  );

  if (loading) {
    return (
      <>
        <PageHeader
          title="Team Hub"
          description="Your department's knowledge base: guides, contacts, and resources."
        />
        <div className="thub-grid">
          {[1, 2, 3].map((n) => (
            <div key={n} className="thub-skeleton-card">
              <div className="thub-skeleton-accent" />
              <div className="thub-skeleton-body">
                <div className="thub-skeleton-top">
                  <div className="skeleton-block thub-skeleton-icon" />
                  <div className="skeleton-block thub-skeleton-badge" />
                </div>
                <div className="skeleton-block thub-skeleton-title" />
                <div className="skeleton-block thub-skeleton-desc" />
                <div className="thub-skeleton-stats">
                  <div className="skeleton-block thub-skeleton-stat" />
                  <div className="skeleton-block thub-skeleton-stat" />
                </div>
              </div>
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
          title="No team hubs yet"
          description="Your organization hasn't set up any team hubs. Contact an admin to get started."
        />
      </>
    );
  }

  // Sort: own team first, then alphabetical
  const sorted = [...hubs].sort((a, b) => {
    const aOwn = isOwnTeam(a);
    const bOwn = isOwnTeam(b);
    if (aOwn && !bOwn) return -1;
    if (!aOwn && bOwn) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <PageHeader
        title="Team Hub"
        description="Your department's knowledge base: guides, contacts, and resources."
      />

      <FeatureBanner
        moduleId="team_hub"
        description="Team Hub is in limited pilot. Content management features are coming soon."
      />

      <div className="thub-grid">
        {sorted.map((hub) => {
          const accessible = isOwnTeam(hub);
          const requested = requestedHubIds.has(hub.id);
          const requesting = requestingHubId === hub.id;
          const deptColor = getDeptColor(hub.department);
          const counts = getHubCounts(hub);

          if (accessible) {
            return (
              <Link
                key={hub.id}
                href={`/team-hub/${hub.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <article className="thub-card thub-card-accessible">
                  <div className="thub-card-accent" style={{ background: deptColor.gradient }} />
                  <div className="thub-card-body">
                    <div className="thub-card-top-row">
                      <span className="thub-card-icon-box" style={{ background: deptColor.light, color: deptColor.accent }}>
                        <NavIcon name={getDeptIcon(hub.department, hub.icon)} size={20} />
                      </span>
                      <span className="thub-card-your-team">
                        Your team
                      </span>
                    </div>

                    <h3 className="thub-card-name">{hub.name}</h3>

                    {hub.description ? (
                      <p className="thub-card-desc">{hub.description}</p>
                    ) : null}

                    <div className="thub-card-stats">
                      <span className="thub-card-stat">
                        <NavIcon name="Layers" size={13} />
                        {counts.sections} {counts.sections === 1 ? "section" : "sections"}
                      </span>
                      <span className="thub-card-stat">
                        <NavIcon name="FileText" size={13} />
                        {counts.pages} {counts.pages === 1 ? "page" : "pages"}
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            );
          }

          return (
            <article key={hub.id} className="thub-card thub-card-locked">
              <div className="thub-card-accent" style={{ background: "var(--border-default)" }} />
              <div className="thub-card-body">
                <div className="thub-card-top-row">
                  <span className="thub-card-icon-box thub-card-icon-locked">
                    <NavIcon name={getDeptIcon(hub.department, hub.icon)} size={20} />
                  </span>
                  <span className="thub-card-lock-badge">
                    <NavIcon name="Lock" size={12} />
                    Restricted
                  </span>
                </div>

                <h3 className="thub-card-name">{hub.name}</h3>

                {hub.description ? (
                  <p className="thub-card-desc">{hub.description}</p>
                ) : null}

                <div className="thub-locked-overlay">
                  <p className="thub-locked-text">
                    Only <strong>{hub.department}</strong> teammates can access this hub.
                  </p>
                  {requested ? (
                    <span className="thub-request-sent">
                      <NavIcon name="CheckCircle" size={13} />
                      Request sent
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="thub-request-btn"
                      onClick={() => handleRequestAccess(hub)}
                      disabled={requesting}
                    >
                      <NavIcon name="Send" size={12} />
                      {requesting ? "Sending…" : "Request access"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
