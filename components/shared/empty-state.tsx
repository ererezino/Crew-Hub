import Link from "next/link";

type EmptyStateProps = {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export function EmptyState({
  title,
  description,
  ctaLabel,
  ctaHref
}: EmptyStateProps) {
  return (
    <section className="empty-state" aria-live="polite">
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
      {ctaLabel && ctaHref ? (
        <Link className="button button-accent" href={ctaHref}>
          {ctaLabel}
        </Link>
      ) : null}
    </section>
  );
}
