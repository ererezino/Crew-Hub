"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { DashboardChart } from "../../../components/dashboard/dashboard-chart";
import { DashboardSkeleton } from "../../../components/dashboard/dashboard-skeleton";
import { HeroMetricCard } from "../../../components/dashboard/hero-metric-card";
import { OnboardingBanner } from "../../../components/dashboard/onboarding-banner";
import { DashboardAnnouncementsWidget } from "../../../components/shared/dashboard-announcements-widget";
import { EmptyState } from "../../../components/shared/empty-state";
import { useDashboard } from "../../../hooks/use-dashboard";
import type { TeamMemberSpotlight } from "../../../types/dashboard";
import type { OnboardingInstancesResponse } from "../../../types/onboarding";

/* ── Animation variants ── */

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 18 }
  }
};

const stagger = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 }
  }
};

const cardHover = {
  scale: 1.02,
  transition: { type: "spring" as const, stiffness: 400, damping: 25 }
};

/* ── Greeting helpers ── */

function getGreetingEmoji(timeOfDay: "morning" | "afternoon" | "evening"): string {
  if (timeOfDay === "morning") return "\u{1F305}";
  if (timeOfDay === "afternoon") return "\u{2600}\u{FE0F}";
  return "\u{1F307}";
}

function getGreetingText(timeOfDay: "morning" | "afternoon" | "evening"): string {
  if (timeOfDay === "morning") return "Good morning";
  if (timeOfDay === "afternoon") return "Good afternoon";
  return "Good evening";
}

/* ── Quick Action Card ── */

function QuickActionCard({
  href,
  icon,
  label,
  description,
  index
}: {
  href: string;
  icon: string;
  label: string;
  description: string;
  index: number;
}) {
  return (
    <motion.div variants={fadeIn} whileHover={cardHover}>
      <Link href={href} className="home-quick-action-card">
        <span className="home-quick-action-icon">{icon}</span>
        <span className="home-quick-action-label">{label}</span>
        <span className="home-quick-action-desc">{description}</span>
      </Link>
    </motion.div>
  );
}

/* ── Team Member Avatar ── */

function TeamAvatar({ member }: { member: TeamMemberSpotlight }) {
  return (
    <Link href={`/people/${member.id}`} className="home-team-avatar" title={member.fullName}>
      {member.avatarUrl ? (
        <img
          src={member.avatarUrl}
          alt={member.fullName}
          className="home-team-avatar-img"
          loading="lazy"
        />
      ) : (
        <span className="home-team-avatar-initials">{member.initials}</span>
      )}
      <span className="home-team-avatar-name">{member.fullName.split(" ")[0]}</span>
      {member.title ? (
        <span className="home-team-avatar-title">{member.title}</span>
      ) : null}
    </Link>
  );
}

/* ── Policy Link ── */

function PolicyLink({
  href,
  icon,
  title,
  description
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="home-resource-link">
      <span className="home-resource-icon">{icon}</span>
      <span className="home-resource-text">
        <span className="home-resource-title">{title}</span>
        <span className="home-resource-desc">{description}</span>
      </span>
      <svg className="home-resource-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

/* ── Onboarding fetch ── */

async function fetchMyOnboardingSummary() {
  const response = await fetch(
    "/api/v1/onboarding/instances?scope=me&status=active&type=onboarding",
    { method: "GET" }
  );

  const payload = (await response.json()) as OnboardingInstancesResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load onboarding summary.");
  }

  return payload.data.instances[0] ?? null;
}

/* ── Main Dashboard Content ── */

function DashboardContent({ profileStatus }: { profileStatus: string }) {
  const dashboardQuery = useDashboard();
  const onboardingSummaryQuery = useQuery({
    queryKey: ["dashboard-onboarding-summary"],
    queryFn: fetchMyOnboardingSummary,
    enabled: profileStatus === "onboarding",
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1
  });

  if (dashboardQuery.isPending) {
    return <DashboardSkeleton />;
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Unable to load dashboard data."
        }
        ctaLabel="Retry"
        ctaHref="/dashboard"
      />
    );
  }

  const data = dashboardQuery.data;

  return (
    <div className="home-page">
      {/* ═══════════════════════════════════════════════
          SECTION 1: Welcome Hero
          ═══════════════════════════════════════════════ */}
      <motion.section
        className="home-welcome-hero"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        <div className="home-welcome-content">
          <p className="home-welcome-eyebrow">
            {getGreetingEmoji(data.greeting.timeOfDay)} {getGreetingText(data.greeting.timeOfDay)}
          </p>
          <h1 className="home-welcome-title">
            Hello, {data.greeting.firstName}!
          </h1>
          <p className="home-welcome-subtitle">
            {data.companyDescription}
          </p>
          <span className="home-welcome-role-pill">{data.greeting.roleBadge}</span>
        </div>
      </motion.section>

      {/* Onboarding banner for new employees */}
      {profileStatus === "onboarding" && onboardingSummaryQuery.data ? (
        <OnboardingBanner
          progressPercent={onboardingSummaryQuery.data.progressPercent}
          totalTasks={onboardingSummaryQuery.data.totalTasks}
          completedTasks={onboardingSummaryQuery.data.completedTasks}
        />
      ) : null}

      {/* ═══════════════════════════════════════════════
          SECTION 2: Quick Actions
          ═══════════════════════════════════════════════ */}
      <motion.section
        className="home-quick-actions"
        variants={stagger}
        initial="initial"
        animate="animate"
        aria-label="Quick actions"
      >
        <QuickActionCard
          href="/time-off"
          icon={"\u{1F3D6}\u{FE0F}"}
          label="Request Time Off"
          description="Submit leave requests"
          index={0}
        />
        <QuickActionCard
          href="/expenses"
          icon={"\u{1F4B3}"}
          label="Submit Expense"
          description="File expense reports"
          index={1}
        />
        <QuickActionCard
          href="/me/pay"
          icon={"\u{1F4B0}"}
          label="View Payslips"
          description="Check your payments"
          index={2}
        />
        <QuickActionCard
          href="/documents"
          icon={"\u{1F4C4}"}
          label="My Documents"
          description="Access your files"
          index={3}
        />
        <QuickActionCard
          href="/learning"
          icon={"\u{1F4DA}"}
          label="Learning"
          description="Courses & certificates"
          index={4}
        />
        <QuickActionCard
          href="/performance"
          icon={"\u{2B50}"}
          label="Reviews"
          description="Performance feedback"
          index={5}
        />
      </motion.section>

      {/* ═══════════════════════════════════════════════
          SECTION 3: Two-column — Updates + About/Policies
          ═══════════════════════════════════════════════ */}
      <div className="home-two-column">
        {/* Left Column: Company Updates */}
        <motion.div
          className="home-column-left"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 100, damping: 18 }}
        >
          <div className="home-card">
            <DashboardAnnouncementsWidget />
          </div>

          {/* Inspirational Quote */}
          <motion.div
            className="home-quote-card"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, type: "spring", stiffness: 100, damping: 18 }}
          >
            <div className="home-quote-pin" aria-hidden="true" />
            <blockquote className="home-quote-text">
              The best work environments are built on trust, respect, and shared purpose.
            </blockquote>
          </motion.div>
        </motion.div>

        {/* Right Column: About + Policies + Links */}
        <motion.div
          className="home-column-right"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 100, damping: 18 }}
        >
          {/* About Section */}
          <div className="home-card">
            <h3 className="home-section-header">
              <span className="home-section-icon">{"\u{1F9ED}"}</span>
              About Accrue
            </h3>
            <div className="home-resource-list">
              <PolicyLink
                href="/me/onboarding"
                icon={"\u{1F389}"}
                title="Welcome to Accrue"
                description="Onboarding guide & getting started"
              />
              <PolicyLink
                href="/people"
                icon={"\u{1F465}"}
                title="Meet the Team"
                description={`${data.totalTeamCount} team members across all departments`}
              />
            </div>
          </div>

          {/* Policies Section */}
          <div className="home-card">
            <h3 className="home-section-header">
              <span className="home-section-icon">{"\u{1F517}"}</span>
              Policies
            </h3>
            <div className="home-resource-list">
              <PolicyLink
                href="/documents"
                icon={"\u{1F4CB}"}
                title="Employee Guidelines"
                description="Standards, conduct & expectations"
              />
              <PolicyLink
                href="/time-off"
                icon={"\u{1F3D6}\u{FE0F}"}
                title="Time Off Policy"
                description="Leave, sick days & personal time"
              />
              <PolicyLink
                href="/documents"
                icon={"\u{1F4AC}"}
                title="Communication Expectation"
                description="How we communicate & collaborate"
              />
            </div>
          </div>

          {/* Useful Links */}
          <div className="home-card">
            <h3 className="home-section-header">
              <span className="home-section-icon">{"\u{1F30D}"}</span>
              Quick Links
            </h3>
            <div className="home-resource-list">
              <PolicyLink
                href="/scheduling"
                icon={"\u{1F4C5}"}
                title="Schedule"
                description="View shifts & team schedule"
              />
              <PolicyLink
                href="/time-attendance"
                icon={"\u{23F0}"}
                title="Hours & Attendance"
                description="Clock in, track hours"
              />
              <PolicyLink
                href="/notifications"
                icon={"\u{1F514}"}
                title="Notifications"
                description="All alerts & updates"
              />
              {data.isAdmin ? (
                <PolicyLink
                  href="/settings"
                  icon={"\u{2699}\u{FE0F}"}
                  title="Settings"
                  description="Organization preferences"
                />
              ) : null}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════
          SECTION 4: Team Spotlight
          ═══════════════════════════════════════════════ */}
      {data.teamSpotlight.length > 0 ? (
        <motion.section
          className="home-card home-team-section"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 100, damping: 18 }}
        >
          <div className="home-team-header">
            <h3 className="home-section-header">
              <span className="home-section-icon">{"\u{1F465}"}</span>
              Meet the Team
            </h3>
            <Link href="/people" className="home-view-all-link">
              View all {data.totalTeamCount} members
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
          <div className="home-team-grid">
            {data.teamSpotlight.map((member) => (
              <TeamAvatar key={member.id} member={member} />
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* ═══════════════════════════════════════════════
          SECTION 5: New Hires Welcome
          ═══════════════════════════════════════════════ */}
      {data.newHires.length > 0 ? (
        <motion.section
          className="home-card home-new-hires-section"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, type: "spring", stiffness: 100, damping: 18 }}
        >
          <h3 className="home-section-header">
            <span className="home-section-icon">{"\u{1F44B}"}</span>
            New Team Members
          </h3>
          <div className="home-new-hires-grid">
            {data.newHires.map((member) => (
              <Link
                key={member.id}
                href={`/people/${member.id}`}
                className="home-new-hire-card"
              >
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt={member.fullName}
                    className="home-new-hire-avatar"
                    loading="lazy"
                  />
                ) : (
                  <span className="home-new-hire-avatar-initials">{member.initials}</span>
                )}
                <span className="home-new-hire-name">{member.fullName}</span>
                {member.title ? (
                  <span className="home-new-hire-title">{member.title}</span>
                ) : null}
                {member.department ? (
                  <span className="home-new-hire-dept">{member.department}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* ═══════════════════════════════════════════════
          SECTION 6: Admin Insights (KPIs, Charts — admin only or compact for all)
          ═══════════════════════════════════════════════ */}
      {data.heroMetrics.length > 0 ? (
        <motion.section
          className="home-admin-insights"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, type: "spring", stiffness: 100, damping: 18 }}
          aria-label="Metrics & Insights"
        >
          <h3 className="home-section-header home-section-header-large">
            <span className="home-section-icon">{"\u{1F4CA}"}</span>
            {data.isAdmin ? "Organization Insights" : "Your Snapshot"}
          </h3>
          <div className="dashboard-v2-hero-grid">
            {data.heroMetrics.map((metric, index) => (
              <HeroMetricCard key={metric.key} metric={metric} index={index} />
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* Primary Chart */}
      {data.primaryChart.data.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, type: "spring", stiffness: 100, damping: 18 }}
        >
          <DashboardChart chart={data.primaryChart} />
        </motion.div>
      )}

      {/* Secondary Panels */}
      {data.secondaryPanels.length > 0 && data.isAdmin && (
        <motion.section
          className="dashboard-v2-two-column"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          aria-label="Data breakdowns"
        >
          {data.secondaryPanels.map((panel) => (
            <motion.div
              key={panel.title}
              className="dashboard-v2-panel"
              variants={fadeIn}
            >
              <h3 className="section-title">{panel.title}</h3>
              {panel.rows.length > 0 ? (
                <ul className="dashboard-v2-breakdown-list">
                  {panel.rows.map((row) => (
                    <li key={row.label} className="dashboard-v2-breakdown-row">
                      <span className="dashboard-v2-breakdown-label">{row.label}</span>
                      <span className="dashboard-v2-breakdown-bar-track">
                        <motion.span
                          className="dashboard-v2-breakdown-bar-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${row.percentage}%` }}
                          transition={{
                            type: "spring",
                            stiffness: 60,
                            damping: 20,
                            delay: 0.6
                          }}
                        />
                      </span>
                      <span className="dashboard-v2-breakdown-value numeric">
                        {row.value.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-subtitle">No data yet.</p>
              )}
            </motion.div>
          ))}
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════
          SECTION 7: Footer — Social / Contact
          ═══════════════════════════════════════════════ */}
      <motion.footer
        className="home-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <p className="home-footer-text">
          Need help? Reach out to your manager or contact Operations.
        </p>
        <p className="home-footer-tagline">
          Built with {"\u{2764}\u{FE0F}"} by Accrue
        </p>
      </motion.footer>
    </div>
  );
}

/* ── Root export ── */

export function DashboardClient({ profileStatus }: { profileStatus: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent profileStatus={profileStatus} />
    </QueryClientProvider>
  );
}
