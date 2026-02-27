import Link from "next/link";

const priorities = [
  "Review incoming crew requests",
  "Confirm on-site staffing coverage",
  "Check logistics and schedule changes"
];

export default function OperationsPage() {
  return (
    <main>
      <h1>Operations</h1>
      <p>Daily operations focus for Crew Hub.</p>
      <ul>
        {priorities.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>
        Return to the <Link href="/">home page</Link>.
      </p>
    </main>
  );
}
