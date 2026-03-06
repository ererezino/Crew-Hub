"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { NotificationAction } from "../../types/notifications";

type ActionState = {
  status: "idle" | "loading" | "awaiting_reason" | "success" | "error";
  message?: string;
};

export function NotificationActionButton({
  action,
  onComplete
}: {
  action: NotificationAction;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [reason, setReason] = useState("");

  const variantClass =
    action.variant === "primary"
      ? "notification-action-primary"
      : action.variant === "destructive"
        ? "notification-action-destructive"
        : "notification-action-outline";

  const handleApiAction = useCallback(
    async (extraBody?: Record<string, unknown>) => {
      if (!action.api_endpoint || !action.api_method) {
        return;
      }

      setState({ status: "loading" });

      try {
        const body = { ...action.api_body, ...extraBody };
        const response = await fetch(action.api_endpoint, {
          method: action.api_method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          setState({ status: "success", message: `${action.label} done` });
          onComplete?.();
        } else {
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          const errorMessage = payload?.error?.message ?? "Action failed";
          setState({ status: "error", message: errorMessage });
        }
      } catch {
        setState({ status: "error", message: "Network error" });
      }
    },
    [action, onComplete]
  );

  const handleClick = useCallback(() => {
    if (action.action_type === "navigate" && action.navigate_url) {
      router.push(action.navigate_url);
      onComplete?.();
      return;
    }

    if (action.action_type === "api") {
      if (action.requires_reason && state.status !== "awaiting_reason") {
        setState({ status: "awaiting_reason" });
        return;
      }

      if (action.requires_reason && state.status === "awaiting_reason") {
        if (!reason.trim()) {
          return;
        }
        void handleApiAction({ rejectionReason: reason.trim() });
        return;
      }

      void handleApiAction();
    }
  }, [action, handleApiAction, onComplete, reason, router, state.status]);

  if (state.status === "success" || state.status === "error") {
    return (
      <span
        className={`notification-action-status ${
          state.status === "success"
            ? "notification-action-status-success"
            : "notification-action-status-error"
        }`}
      >
        {state.message}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`notification-action-btn ${variantClass}`}
        disabled={state.status === "loading"}
        onClick={handleClick}
        aria-label={action.label}
      >
        {state.status === "loading" ? (
          <span className="notification-action-spinner" aria-hidden="true" />
        ) : null}
        {state.status === "awaiting_reason" ? "Confirm" : action.label}
      </button>
      {state.status === "awaiting_reason" ? (
        <input
          type="text"
          className="notification-decline-reason"
          placeholder="Reason for declining..."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && reason.trim()) {
              void handleApiAction({ rejectionReason: reason.trim() });
            }
          }}
          autoFocus
        />
      ) : null}
    </>
  );
}
