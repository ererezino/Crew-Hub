import { AlertCircle } from "lucide-react";

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
  title = "Something went wrong",
  message,
  error,
  onRetry
}: ErrorStateProps) {
  const sanitized = sanitizeError(error);
  const displayMessage =
    message ??
    sanitized ??
    "Try again in a moment. If it keeps happening, reach out to ops.";

  return (
    <section className="error-state" aria-live="assertive">
      <div className="error-state-icon">
        <AlertCircle size={40} />
      </div>
      <h2 className="error-state-title">{title}</h2>
      <p className="error-state-message">{displayMessage}</p>
      {onRetry ? (
        <button type="button" className="button button-ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}
