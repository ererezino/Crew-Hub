"use client";

import {
  AlertTriangle,
  ChevronRight,
  FileWarning,
  Receipt,
  ShieldAlert,
  UserX
} from "lucide-react";
import Link from "next/link";

import type { HealthAlert } from "../../lib/dashboard/health-alerts";

/* ── Icon map ── */

const ICON_MAP: Record<string, React.ReactNode> = {
  AlertTriangle: <AlertTriangle size={16} />,
  UserX: <UserX size={16} />,
  ShieldAlert: <ShieldAlert size={16} />,
  Receipt: <Receipt size={16} />,
  FileWarning: <FileWarning size={16} />
};

/* ── Props ── */

type HealthAlertsProps = {
  alerts: HealthAlert[];
};

/* ── Component ── */

export function HealthAlerts({ alerts }: HealthAlertsProps) {
  if (alerts.length === 0) return null;

  return (
    <section className="health-alerts-section" aria-label="Health alerts">
      <header className="health-alerts-header">
        <h2 className="home-section-header">
          Needs Attention
          <span className="health-alerts-count-badge numeric">{alerts.length}</span>
        </h2>
      </header>
      <div className="health-alerts-list">
        {alerts.map((alert) => (
          <Link
            key={alert.key}
            href={alert.href}
            className={`health-alert-card health-alert-card-${alert.severity}`}
          >
            <span className="health-alert-icon">
              {ICON_MAP[alert.icon] ?? <AlertTriangle size={16} />}
            </span>
            <span className="health-alert-label">{alert.label}</span>
            <span className="health-alert-badge numeric">{alert.count}</span>
            <ChevronRight size={14} className="health-alert-arrow" />
          </Link>
        ))}
      </div>
    </section>
  );
}
