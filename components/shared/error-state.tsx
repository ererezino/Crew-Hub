import { AlertCircle } from "lucide-react";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry
}: ErrorStateProps) {
  return (
    <section className="error-state" aria-live="assertive">
      <div className="error-state-icon">
        <AlertCircle size={20} />
      </div>
      <h2 className="error-state-title">{title}</h2>
      <p className="error-state-message">{message}</p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}
