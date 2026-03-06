"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

type ShellErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ShellError({ error, reset }: ShellErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="app-error-boundary">
      <div className="app-error-boundary-content">
        <div className="app-error-boundary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="app-error-boundary-title">Something went wrong</h2>
        <p className="app-error-boundary-message">
          An unexpected error occurred. You can try again or return to the dashboard.
        </p>
        {process.env.NODE_ENV !== "production" ? (
          <pre className="app-error-boundary-stack">
            {error.message}
            {"\n"}
            {error.stack}
          </pre>
        ) : null}
        <div className="app-error-boundary-actions">
          <button type="button" className="button" onClick={reset}>
            Try again
          </button>
          <Link href="/dashboard" className="button button-accent">
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
