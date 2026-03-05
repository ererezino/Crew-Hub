"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "var(--font-body, Inter, system-ui, sans-serif)",
            gap: "1rem",
            padding: "2rem"
          }}
        >
          <h1 className="section-title">Something went wrong</h1>
          <p style={{ color: "var(--text-secondary)", maxWidth: "30rem", textAlign: "center" }}>
            An unexpected error occurred. Please try again or return to the dashboard.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              className="button"
            >
              Try again
            </button>
            <Link
              href="/dashboard"
              className="button button-accent"
            >
              Return to dashboard
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
