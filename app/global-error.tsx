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
            fontFamily: "Inter, system-ui, sans-serif",
            gap: "1rem",
            padding: "2rem"
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#666", maxWidth: "30rem", textAlign: "center" }}>
            An unexpected error occurred. Please try again or return to the dashboard.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                background: "#fff",
                cursor: "pointer",
                fontSize: "0.875rem"
              }}
            >
              Try again
            </button>
            <Link
              href="/dashboard"
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                background: "#111",
                color: "#fff",
                textDecoration: "none",
                fontSize: "0.875rem"
              }}
            >
              Return to dashboard
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
