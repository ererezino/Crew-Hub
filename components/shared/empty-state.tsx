import type { ReactNode } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  /** Set to false to hide the icon entirely */
  showIcon?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
};

export function EmptyState({
  title,
  description,
  icon,
  showIcon = true,
  ctaLabel,
  ctaHref,
  onCtaClick
}: EmptyStateProps) {
  return (
    <section className="empty-state" aria-live="polite">
      {showIcon ? (
        <div className="empty-state-icon">
          {icon ?? <Inbox size={32} aria-hidden="true" />}
        </div>
      ) : null}
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
      {ctaLabel && onCtaClick ? (
        <button type="button" className="button" onClick={onCtaClick}>
          {ctaLabel}
        </button>
      ) : ctaLabel && ctaHref ? (
        <Link className="button" href={ctaHref}>
          {ctaLabel}
        </Link>
      ) : null}
    </section>
  );
}
