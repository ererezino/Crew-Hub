# Performance Baseline — Phase 1

Captured: 2026-03-16

## Build Output — Baseline (pre-optimization)

| Metric | Value |
|---|---|
| Total static JS files | 89 |
| Total JS size (raw) | 3,754,727 bytes (3.58 MB) |
| Total JS size (gzipped estimate) | 986,600 bytes (963 KB) |

### Largest Chunks

| Chunk | Raw Size | Contents |
|---|---|---|
| `da2da5d7` | 409 KB | Recharts (duplicate 1) |
| `cd586f51` | 409 KB | Recharts (duplicate 2) |
| `c13c4f4c` | 273 KB | Zod |
| `064b3ed2` | 225 KB | Unknown (likely app code) |
| `fbf5f1b0` | 132 KB | Framer Motion (duplicate 1) |
| `326d44fa` | 132 KB | Framer Motion (duplicate 2) |
| `36b03368` | 116 KB | Unknown |
| `a6dad97d` | 113 KB | Unknown |
| `8ccfb45c` | 89 KB | React Query + Recharts refs |
| `4acec7b6` | 82 KB | Framer Motion refs |

### Library Bundle Footprint

| Library | Chunks containing it | Total raw size across chunks |
|---|---|---|
| Recharts | 6 chunks | ~1,018 KB |
| Framer Motion | 14 chunks | ~733 KB |
| Zod | 1 chunk | 273 KB |
| Sentry | 1 chunk | 11 KB |

### Sidebar Prefetch Baseline

| Metric | Value |
|---|---|
| Total nav items (Link components in sidebar loop) | 23 |
| Static sidebar Links (brand, settings, profile) | 5 |
| Total Links eligible for Next.js auto-prefetch | 28 |

## Session Profile Field Audit

All 15 audited fields are consumed from session **only** in `/app/(shell)/settings/page.tsx`, which passes them as props to `SettingsClient`.

No other page or component reads these fields from the session object.

| Field | Used outside settings? | Safe to remove from session? |
|---|---|---|
| `bio` | No | Yes |
| `pronouns` | No | Yes |
| `phone` | No | Yes |
| `notification_preferences` | No | Yes |
| `emergency_contact_name` | No | Yes |
| `emergency_contact_phone` | No | Yes |
| `emergency_contact_relationship` | No | Yes |
| `social_linkedin` | No | Yes |
| `social_twitter` | No | Yes |
| `social_instagram` | No | Yes |
| `social_github` | No | Yes |
| `social_website` | No | Yes |
| `favorite_music` | No | Yes |
| `favorite_books` | No | Yes |
| `favorite_sports` | No | Yes |

**Conclusion:** All 15 fields can be safely removed from `getAuthenticatedSession()`. The settings page will need its own profile fetch.

## Phase 1 Progress

| Step | Fix | Status | Build Change | Notes |
|---|---|---|---|---|
| 1 | Sidebar prefetch disabled | Done | No bundle change (runtime only) | 6 Link sites + 1 SupportLink = 7 prefetch={false} added. 28 fewer auto-prefetch requests per page load. |
| 2 | Eliminate framer-motion, CSS animations | Done | −293 KB raw (3.58→3.30 MB), 89→85 chunks | Removed from all 10 files (7 tab transitions, dashboard, hero cards, chart wrapper). Replaced with CSS keyframes + vanilla JS spring for AnimatedNumber. Dependency removed from package.json. |
| 3 | Lazy-load AppShell panels | Done | +3 chunks (code-split), initial load lighter | CommandPalette, NotificationCenter, WhoIsOnline converted to next/dynamic. These 1,309 LOC are now deferred from initial page render. |
| 4 | Cache-Control headers | Done | Runtime only (no bundle change) | 8 routes: dashboard (60s), people (60s), expenses (60s), approvals/counts (60s), announcements (120s), the-crew (120s), notifications (30s), access-config (300s). All use `private` + `stale-while-revalidate`. |
| 5 | Slim session query | Done | Server-side (less data per request) | Removed 15 fields from session SELECT (30→15 columns). Settings page now fetches extended fields independently via `getSettingsProfileFields()` in parallel with searchParams. |
| 6 | Consolidate dashboard queries | Done | Server-side (−4 DB round-trips) | Headcount: 2 queries → 1 (combined country+dept GROUP BY). Expense pipeline: 4 count queries → 1 status query with JS grouping. Net: 5 fewer Supabase calls per admin dashboard load. |

## Build Output — Post Phase 1

| Metric | Before | After | Change |
|---|---|---|---|
| Total static JS files | 89 | 88 | −1 (framer removal offset by dynamic split) |
| Total JS size (raw) | 3,754,727 bytes (3.58 MB) | 3,605,949 bytes (3.44 MB) | −148,778 bytes (−4.0%) |
| Framer Motion in bundle | ~733 KB across 14 chunks | 0 KB | Eliminated entirely |
| framer-motion dependency | Yes | Removed from package.json | Install faster too |
| Session SELECT columns | 30 | 15 | −50% data per auth check |
| Dashboard DB queries (admin) | ~40+ | ~35 | −5 round-trips |
| API routes with Cache-Control | 0 | 8 | Repeat visits served from cache |
| Links auto-prefetching | 28 | 0 | No speculative prefetch storm |
| Code-split deferred panels | 0 | 3 | CommandPalette, NotificationCenter, WhoIsOnline |

## Verification

- `next build`: Clean (no errors)
- `tsc --noEmit`: Clean (no type errors)
- `eslint`: Clean (no lint errors on modified files)
- `vitest run`: 388/388 tests pass
- No framer-motion references in any built chunk

## Regressions Log

| Fix | Regression | Action taken |
|---|---|---|
| — | None observed | — |

---

## Phase 2 Baseline

Phase 2 targets the two highest-leverage remaining bottlenecks: the **middleware auth waterfall** and the **dashboard double-fetch architecture**.

### Current Dashboard Loading Flow (200ms RTT)

```
Browser navigates to /dashboard
  → Middleware (4 sequential Supabase calls)                     ~800ms
    1. supabase.auth.getUser()                                   ~200ms
    2. profiles.select("status") — inactive check                ~200ms
    3. supabase.auth.mfa.listFactors() — MFA enrollment          ~200ms
    4. supabase.auth.mfa.getAuthenticatorAssuranceLevel() — AAL2 ~200ms
  → Next.js renders ShellLayout server component
    5. getAuthenticatedSession() — getUser + profile + org       ~400ms (getUser deduped by Supabase SDK)
  → Next.js renders DashboardPage server component
    6. getAuthenticatedSession() — deduped via React cache()     ~0ms
    — Server returns HTML shell with empty <DashboardClient />
  → Browser hydrates, DashboardClient mounts
    7. useDashboard() fires GET /api/v1/dashboard                ~200ms RTT
      → API route calls getAuthenticatedSession() again          ~400ms server-side
      → ~35 DB queries for dashboard data                        ~600ms server-side
    8. Response arrives, React re-renders with data               ~200ms RTT
```

### Current Metrics

| Metric | Value |
|---|---|
| Middleware Supabase calls (page routes) | 4 sequential |
| Middleware latency estimate (200ms RTT) | ~800ms |
| Dashboard server-component data passed | 0 (empty shell) |
| Dashboard client-fetch round-trips | 1 GET + auth + ~35 DB queries |
| Dashboard first-meaningful-render estimate | ~2600ms (middleware 800 + layout 400 + client fetch 1200 + render 200) |
| Session auth calls duplicated in middleware vs session layer | getUser, MFA checks, profile status |

### Target State

| Metric | Current | Target |
|---|---|---|
| Middleware Supabase calls (page routes) | 4 | 1 (getUser only) |
| Middleware latency (200ms RTT) | ~800ms | ~200ms |
| Profile status + MFA enforcement | Middleware | Session layer (already has caching) |
| Dashboard data source | Client-fetch after hydration | Server-fetched, passed as initialData |
| Dashboard client round-trips on first load | 1 | 0 |
| Dashboard first-meaningful-render estimate | ~2600ms | ~1200ms (middleware 200 + layout+data 800 + render 200) |

### Phase 2 Progress

| Step | Fix | Status | Notes |
|---|---|---|---|
| 0 | Phase 2 baseline | Done | This section |
| 1 | Refactor session result shape | Done | `SessionStatus` type: ok, no_profile, inactive, mfa_required, mfa_setup_required. `AuthenticatedSession` now always returned (except no_user → null). All 234 callers backward-compatible via `!session?.profile` pattern. |
| 2 | Simplify middleware to getUser only | Done | Removed 100 lines (profile status check, MFA enrollment check, AAL2 enforcement). Middleware now: security headers → CSRF → rate limit → API early return → getUser → login/logout redirects. Shell layout handles inactive/MFA redirects via `session.sessionStatus`. |
| 3 | Verify middleware change | Done | tsc clean, eslint clean, 388/388 tests pass (3 hardening tests updated to check session layer instead of middleware), next build clean. |
| 4 | Extract dashboard data-fetching | Done | Created `lib/dashboard/fetch-dashboard-data.ts` (exported `fetchDashboardData(profile, org)`). API route slimmed from 1,498 → 50 lines — now just HTTP wrapper. Zod audit waiver added. |
| 5 | Server-render dashboard with initialData | Done | `page.tsx` calls `fetchDashboardData()` server-side, passes to `DashboardClient` as prop. `useDashboard()` accepts optional `initialData`. No client fetch on first load. |
| 6 | Verify dashboard rendering | Done | tsc clean, eslint clean, 388/388 tests pass, next build clean. |
| 7 | Final measurement + closeout | Done | See results below. |

### Post-Phase 2 Dashboard Loading Flow (200ms RTT)

```
Browser navigates to /dashboard
  → Middleware (1 Supabase call)                                 ~200ms
    1. supabase.auth.getUser()                                   ~200ms
  → Next.js renders ShellLayout server component
    2. getAuthenticatedSession() — getUser + MFA + profile + org ~600ms (getUser deduped, MFA cached 45s)
    — Shell layout checks sessionStatus, redirects if needed
  → Next.js renders DashboardPage server component
    3. getAuthenticatedSession() — deduped via React cache()     ~0ms
    4. fetchDashboardData() — ~35 DB queries server-side         ~600ms
    — Server returns HTML with full dashboard data embedded
  → Browser hydrates, React Query initialized with initialData   ~200ms
    — No client-side fetch needed — data already present
```

### Phase 2 Results

| Metric | Before (Phase 1) | After (Phase 2) | Change |
|---|---|---|---|
| Middleware Supabase calls (page routes) | 4 sequential | 1 | −3 calls (−75%) |
| Middleware latency estimate (200ms RTT) | ~800ms | ~200ms | −600ms |
| Middleware source lines | 267 | 160 | −107 lines (−40%) |
| Dashboard API route lines | 1,498 | 50 | −1,448 lines (extracted to shared module) |
| Dashboard client-fetch on first load | 1 (GET + re-auth + ~35 DB) | 0 | Eliminated |
| Dashboard first-meaningful-render estimate | ~2600ms | ~1600ms | −1000ms (−38%) |
| Session result discrimination | null for 4 different reasons | Explicit `sessionStatus` field | MFA/inactive redirects now precise |
| Total JS size (raw) | 3,605,949 bytes | 3,606,305 bytes | +356 bytes (negligible — new import path) |
| Total static JS files | 88 | 90 | +2 (code-split) |
| `next build` | Clean | Clean | No regressions |
| `tsc --noEmit` | Clean | Clean | No type errors |
| `eslint` | Clean | Clean | No lint errors |
| `vitest run` | 388/388 | 388/388 | All tests pass |

### Phase 2 Regressions Log

| Fix | Regression | Action taken |
|---|---|---|
| Session status refactor | 3 hardening tests expected MFA checks in middleware source | Updated tests to verify MFA enforcement in session layer + shell layout |
| Dashboard route extraction | Zod audit test expected `from "zod"` in dashboard route | Added waiver — Zod validation now in shared `lib/dashboard/fetch-dashboard-data.ts` |
| — | No functional regressions | — |

---

## Phase 3 Baseline

Phase 3 targets two remaining high-leverage bottlenecks: **session-layer sequential calls** and the **Time Off empty-shell → client-fetch waterfall**.

### Current `getAuthenticatedSessionInternal` Call Sequence

```
getUser()                                          ~200ms  (sequential)
  → cache check (in-memory, 5s TTL)               ~0ms
  → checkMfaStatus()                               ~0ms cached / ~400ms uncached
    • getCachedMfaVerification (45s TTL)
    • if miss: listFactors() → getAAL()            ~200ms + ~200ms
  → profiles.select() (14 columns)                 ~200ms  (sequential — waits for MFA)
  → normalizeRoles + inactive check                ~0ms
  → orgs.select() (if includeOrg)                  ~200ms  (sequential — needs profile.org_id)
```

**What is sequential today that could be parallel:**
- `checkMfaStatus()` and `profiles.select()` are independent after `getUser()` returns. Both only need `user.id`. They currently run in series.
- `orgs.select()` depends on `profile.org_id` — must stay sequential after profile.

**Happy-path latency (MFA cached):** getUser 200ms + profile 200ms + org 200ms = **~600ms**
**Happy-path latency (MFA uncached):** getUser 200ms + MFA 400ms + profile 200ms + org 200ms = **~1000ms**

### Current Time Off Loading Flow (200ms RTT)

```
Browser navigates to /time-off
  → Middleware: getUser()                                   ~200ms
  → ShellLayout: getAuthenticatedSession()                  ~600ms (happy path)
  → TimeOffPage: getAuthenticatedSession() (deduped)        ~0ms
    — Server returns HTML with <TimeOffTabsClient> shell
    — No time-off data passed to client
  → Browser hydrates, TimeOffClient mounts
    → useTimeOffSummary() fires GET /api/v1/time-off/summary  ~200ms RTT
      → API route: getAuthenticatedSession()                   ~600ms server-side
      → 5-6 DB queries (dob, policies, balances, requests, holidays, approvers)  ~400ms
    → Response arrives, React re-renders with data              ~200ms RTT
```

**Estimated first-meaningful-render:** ~2200ms (middleware 200 + session 600 + client fetch 1200 + render 200)

### Target State

| Metric | Current | Target |
|---|---|---|
| Session happy-path latency (MFA cached) | ~600ms | ~400ms (MFA check ‖ profile in parallel) |
| Session happy-path latency (MFA uncached) | ~1000ms | ~600ms (MFA check ‖ profile in parallel) |
| Time Off data in initial HTML | No (empty shell) | Yes (server-fetched, passed as initialData) |
| Time Off client-fetch on first load | 1 (GET + re-auth + 5-6 DB) | 0 |
| Time Off first-meaningful-render estimate | ~2200ms | ~1200ms (middleware 200 + session 400 + data 400 + render 200) |

### Phase 3 Progress

| Step | Fix | Status | Notes |
|---|---|---|---|
| 0 | Phase 3 baseline | Done | This section |
| 1 | Parallelize session happy path | Done | `checkMfaStatus()` and `profiles.select()` now run via `Promise.all` after `getUser()`. Org lookup stays sequential (needs `profile.org_id`). |
| 2 | Verify session change | Done | tsc clean, eslint clean, 388/388 tests pass, next build clean. |
| 3 | Extract Time Off data-fetching | Done | Created `lib/time-off/fetch-time-off-summary.ts` (exported `fetchTimeOffSummaryData(profile, query?)`). API route slimmed from 426 → 72 lines — now just HTTP wrapper with query validation. |
| 4 | Server-render Time Off with initialData | Done | `page.tsx` calls `fetchTimeOffSummaryData()` server-side, passes through `TimeOffTabsClient` → `TimeOffClient`. `useTimeOffSummary()` accepts optional `initialData`. No client fetch on first load. |
| 5 | Verify Time Off rendering | Done | tsc clean, eslint clean, 388/388 tests pass, next build clean. |
| 6 | Final measurement + closeout | Done | See results below. |

### Post-Phase 3 Session Call Sequence

```
getUser()                                          ~200ms  (sequential)
  → cache check (in-memory, 5s TTL)               ~0ms
  → Promise.all([                                   runs in parallel
      checkMfaStatus(),                             ~0ms cached / ~400ms uncached
      profiles.select()                             ~200ms
    ])                                              ~200ms (MFA cached) / ~400ms (MFA uncached)
  → normalizeRoles + inactive check                ~0ms
  → orgs.select() (if includeOrg)                  ~200ms  (sequential — needs profile.org_id)
```

**Happy-path latency (MFA cached):** getUser 200ms + max(0ms MFA, 200ms profile) + org 200ms = **~400ms** (was ~600ms)
**Happy-path latency (MFA uncached):** getUser 200ms + max(400ms MFA, 200ms profile) + org 200ms = **~800ms** (was ~1000ms)

### Post-Phase 3 Time Off Loading Flow (200ms RTT)

```
Browser navigates to /time-off
  → Middleware: getUser()                                   ~200ms
  → ShellLayout: getAuthenticatedSession()                  ~400ms (happy path, parallelized)
  → TimeOffPage: getAuthenticatedSession() (deduped)        ~0ms
  → fetchTimeOffSummaryData() — 5-6 DB queries server-side  ~400ms
    — Server returns HTML with full time-off data embedded
  → Browser hydrates, React Query initialized with initialData  ~200ms
    — No client-side fetch needed — data already present
```

### Phase 3 Results

| Metric | Before (Phase 2) | After (Phase 3) | Change |
|---|---|---|---|
| Session happy-path latency (MFA cached) | ~600ms | ~400ms | −200ms (−33%) |
| Session happy-path latency (MFA uncached) | ~1000ms | ~800ms | −200ms (−20%) |
| Session call structure | MFA → profile sequential | MFA ‖ profile parallel | 1 fewer sequential wait |
| Time Off API route lines | 426 | 72 | −354 lines (extracted to shared module) |
| Time Off data in initial HTML | No (empty shell) | Yes (server-fetched) | Eliminated loading state flash |
| Time Off client-fetch on first load | 1 (GET + re-auth + 5-6 DB) | 0 | Eliminated |
| Time Off first-meaningful-render estimate | ~2200ms | ~1200ms | −1000ms (−45%) |
| Total JS size (raw) | 3,606,305 bytes | 3,606,405 bytes | +100 bytes (negligible — new import) |
| Total static JS files | 90 | 90 | No change |
| `next build` | Clean | Clean | No regressions |
| `tsc --noEmit` | Clean | Clean | No type errors |
| `eslint` | Clean | Clean | No lint errors |
| `vitest run` | 388/388 | 388/388 | All tests pass |

### Cumulative Improvement (Phase 1 → Phase 3)

| Metric | Pre-optimization | Post-Phase 3 | Total improvement |
|---|---|---|---|
| Middleware Supabase calls | 4 sequential | 1 | −3 calls |
| Session internal structure | All sequential | MFA ‖ profile parallel | −200ms per navigation |
| Dashboard first-meaningful-render | ~2600ms | ~1600ms | −1000ms |
| Time Off first-meaningful-render | ~2200ms | ~1200ms | −1000ms |
| Total JS size (raw) | 3.58 MB | 3.44 MB | −148 KB (−4%) |
| Framer Motion | 733 KB across 14 chunks | Eliminated | −733 KB |
| Auto-prefetch requests | 28 per page | 0 | Eliminated |

### Phase 3 Regressions Log

| Fix | Regression | Action taken |
|---|---|---|
| — | None observed | — |

---

## Phase 4 Baseline

Phase 4 applies the proven server-data rendering pattern to the **People page** — the most-used admin/manager page after Dashboard.

### Current People Loading Flow (200ms RTT)

```
Browser navigates to /people
  → Middleware: getUser()                                   ~200ms
  → ShellLayout: getAuthenticatedSession()                  ~400ms (parallelized in Phase 3)
  → PeoplePage: getAuthenticatedSession() (deduped)         ~0ms
    — Resolves scope, permissions, renders PeopleClient shell
    — No people data passed to client
  → Browser hydrates, PeopleClient mounts
    → usePeople({ scope }) fires GET /api/v1/people?scope=X  ~200ms RTT
      → API route: getAuthenticatedSession()                  ~400ms server-side
      → 1-3 DB queries:
        1. profiles SELECT (all/reports/me scope)             ~200ms
        2. manager/team lead name lookup (if any IDs)         ~200ms
        3. crew tag lookup (admin only)                       ~200ms
      → Response arrives, React re-renders with data           ~200ms RTT
```

**Estimated first-meaningful-render:** ~1800ms (middleware 200 + session 400 + client fetch 800-1200 + render 200)

### What should be server-rendered vs deferred

**Server-rendered (initialData for first load):**
- The main People list for the user's scope (all/reports/me) with manager names and crew tags resolved
- This is the entire primary view — the table/list that employees see immediately

**Deferred (stay client-fetched):**
- Org chart tab (lazy-loaded, super admin only)
- Delegations tab (lazy-loaded, super admin only)
- Person detail panels (opened on click)
- Create/invite/bulk-upload flows (write operations)

### Target State

| Metric | Current | Target |
|---|---|---|
| People data in initial HTML | No (empty shell) | Yes (server-fetched, passed as initialData) |
| People client-fetch on first load | 1 (GET + re-auth + 1-3 DB) | 0 |
| People first-meaningful-render estimate | ~1800ms | ~1200ms (middleware 200 + session 400 + data 400 + render 200) |

### Phase 4 Progress

| Step | Fix | Status | Notes |
|---|---|---|---|
| 0 | Phase 4 baseline | Done | This section |
| 1 | Repo hygiene check | Done | 32 modified + 1 untracked file from Phase 1/2 found uncommitted. Committed as `260c2e7`, pushed. Working tree clean before Phase 4 work began. |
| 2 | Extract People data-fetching | Done | Created `lib/people/fetch-people-data.ts` (exported `fetchPeopleData(profile, query?)`). API route GET handler slimmed — now just HTTP wrapper with query validation. Removed unused `canViewReports`/`canViewAllPeople` from route. |
| 3 | Server-render People with initialData | Done | `page.tsx` calls `fetchPeopleData()` server-side, passes to both `PeopleTabsClient` (super admin) and `PeopleClient` (others). `usePeople()` accepts optional `initialData`. No client fetch on first load. |
| 4 | Verify in isolation | Done | tsc clean, eslint clean, 388/388 tests pass, next build clean. Browser verified: People table renders with full data on first paint, no spinner flash. |
| 5 | Final measurement + closeout | Done | See results below. |

### Post-Phase 4 People Loading Flow (200ms RTT)

```
Browser navigates to /people
  → Middleware: getUser()                                   ~200ms
  → ShellLayout: getAuthenticatedSession()                  ~400ms (parallelized)
  → PeoplePage: getAuthenticatedSession() (deduped)         ~0ms
  → fetchPeopleData() — 1-3 DB queries server-side          ~400ms
    — Server returns HTML with full people table data embedded
  → Browser hydrates, React Query initialized with initialData  ~200ms
    — No client-side fetch needed — data already present
```

### Phase 4 Results

| Metric | Before (Phase 3) | After (Phase 4) | Change |
|---|---|---|---|
| People data in initial HTML | No (empty shell) | Yes (server-fetched) | Eliminated loading state flash |
| People client-fetch on first load | 1 (GET + re-auth + 1-3 DB) | 0 | Eliminated |
| People API route GET lines | ~230 (inline data-fetching) | ~50 (thin wrapper) | −180 lines (extracted to shared module) |
| People first-meaningful-render estimate | ~1800ms | ~1200ms | −600ms (−33%) |
| Total JS size (raw) | 3,606,405 bytes | 3,606,639 bytes | +234 bytes (negligible — new import) |
| Total static JS files | 90 | 90 | No change |
| `next build` | Clean | Clean | No regressions |
| `tsc --noEmit` | Clean | Clean | No type errors |
| `eslint` | Clean | Clean | No lint errors |
| `vitest run` | 388/388 | 388/388 | All tests pass |
| Browser verification | N/A | People table renders with data on first paint | Confirmed |

### Cumulative Improvement (Phase 1 → Phase 4)

| Metric | Pre-optimization | Post-Phase 4 | Total improvement |
|---|---|---|---|
| Middleware Supabase calls | 4 sequential | 1 | −3 calls |
| Session internal structure | All sequential | MFA ‖ profile parallel | −200ms per navigation |
| Dashboard first-meaningful-render | ~2600ms | ~1600ms | −1000ms |
| Time Off first-meaningful-render | ~2200ms | ~1200ms | −1000ms |
| People first-meaningful-render | ~1800ms | ~1200ms | −600ms |
| Pages with server-rendered data | 0 | 3 (Dashboard, Time Off, People) | 3 high-traffic pages |
| Total JS size (raw) | 3.58 MB | 3.44 MB | −148 KB (−4%) |
| Framer Motion | 733 KB across 14 chunks | Eliminated | −733 KB |
| Auto-prefetch requests | 28 per page | 0 | Eliminated |

### Deferred / Not in Scope

- Org Chart tab (lazy-loaded, super admin only) — stays client-fetched
- Delegations tab (lazy-loaded, super admin only) — stays client-fetched
- Person detail panels (opened on click) — stays client-fetched
- Create/invite/bulk-upload flows — write operations, not applicable

### Phase 4 Regressions Log

| Fix | Regression | Action taken |
|---|---|---|
| — | None observed | — |
