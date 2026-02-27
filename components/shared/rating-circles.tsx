type RatingCirclesProps = {
  id: string;
  value: number | null;
  onChange: (nextValue: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
};

function toneClassForValue(index: number): string {
  if (index <= 2) {
    return "rating-circle-danger";
  }

  if (index === 3) {
    return "rating-circle-warning";
  }

  return "rating-circle-success";
}

export function RatingCircles({
  id,
  value,
  onChange,
  disabled = false,
  readOnly = false
}: RatingCirclesProps) {
  return (
    <div
      id={id}
      className="rating-circles"
      role="radiogroup"
      aria-label="Rating from 1 to 5"
    >
      {Array.from({ length: 5 }, (_, offset) => {
        const rating = offset + 1;
        const isActive = value === rating;
        const toneClass = toneClassForValue(rating);

        return (
          <button
            key={`${id}-${rating}`}
            type="button"
            className={[
              "rating-circle",
              toneClass,
              isActive ? "rating-circle-active" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={disabled || readOnly}
            aria-label={`${rating} out of 5`}
            aria-checked={isActive}
            role="radio"
            onClick={() => onChange(rating)}
          >
            <span className="numeric">{rating}</span>
          </button>
        );
      })}
    </div>
  );
}
