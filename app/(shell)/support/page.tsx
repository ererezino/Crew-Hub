import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "../../../components/shared/page-header";

export const metadata: Metadata = {
  title: "Help & Support — Crew Hub"
};

/* ── Inline Lucide-style SVG icons (server-component safe) ── */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

const icons = {
  alertCircle: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  helpCircle: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  lock: (
    <svg {...iconProps}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  shieldCheck: (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

export default async function SupportPage() {
  const t = await getTranslations('support');

  const cards: { icon: ReactNode; title: string; body: ReactNode }[] = [
    {
      icon: icons.alertCircle,
      title: t("reportBug"),
      body: t('reportBugBody')
    },
    {
      icon: icons.helpCircle,
      title: t("featureQuestions"),
      body: t('featureQuestionsBody')
    },
    {
      icon: icons.lock,
      title: t("accountAccess"),
      body: (
        <>
          {t('accountAccessBody')} {`Basecamp is monitored for urgent internal access issues.`}
        </>
      )
    },
    {
      icon: icons.shieldCheck,
      title: t("dataPrivacy"),
      body: (
        <>
          {t('dataPrivacyBody')}{" "}
          <Link
            href="/privacy"
            style={{ color: "var(--color-accent)", textDecoration: "underline" }}
          >
            {t('privacyPolicy')}
          </Link>
          . {"If you need a data export, request it from Settings > Data export."}
        </>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
          gap: "var(--space-5)"
        }}
      >
        {cards.map((card) => (
          <article
            key={card.title}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-default)",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)"
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "var(--radius-default)",
                background: "var(--bg-page)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
                flexShrink: 0
              }}
            >
              {card.icon}
            </div>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--text-primary)",
                margin: 0
              }}
            >
              {card.title}
            </h2>
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--text-secondary)",
                margin: 0
              }}
            >
              {card.body}
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
