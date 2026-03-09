"use client";

import { useState } from "react";

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
    leave: "Leave Request",
    expense: "Expense Claim",
    signature: "Document",
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
          <p className="decision-card-error-text">Something went wrong. Please try again.</p>
          <button
            type="button"
            className="button button-ghost decision-card-btn"
            onClick={() => setStatus("idle")}
          >
            Try again
          </button>
        </div>
      )}

      {showDeclineInput ? (
        <div className="decision-card-decline-input">
          <textarea
            className="decision-card-textarea"
            placeholder="Reason for declining (optional)"
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
              Cancel
            </button>
            <button
              className="button button-danger decision-card-btn"
              onClick={handleDecline}
              disabled={status === "declining"}
            >
              {status === "declining" ? "Declining..." : "Confirm Decline"}
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
            Decline
          </button>
          <button
            className="button button-primary decision-card-btn"
            onClick={handleApprove}
            disabled={status === "approving" || status === "error"}
          >
            {status === "approving" ? "Approving..." : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
