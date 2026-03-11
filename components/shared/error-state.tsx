"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

type ErrorStateProps = {
  title?: string;
  message?: string;
  error?: Error | string | null;
  onRetry?: () => void;
};

const technicalPatterns = [
  /column.*does not exist/i,
  /relation.*does not exist/i,
  /violates.*constraint/i,
  /SQLSTATE/i,
  /pg_/i,
  /supabase/i,
  /TypeError/i,
  /undefined is not/i,
  /Cannot read propert/i,
  /fetch failed/i,
  /NetworkError/i,
  /ECONNREFUSED/i,
  /500\b/,
  /502\b/,
  /503\b/,
  /504\b/
];

function sanitizeError(
  error: Error | string | null | undefined
): string | null {
  if (!error) return null;
  const msg = typeof error === "string" ? error : error.message;
  for (const pattern of technicalPatterns) {
    if (pattern.test(msg)) return null;
  }
  return msg;
}

export function ErrorState({
  title,
  message,
  error,
  onRetry
}: ErrorStateProps) {
  const t = useTranslations("common");

  const resolvedTitle = title ?? t("error.generic");
  const sanitized = sanitizeError(error);
  const displayMessage = message ?? sanitized ?? t("error.genericBody");

  return (
    <section className="error-state" aria-live="assertive">
      <div className="error-state-icon">
        <AlertCircle size={40} />
      </div>
      <h2 className="error-state-title">{resolvedTitle}</h2>
      <p className="error-state-message">{displayMessage}</p>
      {onRetry ? (
        <button type="button" className="button button-ghost" onClick={onRetry}>
          {t("tryAgain")}
        </button>
      ) : null}
    </section>
  );
}
