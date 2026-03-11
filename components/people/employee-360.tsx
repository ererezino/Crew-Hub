"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations('peopleOverview');
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
    return <div className="employee-360-loading">{t('e360.loadingOverview')}</div>;
  }

  if (!data) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return `$${(amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="employee-360">
      <h3 className="employee-360-title">{t('e360.title')}</h3>
      <div className="employee-360-grid">
        {/* Leave Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">{t('e360.leaveBalance')}</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.leave.days_remaining}</span>
              <span className="e360-stat-label">{t('e360.daysRemaining')}</span>
            </div>
            <div className="e360-card-meta">
              <span>{t('e360.daysUsed', { count: data.leave.days_used })}</span>
              {data.leave.pending_requests > 0 && (
                <span className="e360-badge-warning">{t('e360.pendingRequests', { count: data.leave.pending_requests })}</span>
              )}
            </div>
          </div>
        </div>

        {/* Performance Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">{t('e360.performance')}</span>
            {data.performance.status && (
              <span className="e360-badge-info">{data.performance.status}</span>
            )}
          </div>
          <div className="e360-card-body">
            {data.performance.latest_cycle ? (
              <>
                <div className="e360-ratings">
                  <div className="e360-rating">
                    <span className="e360-rating-label">{t('e360.selfRating')}</span>
                    <span className="e360-rating-value">
                      {data.performance.self_rating ?? "-"}
                    </span>
                  </div>
                  <div className="e360-rating">
                    <span className="e360-rating-label">{t('e360.managerRating')}</span>
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
              <p className="e360-empty">{t('e360.noPerformanceCycle')}</p>
            )}
          </div>
        </div>

        {/* Onboarding Card (conditional) */}
        {data.onboarding && (
          <div className="e360-card">
            <div className="e360-card-header">
              <span className="e360-card-label">{t('e360.onboarding')}</span>
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
                <span>{t('e360.percentComplete', { percent: data.onboarding.progress_percent })}</span>
                {data.onboarding.days_since_start !== null && (
                  <span>{t('e360.dayNumber', { day: data.onboarding.days_since_start })}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expenses Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">{t('e360.expenses')}</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.expenses.total_submitted}</span>
              <span className="e360-stat-label">{t('e360.submitted')}</span>
            </div>
            <div className="e360-card-meta">
              {data.expenses.pending_amount > 0 && (
                <span className="e360-badge-warning">{t('e360.amountPending', { amount: formatCurrency(data.expenses.pending_amount) })}</span>
              )}
              {data.expenses.approved_amount > 0 && (
                <span>{t('e360.amountApproved', { amount: formatCurrency(data.expenses.approved_amount) })}</span>
              )}
            </div>
          </div>
        </div>

        {/* Documents Card */}
        <div className="e360-card">
          <div className="e360-card-header">
            <span className="e360-card-label">{t('e360.documents')}</span>
          </div>
          <div className="e360-card-body">
            <div className="e360-stat">
              <span className="e360-stat-value">{data.documents.total}</span>
              <span className="e360-stat-label">{t('e360.total')}</span>
            </div>
            <div className="e360-card-meta">
              {data.documents.pending_signature > 0 && (
                <span className="e360-badge-warning">{t('e360.awaitingSignature', { count: data.documents.pending_signature })}</span>
              )}
              {data.documents.expiring_soon > 0 && (
                <span className="e360-badge-warning">{t('e360.expiringSoon', { count: data.documents.expiring_soon })}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
