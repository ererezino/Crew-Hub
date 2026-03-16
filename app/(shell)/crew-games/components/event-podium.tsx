"use client";

import { useCrewGameEventDetail } from "../../../../hooks/use-crew-games";
import { PodiumDisplay } from "./podium-display";

type EventPodiumProps = {
  eventId: string;
};

/**
 * Self-contained podium that fetches its own event detail data.
 * Use in hero sections and expanded event cards where results
 * aren't already available from the parent.
 */
export function EventPodium({ eventId }: EventPodiumProps) {
  const { results, isLoading } = useCrewGameEventDetail(eventId);

  if (isLoading || results.length === 0) return null;

  return <PodiumDisplay results={results} />;
}
