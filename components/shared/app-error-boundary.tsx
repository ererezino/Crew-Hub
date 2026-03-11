"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { Component, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

function AppErrorFallback({ error }: { error: Error | null }) {
  const t = useTranslations("common.appError");
  const isDev = process.env.NODE_ENV !== "production";

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
        <h2 className="app-error-boundary-title">{t("title")}</h2>
        <p className="app-error-boundary-message">
          {t("message")}
        </p>
        {isDev && error ? (
          <pre className="app-error-boundary-stack">
            {error.message}
            {"\n"}
            {error.stack}
          </pre>
        ) : null}
        <div className="app-error-boundary-actions">
          <button
            type="button"
            className="button"
            onClick={() => window.location.reload()}
          >
            {t("reload")}
          </button>
          <Link href="/dashboard" className="button button-accent">
            {t("returnToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    Sentry.captureException(error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return <AppErrorFallback error={this.state.error} />;
  }
}
