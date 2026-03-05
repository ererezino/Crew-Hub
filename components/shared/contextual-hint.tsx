"use client";

import { useState } from "react";

type ContextualHintProps = {
  heading: string;
  tips: string[];
};

export function ContextualHint({ heading, tips }: ContextualHintProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed || tips.length === 0) {
    return null;
  }

  return (
    <aside className="contextual-hint" aria-label={heading}>
      <div className="contextual-hint-header">
        <p className="contextual-hint-heading">{heading}</p>
        <button
          type="button"
          className="contextual-hint-dismiss"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss tips"
        >
          {"\u2715"}
        </button>
      </div>
      <ul className="contextual-hint-list">
        {tips.map((tip) => (
          <li key={tip} className="contextual-hint-item">
            {tip}
          </li>
        ))}
      </ul>
    </aside>
  );
}
