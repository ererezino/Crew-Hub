"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type DecisionCardProps = {
  id: string;
  type: "leave" | "expense" | "signature";
  title: string;
  subtitle: string;
  detail: string;
  date: string;
  onApprove: (id: string) => Promise<void>;
  onDecline: (id: string, reason?: string) => Promise<void>;
};

export function DecisionCard({
  id,
  type,
  title,
  subtitle,
  detail,
  date,
  onApprove,
  onDecline,
}: DecisionCardProps) {
  const t = useTranslations("dashboard.decisionCard");
  const [status, setStatus] = useState<
    "idle" | "approving" | "declining" | "done" | "error"
  >("idle");
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const handleApprove = async () => {
    setStatus("approving");
    try {
      await onApprove(id);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const handleDecline = async () => {
    setStatus("declining");
    try {
      await onDecline(id, declineReason || undefined);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return null;
  }

  const typeLabels: Record<string, string> = {
    leave: t("typeLeave"),
    expense: t("typeExpense"),
    signature: t("typeDocument"),
  };

  return (
    <div className="decision-card">
      <div className="decision-card-header">
        <span className={`decision-card-badge decision-card-badge-${type}`}>
          {typeLabels[type] || type}
        </span>
        <span className="decision-card-date">{date}</span>
      </div>

      <div className="decision-card-body">
        <p className="decision-card-title">{title}</p>
        <p className="decision-card-subtitle">{subtitle}</p>
        <p className="decision-card-detail">{detail}</p>
      </div>

      {status === "error" && (
        <div className="decision-card-error">
          <p className="decision-card-error-text">{t("errorMessage")}</p>
          <button
            type="button"
            className="button button-ghost decision-card-btn"
            onClick={() => setStatus("idle")}
          >
            {t("tryAgain")}
          </button>
        </div>
      )}

      {showDeclineInput ? (
        <div className="decision-card-decline-input">
          <textarea
            className="decision-card-textarea"
            placeholder={t("declineReasonPlaceholder")}
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            rows={2}
          />
          <div className="decision-card-actions">
            <button
              className="button button-ghost decision-card-btn"
              onClick={() => {
                setShowDeclineInput(false);
                setDeclineReason("");
              }}
              disabled={status === "declining"}
            >
              {t("cancel")}
            </button>
            <button
              className="button button-danger decision-card-btn"
              onClick={handleDecline}
              disabled={status === "declining"}
            >
              {status === "declining" ? t("declining") : t("confirmDecline")}
            </button>
          </div>
        </div>
      ) : (
        <div className="decision-card-actions">
          <button
            className="button button-danger decision-card-btn"
            onClick={() => setShowDeclineInput(true)}
            disabled={status === "approving" || status === "error"}
          >
            {t("decline")}
          </button>
          <button
            className="button button-primary decision-card-btn"
            onClick={handleApprove}
            disabled={status === "approving" || status === "error"}
          >
            {status === "approving" ? t("approving") : t("approve")}
          </button>
        </div>
      )}
    </div>
  );
}
