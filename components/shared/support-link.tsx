import Link from "next/link";

type SupportLinkProps = {
  variant?: "footer" | "inline" | "button";
  isActive?: boolean;
};

/**
 * Support / Help link — navigates to the /support page.
 */
export function SupportLink({ variant = "footer", isActive = false }: SupportLinkProps) {
  if (variant === "inline") {
    return (
      <Link href="/support" className="link-text">
        Help & Support
      </Link>
    );
  }

  if (variant === "button") {
    return (
      <Link href="/support" className="button button-ghost">
        Help & Support
      </Link>
    );
  }

  /* Footer variant: matches the sidebar-link pattern used by Settings */
  return (
    <Link
      href="/support"
      className={
        isActive
          ? "sidebar-link sidebar-link-active sidebar-link-pinned"
          : "sidebar-link sidebar-link-pinned"
      }
    >
      <span className="sidebar-link-indicator" aria-hidden="true" />
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        className="sidebar-link-icon"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="17" r=".5" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
      </svg>
      <span className="sidebar-link-text">Help & Support</span>
    </Link>
  );
}
