import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Crew Hub"
};

export default function PrivacyPage() {
  return (
    <main className="standalone-page legal-page">
      <article className="standalone-card legal-card" style={{ maxWidth: 720, margin: "40px auto", padding: 32 }}>
        <nav style={{ marginBottom: 24 }}>
          <Link
            href="/support"
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
            Back to Help & Support
          </Link>
        </nav>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Privacy Policy</h1>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: 16 }}>
          <strong>Last updated:</strong> March 2026
        </p>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>1. Information We Collect</h2>
          <p>Crew Hub collects information necessary to manage your employment relationship, including:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Name, email, phone number, and profile information</li>
            <li>Employment details (role, department, start date, manager)</li>
            <li>Compensation and payroll data</li>
            <li>Time-off requests and attendance records</li>
            <li>Documents you upload (ID, tax forms, etc.)</li>
            <li>Performance review data</li>
            <li>Expense claims and receipts</li>
            <li>Login activity and session data</li>
          </ul>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Manage your employment and HR processes</li>
            <li>Process payroll and compensation</li>
            <li>Track time off, attendance, and scheduling</li>
            <li>Facilitate onboarding and offboarding</li>
            <li>Enable performance management</li>
            <li>Process expense claims</li>
            <li>Send notifications and announcements</li>
            <li>Maintain security and audit logs</li>
          </ul>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>3. Data Storage and Security</h2>
          <p>
            Your data is stored securely using industry-standard encryption. We use Supabase
            (hosted on AWS) for data storage with row-level security policies. Sensitive data
            such as payment details is encrypted at rest using AES-256-GCM.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>4. Data Retention</h2>
          <p>
            We retain your data for the duration of your employment plus the legally required
            retention period in your jurisdiction. Soft-deleted records are retained for audit
            purposes. You may request a review of your retained data at any time.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>5. Your Rights</h2>
          <p>You have the right to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Access</strong> your personal data held by Crew Hub</li>
            <li><strong>Correct</strong> inaccurate personal data</li>
            <li><strong>Request export</strong> of your personal data</li>
            <li><strong>Request deletion</strong> of your personal data (subject to legal retention requirements)</li>
          </ul>
          <p style={{ marginTop: 8 }}>
            To exercise these rights, contact your administrator or email{" "}
            <a href="mailto:privacy@useaccrue.com">privacy@useaccrue.com</a>.
          </p>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>6. Data Sharing</h2>
          <p>
            We do not sell your personal data. Data is shared only with:
          </p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Your employer (the organization using Crew Hub)</li>
            <li>Infrastructure providers (Supabase/AWS, Vercel, Resend) for service operation</li>
            <li>Error tracking (Sentry) for application reliability — no PII is included</li>
          </ul>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>7. Contact</h2>
          <p>
            For privacy questions or data requests, contact:{" "}
            <a href="mailto:privacy@useaccrue.com">privacy@useaccrue.com</a>
          </p>
        </section>
      </article>
    </main>
  );
}
