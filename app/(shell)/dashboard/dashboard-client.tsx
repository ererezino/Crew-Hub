"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { DashboardChart } from "../../../components/dashboard/dashboard-chart";
import { DashboardSkeleton } from "../../../components/dashboard/dashboard-skeleton";
import { HeroMetricCard } from "../../../components/dashboard/hero-metric-card";
import { DashboardAnnouncementsWidget } from "../../../components/shared/dashboard-announcements-widget";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { useDashboard } from "../../../hooks/use-dashboard";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";

const panelStagger = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.5
    }
  }
};

const panelItem = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 18 }
  }
};

function DashboardContent() {
  const dashboardQuery = useDashboard();

  if (dashboardQuery.isPending) {
    return (
      <>
        <PageHeader title="Dashboard" description="Loading your dashboard..." />
        <DashboardSkeleton />
      </>
    );
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <>
        <PageHeader title="Dashboard" description="Crew Hub operations dashboard" />
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
        <div style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="button button-accent"
            onClick={() => dashboardQuery.refetch()}
          >
            Retry now
          </button>
        </div>
      </>
    );
  }

  const data = dashboardQuery.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${data.greeting.firstName}`}
      />

      <motion.p
        className="dashboard-v2-role-badge"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        Signed in as {data.greeting.roleBadge}
      </motion.p>

      {/* Hero KPIs */}
      {data.heroMetrics.length > 0 ? (
        <section className="dashboard-v2-hero-grid" aria-label="Key metrics">
          {data.heroMetrics.map((metric, index) => (
            <HeroMetricCard key={metric.key} metric={metric} index={index} />
          ))}
        </section>
      ) : null}

      {/* Primary Chart */}
      {data.primaryChart.data.length > 0 && (
        <DashboardChart chart={data.primaryChart} />
      )}

      {/* Secondary Panels: Announcements + Quick Links */}
      <motion.section
        className="dashboard-v2-two-column"
        variants={panelStagger}
        initial="initial"
        animate="animate"
        aria-label="Dashboard widgets"
      >
        <motion.div className="dashboard-v2-panel" variants={panelItem}>
          <DashboardAnnouncementsWidget />
        </motion.div>

        <motion.div className="dashboard-v2-panel" variants={panelItem}>
          <h3 className="section-title">Quick Links</h3>
          <ul className="quick-links-list">
            <li>
              <Link className="quick-link" href="/time-off">
                Request Time Off
              </Link>
            </li>
            <li>
              <Link className="quick-link" href="/me/payslips">
                View Payments
              </Link>
            </li>
            <li>
              <Link className="quick-link" href="/me/documents">
                My Documents
              </Link>
            </li>
          </ul>

          {data.expenseWidget.pendingCount > 0 && (
            <div className="dashboard-v2-expense-widget">
              <h4 className="section-title">Pending Expenses</h4>
              <p className="dashboard-subtitle">
                <span className="numeric">{data.expenseWidget.pendingCount}</span>{" "}
                submissions awaiting approval
              </p>
              <p>
                <CurrencyDisplay
                  amount={data.expenseWidget.pendingAmount}
                  currency="USD"
                />
              </p>
              <Link className="quick-link" href="/expenses">
                Open Expenses
              </Link>
            </div>
          )}
        </motion.div>
      </motion.section>

      {/* Secondary breakdown panels */}
      {data.secondaryPanels.length > 0 && (
        <motion.section
          className="dashboard-v2-two-column"
          variants={panelStagger}
          initial="initial"
          animate="animate"
          aria-label="Data breakdowns"
        >
          {data.secondaryPanels.map((panel) => (
            <motion.div
              key={panel.title}
              className="dashboard-v2-panel"
              variants={panelItem}
            >
              <h3 className="section-title">{panel.title}</h3>
              {panel.rows.length > 0 ? (
                <ul className="dashboard-v2-breakdown-list">
                  {panel.rows.map((row) => (
                    <li key={row.label} className="dashboard-v2-breakdown-row">
                      <span className="dashboard-v2-breakdown-label">
                        {row.label}
                      </span>
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

      {/* Compliance Widget */}
      {data.complianceWidget && (
        <motion.section
          className="dashboard-v2-panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 120,
            damping: 18,
            delay: 0.7
          }}
          aria-label="Compliance widget"
        >
          <h3 className="section-title">Compliance</h3>
          <p className="dashboard-subtitle">
            <span className="numeric">{data.complianceWidget.overdueCount}</span>{" "}
            overdue deadlines
          </p>
          {data.complianceWidget.nextDeadline ? (
            <p className="dashboard-subtitle">
              Next: {countryFlagFromCode(data.complianceWidget.nextDeadline.countryCode)}{" "}
              {countryNameFromCode(data.complianceWidget.nextDeadline.countryCode)} •{" "}
              {data.complianceWidget.nextDeadline.requirement}{" "}
              <span
                className="numeric"
                title={formatDateTimeTooltip(data.complianceWidget.nextDeadline.dueDate)}
              >
                ({formatRelativeTime(data.complianceWidget.nextDeadline.dueDate)})
              </span>
            </p>
          ) : (
            <p className="dashboard-subtitle">No upcoming compliance deadlines.</p>
          )}
          <Link className="quick-link" href="/compliance">
            Open Compliance
          </Link>
        </motion.section>
      )}
    </>
  );
}

export function DashboardClient() {
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
      <DashboardContent />
    </QueryClientProvider>
  );
}
