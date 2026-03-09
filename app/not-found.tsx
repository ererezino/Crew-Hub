import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Page not found">
        <header className="auth-card-header">
          <h1 className="page-title">Page not found</h1>
          <p className="page-description">
            This page does not exist or has moved. Use navigation to continue.
          </p>
        </header>
        <div className="settings-actions">
          <Link href="/dashboard" className="button button-accent">
            Go to dashboard
          </Link>
          <Link href="/login" className="button">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
