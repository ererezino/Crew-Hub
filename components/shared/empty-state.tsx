import type { ReactNode } from "react";
import Link from "next/link";

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
};

export function EmptyState({
  title,
  description,
  icon,
  ctaLabel,
  ctaHref,
  onCtaClick
}: EmptyStateProps) {
  return (
    <section className="empty-state" aria-live="polite">
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
      {ctaLabel && onCtaClick ? (
        <button type="button" className="button button-accent" onClick={onCtaClick}>
          {ctaLabel}
        </button>
      ) : ctaLabel && ctaHref ? (
        <Link className="button button-accent" href={ctaHref}>
          {ctaLabel}
        </Link>
      ) : null}
    </section>
  );
}
