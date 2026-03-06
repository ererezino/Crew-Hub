import Link from "next/link";

type ContextualHelpItem = {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
};

type ContextualHelpProps = {
  title: string;
  description: string;
  items: readonly ContextualHelpItem[];
  ariaLabel?: string;
};

export function ContextualHelp({
  title,
  description,
  items,
  ariaLabel
}: ContextualHelpProps) {
  return (
    <section className="settings-card contextual-help" aria-label={ariaLabel ?? title}>
      <header className="contextual-help-header">
        <h2 className="section-title">{title}</h2>
        <p className="settings-card-description">{description}</p>
      </header>
      <div className="contextual-help-grid">
        {items.map((item) => (
          <article key={`${item.title}-${item.ctaHref ?? "help"}`} className="contextual-help-item">
            <p className="form-label">{item.title}</p>
            <p className="settings-card-description">{item.description}</p>
            {item.ctaLabel && item.ctaHref ? (
              <Link className="table-row-action" href={item.ctaHref}>
                {item.ctaLabel}
              </Link>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
