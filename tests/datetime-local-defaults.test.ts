/*
 * User-facing "today"/"current month" defaults must follow the USER'S local
 * calendar, while server code stays on UTC. These tests pin the difference.
 *
 * TZ handling: imports are hoisted above the assignment below, but none of
 * the imported modules call local-time Date methods at module scope, and on
 * POSIX Node (>= 13) assigning process.env.TZ at runtime re-reads the zone
 * for subsequent Date calls. Vitest 4's default forks pool gives each test
 * file its own child process, so this cannot leak into other suites. If the
 * platform ignores the runtime TZ change (e.g. Windows), TZ_APPLIED is false
 * and the zone-pinned tests are skipped — the TZ-agnostic assertions below
 * still verify the local helpers against Date's own local getters.
 */
process.env.TZ = "Africa/Nairobi";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { todayIsoDate, todayIsoDateLocal } from "../lib/datetime";
import { currentMonthKey, currentMonthKeyLocal } from "../lib/expenses";

/* Africa/Nairobi is UTC+3 with no DST: 12:00Z must read as 15:00 local. */
const TZ_APPLIED = new Date("2026-01-15T12:00:00Z").getHours() === 15;

function localIsoDateNow(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localMonthKeyNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("local vs UTC user-facing date defaults", () => {
  beforeAll(() => {
    if (TZ_APPLIED) {
      /* Sanity: with TZ applied, 22:30Z on Aug 11 is already Aug 12 locally. */
      expect(new Date("2026-08-11T22:30:00Z").getDate()).toBe(12);
      expect(new Date("2026-08-11T22:30:00Z").getTimezoneOffset()).toBe(-180);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* TZ-agnostic: the local helpers must agree with Date's own local getters
   * at the mocked instant, whatever zone the runner is in. */
  it("todayIsoDateLocal matches the runner's local calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T22:30:00Z"));
    expect(todayIsoDateLocal()).toBe(localIsoDateNow());
    expect(todayIsoDateLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("currentMonthKeyLocal matches the runner's local calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T22:30:00Z"));
    expect(currentMonthKeyLocal()).toBe(localMonthKeyNow());
    expect(currentMonthKeyLocal()).toMatch(/^\d{4}-\d{2}$/);
  });

  /* (a) Across local midnight (Nairobi, UTC+3): between local midnight and
   * UTC midnight, UTC "today" is still yesterday for the user. */
  it.skipIf(!TZ_APPLIED)(
    "between local midnight and UTC midnight, local today is a day ahead of UTC today",
    () => {
      vi.useFakeTimers();
      // 22:30Z Aug 11 = 01:30 Aug 12 in Africa/Nairobi.
      vi.setSystemTime(new Date("2026-08-11T22:30:00Z"));
      expect(todayIsoDate()).toBe("2026-08-11");
      expect(todayIsoDateLocal()).toBe("2026-08-12");
      expect(todayIsoDateLocal()).not.toBe(todayIsoDate());
    }
  );

  /* (b) Month boundary: on the local 1st before UTC midnight, the UTC month
   * key still points at the previous month. */
  it.skipIf(!TZ_APPLIED)(
    "at a month boundary, local month key is the new month while UTC is the old one",
    () => {
      vi.useFakeTimers();
      // 22:30Z Aug 31 = 01:30 Sep 1 in Africa/Nairobi.
      vi.setSystemTime(new Date("2026-08-31T22:30:00Z"));
      expect(currentMonthKey()).toBe("2026-08");
      expect(currentMonthKeyLocal()).toBe("2026-09");
    }
  );

  /* (c) The UTC helpers are untouched: server code relies on them tracking
   * the UTC calendar regardless of the process zone. */
  it("UTC helpers still track the UTC calendar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T22:30:00Z"));
    expect(todayIsoDate()).toBe("2026-08-11");
    expect(currentMonthKey()).toBe("2026-08");

    vi.setSystemTime(new Date("2026-08-31T23:59:59Z"));
    expect(todayIsoDate()).toBe("2026-08-31");
    expect(currentMonthKey()).toBe("2026-08");

    // Explicit-argument form ignores the clock entirely.
    expect(currentMonthKey(new Date("2026-12-31T23:00:00Z"))).toBe("2026-12");
  });
});
