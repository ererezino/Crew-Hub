import type { ReactNode } from "react";

type StatusTone =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "draft"
  | "processing";

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
};

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
