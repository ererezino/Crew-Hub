import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Crew Hub</h1>
      <p>
        Welcome to Crew Hub. This is the main homepage for team updates,
        planning, and communication.
      </p>
      <p>
        Go to the <Link href="/operations">operations page</Link> to view daily
        workflow priorities.
      </p>
    </main>
  );
}
