"use client";

import { useEffect, useState, useCallback } from "react";

type Employee360Data = {
  leave: {
    days_used: number;
    days_remaining: number;
    pending_requests: number;
  };
  performance: {
    latest_cycle: string | null;
    self_rating: number | null;
    manager_rating: number | null;
    status: string | null;
  };
  onboarding: {
    status: string | null;
    progress_percent: number;
    days_since_start: number | null;
  } | null;
  expenses: {
    pending_amount: number;
    approved_amount: number;
    total_submitted: number;
  };
  documents: {
    total: number;
    pending_signature: number;
    expiring_soon: number;
  };
};

type Employee360Props = {
  employeeId: string;
};

export function Employee360({ employeeId }: Employee360Props) {
  const [data, setData] = useState<Employee360Data | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/people/${employeeId}/overview`);
      if (res.ok) {
        const json = (await res.json()) as { data: Employee360Data | null };
        setData(json.data);
      }
    } catch {
      // Silently fail - overview is supplementary
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return <div className="employee-360-loading">Loading overview...</div>;
  }

  if (!data) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return `$${(amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="employee-360">
      <h3 className="employee-360-title">360 Overview</h3>
      <div className="employee-360-grid">
        {/* Leave Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">Leave Balance</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.leave.days_remaining}</span>
              <span className="e360-stat-label">days remaining</span>
            </div>
            <div className="e360-card-meta">
              <span>{data.leave.days_used} days used</span>
              {data.leave.pending_requests > 0 && (
                <span className="e360-badge-warning">{data.leave.pending_requests} pending</span>
              )}
            </div>
          </div>
        </div>

        {/* Performance Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">Performance</span>
            {data.performance.status && (
              <span className="e360-badge-info">{data.performance.status}</span>
            )}
          </div>
          <div className="e360-card-body">
            {data.performance.latest_cycle ? (
              <>
                <div className="e360-ratings">
                  <div className="e360-rating">
                    <span className="e360-rating-label">Self</span>
                    <span className="e360-rating-value">
                      {data.performance.self_rating ?? "-"}
                    </span>
                  </div>
                  <div className="e360-rating">
                    <span className="e360-rating-label">Manager</span>
                    <span className="e360-rating-value">
                      {data.performance.manager_rating ?? "-"}
                    </span>
                  </div>
                </div>
                <div className="e360-card-meta">
                  <span>{data.performance.latest_cycle}</span>
                </div>
              </>
            ) : (
              <p className="e360-empty">No performance cycle</p>
            )}
          </div>
        </div>

        {/* Onboarding Card (conditional) */}
        {data.onboarding && (
          <div className="e360-card">
            <div className="e360-card-header">
              <span className="e360-card-label">Onboarding</span>
              <span className={`e360-badge-${data.onboarding.status === "completed" ? "success" : "info"}`}>
                {data.onboarding.status}
              </span>
            </div>
            <div className="e360-card-body">
              <div className="e360-progress-bar">
                <div
                  className="e360-progress-fill"
                  style={{ width: `${data.onboarding.progress_percent}%` }}
                />
              </div>
              <div className="e360-card-meta">
                <span>{data.onboarding.progress_percent}% complete</span>
                {data.onboarding.days_since_start !== null && (
                  <span>Day {data.onboarding.days_since_start}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expenses Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">Expenses</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.expenses.total_submitted}</span>
              <span className="e360-stat-label">submitted</span>
            </div>
            <div className="e360-card-meta">
              {data.expenses.pending_amount > 0 && (
                <span className="e360-badge-warning">{formatCurrency(data.expenses.pending_amount)} pending</span>
              )}
              {data.expenses.approved_amount > 0 && (
                <span>{formatCurrency(data.expenses.approved_amount)} approved</span>
              )}
            </div>
          </div>
        </div>

        {/* Documents Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">Documents</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.documents.total}</span>
              <span className="e360-stat-label">total</span>
            </div>
            <div className="e360-card-meta">
              {data.documents.pending_signature > 0 && (
                <span className="e360-badge-warning">{data.documents.pending_signature} awaiting signature</span>
              )}
              {data.documents.expiring_soon > 0 && (
                <span className="e360-badge-warning">{data.documents.expiring_soon} expiring soon</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
