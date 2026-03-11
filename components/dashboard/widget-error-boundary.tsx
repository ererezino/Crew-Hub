"use client";

import { Component, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type Props = {
  title: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

function WidgetErrorFallback({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  const t = useTranslations("dashboard.widgetError");

  return (
    <article className="home-card dashboard-widget dashboard-widget-error">
      <header className="dashboard-widget-header">
        <h3 className="section-title">{title}</h3>
      </header>
      <div className="dashboard-widget-error-body">
        <p className="settings-card-description">
          {t("message")}
        </p>
        <button
          type="button"
          className="button"
          onClick={onRetry}
        >
          {t("tryAgain")}
        </button>
      </div>
    </article>
  );
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <WidgetErrorFallback
        title={this.props.title}
        onRetry={() => this.setState({ hasError: false })}
      />
    );
  }
}
