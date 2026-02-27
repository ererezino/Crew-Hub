const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60]
];

function toDate(value: string | Date): Date | null {
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

export function formatRelativeTime(value: string | Date): string {
  const dateValue = toDate(value);

  if (!dateValue) {
    return "--";
  }

  const now = new Date();
  const secondsDifference = Math.round((now.getTime() - dateValue.getTime()) / 1000);

  for (const [unit, secondsInUnit] of relativeUnits) {
    if (Math.abs(secondsDifference) >= secondsInUnit) {
      const relativeValue = Math.round(secondsDifference / secondsInUnit) * -1;
      return relativeTimeFormatter.format(relativeValue, unit);
    }
  }

  return "just now";
}

export function formatDateTimeTooltip(value: string | Date): string {
  const dateValue = toDate(value);

  if (!dateValue) {
    return "--";
  }

  return dateValue.toLocaleString();
}
