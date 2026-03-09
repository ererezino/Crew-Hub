import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Crew Hub"
};

export default function TermsPage() {
  return (
    <main className="standalone-page legal-page">
      <article className="standalone-card legal-card" style={{ maxWidth: 720, margin: "40px auto", padding: 32 }}>
        <nav style={{ marginBottom: 24 }}>
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 14,
              color: "var(--color-accent)",
              textDecoration: "none"
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to Dashboard
          </Link>
        </nav>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Terms of Service</h1>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: 16 }}>
          <strong>Last updated:</strong> March 2026
        </p>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Crew Hub, you agree to be bound by these Terms of Service.
            If you do not agree to these terms, do not use the service.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>2. Service Description</h2>
          <p>
            Crew Hub is a workforce management platform that provides HR, payroll, time tracking,
            performance management, and related services. Some features may be in limited pilot,
            preview, or coming soon status — these are clearly labeled in the application.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>3. User Accounts</h2>
          <p>
            Accounts are created by your organization&apos;s administrator. You are responsible for
            maintaining the security of your account credentials. You must change your temporary
            password upon first login.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>4. Acceptable Use</h2>
          <p>You agree to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Provide accurate information</li>
            <li>Keep your login credentials secure</li>
            <li>Use the service only for its intended purpose</li>
            <li>Not attempt to access other users&apos; data without authorization</li>
            <li>Not upload malicious files or content</li>
            <li>Comply with your organization&apos;s policies</li>
          </ul>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>5. Data Ownership</h2>
          <p>
            Your organization retains ownership of all data entered into Crew Hub. The service
            operates as a data processor on behalf of your organization (the data controller).
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>6. Service Availability</h2>
          <p>
            We strive for high availability but do not guarantee uninterrupted access. Some features
            may be modified, added, or removed as the platform evolves. Features marked as
            &ldquo;Pilot&rdquo;, &ldquo;Preview&rdquo;, or &ldquo;Coming Soon&rdquo; are not guaranteed
            to reach general availability.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>7. Limitation of Liability</h2>
          <p>
            Crew Hub is provided &ldquo;as is&rdquo; without warranties of any kind. We are not
            liable for any indirect, incidental, or consequential damages arising from the use
            of the service.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>8. Contact</h2>
          <p>
            For questions about these terms, contact:{" "}
            <a href="mailto:legal@useaccrue.com">legal@useaccrue.com</a>
          </p>
        </section>
      </article>
    </main>
  );
}
