import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { buildMeta, jsonResponse } from "../_helpers";
import type {
  LeaderboardEntry,
  LeaderboardAdjustment,
  CrewGamesLeaderboardResponseData
} from "../../../../../types/crew-games";

const querySchema = z.object({
  season: z.string().regex(/^\d{4}$/).default(String(new Date().getFullYear()))
});

/* ── GET /api/v1/crew-games/leaderboard ── */

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid query."
      },
      meta: buildMeta()
    });
  }

  const { season } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Fetch all Games Night event IDs for this season/org
  const { data: eventRows, error: eventError } = await supabase
    .from("crew_night_events")
    .select("id")
    .eq("org_id", orgId)
    .eq("event_type", "games_night")
    .eq("status", "completed")
    .is("deleted_at", null)
    .gte("event_date", `${season}-01-01`)
    .lte("event_date", `${season}-12-31`);

  if (eventError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load leaderboard." },
      meta: buildMeta()
    });
  }

  const eventIds = (eventRows ?? []).map((e) => e.id as string);

  // Build leaderboard from results
  const leaderboardMap = new Map<
    string,
    { totalPoints: number; gamesPlayed: Set<string>; wins: number }
  >();

  if (eventIds.length > 0) {
    const { data: resultRows, error: resultError } = await supabase
      .from("crew_night_results")
      .select("event_id, employee_id, points_awarded, placement")
      .in("event_id", eventIds)
      .not("employee_id", "is", null);

    if (resultError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "FETCH_FAILED", message: "Unable to load results." },
        meta: buildMeta()
      });
    }

    for (const row of resultRows ?? []) {
      const empId = row.employee_id as string;
      if (!empId) continue;

      let entry = leaderboardMap.get(empId);
      if (!entry) {
        entry = { totalPoints: 0, gamesPlayed: new Set(), wins: 0 };
        leaderboardMap.set(empId, entry);
      }

      entry.totalPoints += (row.points_awarded as number) ?? 0;
      entry.gamesPlayed.add(row.event_id as string);
      if (row.placement === 1) {
        entry.wins += 1;
      }
    }
  }

  // Fetch adjustments
  const { data: adjRows, error: adjError } = await supabase
    .from("crew_night_leaderboard_adjustments")
    .select("*, profiles:employee_id(full_name)")
    .eq("org_id", orgId)
    .eq("season", season)
    .order("created_at", { ascending: false });

  if (adjError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load adjustments." },
      meta: buildMeta()
    });
  }

  // Apply adjustments to leaderboard
  for (const adj of adjRows ?? []) {
    const empId = adj.employee_id as string;
    let entry = leaderboardMap.get(empId);
    if (!entry) {
      entry = { totalPoints: 0, gamesPlayed: new Set(), wins: 0 };
      leaderboardMap.set(empId, entry);
    }
    entry.totalPoints += (adj.points_delta as number) ?? 0;
  }

  // Fetch profiles for all employees in the leaderboard
  const employeeIds = [...leaderboardMap.keys()];
  const profileMap: Record<string, { full_name: string; avatar_url: string | null }> = {};

  if (employeeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", employeeIds);

    for (const p of profiles ?? []) {
      profileMap[p.id as string] = {
        full_name: p.full_name as string,
        avatar_url: (p.avatar_url as string) ?? null
      };
    }
  }

  const leaderboard: LeaderboardEntry[] = employeeIds
    .map((empId) => {
      const entry = leaderboardMap.get(empId)!;
      const profile = profileMap[empId];
      return {
        employeeId: empId,
        employeeName: profile?.full_name ?? "Unknown",
        avatarUrl: profile?.avatar_url ?? null,
        totalPoints: entry.totalPoints,
        gamesPlayed: entry.gamesPlayed.size,
        wins: entry.wins
      };
    })
    .filter((e) => e.totalPoints > 0 || e.gamesPlayed > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins);

  const adjustments: LeaderboardAdjustment[] = (adjRows ?? []).map((adj) => {
    const profile = adj.profiles as { full_name: string } | null;
    return {
      id: adj.id as string,
      employeeId: adj.employee_id as string,
      employeeName: profile?.full_name ?? "Unknown",
      season: adj.season as string,
      pointsDelta: adj.points_delta as number,
      reason: adj.reason as string,
      createdBy: adj.created_by as string,
      createdAt: adj.created_at as string
    };
  });

  return jsonResponse<CrewGamesLeaderboardResponseData>(200, {
    data: { leaderboard, adjustments, season },
    error: null,
    meta: buildMeta()
  });
}
