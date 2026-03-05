"use client";

import { Component, type ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

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
      <article className="home-card dashboard-widget dashboard-widget-error">
        <header className="dashboard-widget-header">
          <h3 className="section-title">{this.props.title}</h3>
        </header>
        <div className="dashboard-widget-error-body">
          <p className="settings-card-description">
            Unable to load this widget. Other widgets are still available.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      </article>
    );
  }
}
