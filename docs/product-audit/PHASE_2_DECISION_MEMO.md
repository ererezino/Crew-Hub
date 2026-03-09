# PHASE 2 — DECISION MEMO
**Date:** 2026-03-09

---

## 1. EXECUTIVE SUMMARY

Crew Hub is a well-structured internal HR platform with strong foundational patterns (feature state system, shared components, role-based access). However, verification revealed **3 critical issues** and **5 major issues** that affect real workflows today.

The structural goals for this implementation pass are:

1. **Financial data accuracy** — Currency display must be truthful across all surfaces
2. **Action reliability** — When a user clicks Approve/Decline, they must know if it worked or failed
3. **Navigation honesty** — Labels must match destinations; daily-use features must be findable
4. **Module completion** — Team Hub's core purpose (content creation) must be possible from the UI

We will NOT add new features, redesign the navigation, or refactor shared infrastructure (toasts, tables, skeletons). We will make the smallest correct fixes to the specific verified problems.

---

## 2. DECISIONS APPROVED FOR IMPLEMENTATION NOW

### D-01: Fix hardcoded NGN currency in expense reports and analytics
**Verified findings:** VF-01
**What will change:**
- `reports-client.tsx`: Replace all 9 `currency="NGN"` with `currency={row.currency}` (for per-record displays) and `currency={primaryCurrency}` (for aggregate metric cards, derived from the data)
- `analytics-client.tsx`: Replace all 7 `currency="NGN"` with `currency={data.payroll.metrics.currency}` or `currency={data.expenses.metrics.currency}` — checking what fields the API already returns

**What will NOT change:**
- `payroll/settings/deductions/settings-client.tsx`: This is the Nigeria-specific tax calculator. NGN is correct there. Not touching it.
- API endpoints — they already return per-record currency
- CurrencyDisplay component — it already handles all currencies correctly

**Why this is the smallest correct fix:** The data already has currency information. We're just passing it through instead of overriding it with a hardcoded string.

**Regression risks:**
- If any data record has null/undefined currency, CurrencyDisplay needs to handle that gracefully (verify it does)
- Aggregate totals may mix currencies — need to verify how the API aggregates multi-currency data

**Dependencies:** None
**Roles affected:** MANAGER, FINANCE_ADMIN, HR_ADMIN, SUPER_ADMIN
**Flows affected:** Expense reporting, analytics dashboard

---

### D-02: Add error handling to dashboard decision card
**Verified findings:** VF-02
**What will change:**
- `decision-card.tsx`: Add `"error"` to the status union type
- In catch blocks: set `setStatus("error")` instead of `setStatus("idle")`
- Render an inline error message when status is "error" with a "Try again" button that resets to "idle"
- Keep it self-contained — no external toast system needed

**What will NOT change:**
- The approve/decline callback API — callers remain the same
- Other approval surfaces (/approvals page) — they already have error handling
- No changes to the dashboard layout or widget system

**Why this is the smallest correct fix:** Adding one status value and a conditional render block. No new components, no new dependencies.

**Regression risks:**
- Card height may change when error message appears — verify it doesn't break layout
- Verify "Try again" correctly resets to idle and re-enables buttons

**Dependencies:** None
**Roles affected:** MANAGER, TEAM_LEAD, HR_ADMIN, FINANCE_ADMIN, SUPER_ADMIN
**Flows affected:** Dashboard approval actions

---

### D-03: Rename sidebar "Notifications" to "Announcements"
**Verified findings:** VF-03
**What will change:**
- `lib/navigation.ts`: Change `label: "Notifications"` to `label: "Announcements"` for the item with `href: "/announcements"`
- Update the `description` field to match (e.g., "Company announcements and updates")

**What will NOT change:**
- The route (`/announcements`) — stays the same
- The icon (Bell) — stays the same
- The notification center dropdown — stays the same
- The `/notifications` page — stays the same
- No route changes, no component changes

**Why this is the smallest correct fix:** One label change. The label should match the destination.

**Regression risks:**
- Command palette searches for "Notifications" will no longer find this item — they'll find "Announcements" instead. This is correct behavior.
- Users who memorized "Notifications = sidebar" will need to find "Announcements" — but the icon (Bell) is the same so visual discovery is preserved.

**Dependencies:** Should be done together with D-04 (shortcut fix) since they affect the same nav item.
**Roles affected:** All
**Flows affected:** Sidebar navigation, command palette

---

### D-04: Fix keyboard shortcut G+A conflict
**Verified findings:** VF-04
**What will change:**
- `lib/navigation.ts`: Change the `shortcut` display for the Announcements item from `"G A"` to a non-conflicting key. Proposed: `"G N"` (checking it's not taken — current bindings are G H, G A, G P, G S, G T, G B, so G N is free).
- Do NOT add an actual keyboard binding for G+N in `use-keyboard-shortcuts.ts` — the shortcut display serves as a hint but doesn't need a binding since this item already has a sidebar click target.

**What will NOT change:**
- `use-keyboard-shortcuts.ts`: G+A continues to map to `/approvals`
- All other keyboard shortcuts remain the same

**Why this is the smallest correct fix:** Remove the conflicting display. The sidebar item still shows its shortcut hint, but now it doesn't conflict with an actual binding.

**Regression risks:** Minimal — only changes a display string.

**Dependencies:** Do with D-03 (same nav item being modified).
**Roles affected:** Keyboard users
**Flows affected:** None — display-only change

---

### D-05: Fix MoneyInput currency symbols
**Verified findings:** VF-05
**What will change:**
- `components/ui/money-input.tsx`: Remove the inline symbol map. Import `getCurrencySymbol` from `lib/format-currency.ts`. Use it to derive the display prefix.

**What will NOT change:**
- `format-currency.ts` — it already has correct symbols
- `CurrencyDisplay` — already works correctly
- The MoneyInput API (props remain the same)

**Why this is the smallest correct fix:** Replace a local constant with an import from the canonical source.

**Regression risks:**
- Symbols are wider than text codes (e.g., "₦" vs "NGN"). Verify the input layout doesn't break with wider prefix text. The CSS should handle this but verify.
- `getCurrencySymbol` returns "$" for unknown codes. Verify this matches MoneyInput's current fallback.

**Dependencies:** None
**Roles affected:** All expense submitters, FIN/HR/SUPER compensation editors
**Flows affected:** Expense creation form, compensation forms

---

### D-06: Add Time Attendance to sidebar
**Verified findings:** VF-06
**What will change:**
- `lib/navigation.ts`: Add a new entry to the "My work" group:
  ```
  { label: "Time tracking", href: "/time-attendance", icon: "Clock", description: "Clock in, view timesheets", shortcut: "", moduleId: "time_attendance" }
  ```
- Position it after "Expenses" in the "My work" group (logical grouping with work tracking)

**What will NOT change:**
- The `/time-attendance` page itself — no changes
- The dashboard quick action — it remains as an additional entry point
- Role gating — the page already handles access internally

**Why this is the smallest correct fix:** One nav item addition. The page, module, and feature state already exist.

**Regression risks:**
- Sidebar length increases by one item — verify it doesn't cause scrolling issues on smaller screens
- Verify the `moduleId: "time_attendance"` correctly gates visibility via the feature state system

**Dependencies:** None
**Roles affected:** All employees with time policies
**Flows affected:** Daily clock-in/out discovery

---

### D-07: Fix notification center "View all" destination
**Verified findings:** VF-07
**What will change:**
- `components/shared/notification-center.tsx`: Change the "View all" link from `/notifications` to `/announcements`

**What will NOT change:**
- The notification center dropdown content (still merges both sources)
- The `/notifications` page (still exists, accessible via direct URL)
- The `/announcements` page

**Why this is the smallest correct fix:** The sidebar "Notifications"→"Announcements" item goes to `/announcements`. The notification center's "View all" should go to the same place for consistency, especially after D-03 renames the sidebar item to "Announcements."

**Regression risks:**
- Users who relied on "View all" to reach `/notifications` will now reach `/announcements`. Since the sidebar already goes to `/announcements`, this creates consistency rather than breaking expectations.

**Dependencies:** Should be done after or with D-03 (sidebar rename) for consistency.
**Roles affected:** All
**Flows affected:** Notification center → full page navigation

---

### D-08: Add content creation to Team Hub
**Verified findings:** VF-09
**What will change:**
- `team-hub-client.tsx`: Add "Create hub" button for HR_ADMIN/SUPER_ADMIN. Opens SlidePanel with form (name, department, description). POSTs to existing `/api/v1/team-hubs` endpoint.
- `hub-home-client.tsx`: Add "Add section" button for leads/admins (using existing `isLeadOrAdmin` prop). Opens SlidePanel with form (title, description). POSTs to existing `/api/v1/team-hubs/[id]/sections` endpoint.
- `section-client.tsx`: Add "Add page" button for leads/admins. Opens SlidePanel with form (title, type selection [document/runbook/contact-list]). POSTs to existing `/api/v1/team-hubs/[id]/sections/[sectionId]/pages` endpoint.

**What will NOT change:**
- API endpoints — they already exist and work
- Page content editing — already works via existing SlidePanel
- Role checks — using existing `isLeadOrAdmin` / admin props
- Hub/section/page display — read-only views stay the same
- Team Hub feature state (LIMITED_PILOT) — stays the same

**Why this is the smallest correct fix:** Three buttons, three forms, three existing API endpoints. The forms are minimal (title + 1-2 optional fields). SlidePanel is the established pattern for creation forms.

**Regression risks:**
- API validation errors need to be handled in the forms — verify what the APIs expect and return on error
- After creating a hub/section/page, the list should refresh — use the existing `refresh()` pattern from data hooks
- The "coming soon" banner text should be updated or removed since content management is no longer "coming soon"

**Dependencies:** None
**Roles affected:** HR_ADMIN, SUPER_ADMIN, TEAM_LEAD, MANAGER
**Flows affected:** Team Hub content creation (currently impossible)

---

## 3. DECISIONS EXPLICITLY DEFERRED

### DEFERRED-01: Dashboard multi-role persona (VF-08)
**Why deferred:** The smallest correct fix (adding supplementary widgets for multi-role users) requires understanding the exact widget rendering system and testing multiple role combinations. The dashboard works correctly for single-role users, which is the majority case. This is a quality-of-life improvement, not a broken flow.
**Risk of deferral:** Multi-role users (likely 3-5 people in a 15-person company) see a less personalized dashboard. They can still access all features via sidebar.
**What would need to be true to revisit:** Clear specification of which widgets each role combination should show.

### DEFERRED-02: Surveys → Learning redirect (VF-10)
**Why deferred:** Both modules are UNAVAILABLE. No user is currently affected. When either module is promoted to LIVE, this should be reconsidered.
**Risk of deferral:** Zero — no user can reach either module today.

### DEFERRED-03: Toast component consolidation (DG-01)
**Why deferred:** Engineering debt, not user-facing problem. All toasts behave consistently (4000ms, same CSS). The consolidation would touch 16+ files with regression risk for no visible user benefit.
**Risk of deferral:** Slightly higher maintenance cost for future development.

### DEFERRED-04: DataTable consolidation (DG-02)
**Why deferred:** High regression risk (would touch every list view), engineering effort disproportionate to user benefit. Tables already look consistent via shared CSS.
**Risk of deferral:** Each new list view requires reimplementing table logic.

### DEFERRED-05: Custom modal-overlay consolidation (DG-03)
**Why deferred:** Only 2 non-modal custom overlays exist (offboarding, payroll rejection). Both work correctly. Low frequency, low impact.
**Risk of deferral:** Minor accessibility gap in 2 specific flows.

---

## 4. ITEMS RECLASSIFIED AS FEATURE WORK / OUT OF SCOPE

### OOS-01: Multi-currency aggregation in reports
VF-01 fix passes through per-record currency. If the API aggregates totals across multiple currencies into a single number, that's a backend data modeling issue requiring currency conversion — which is new feature work, not a display fix.

### OOS-02: Unified announcements + notifications page
Merging `/announcements` and `/notifications` into a single page would be new feature work. We're fixing navigation labels and link destinations instead.

### OOS-03: AFK/presence integration in scheduling and people views
Surfacing presence data in scheduling, people directory, and approval contexts would require new component development and API integration — this is feature work.

---

## 5. IMPLEMENTATION BATCHES

### Batch 1: Financial Data Integrity
**Why this batch exists:** Fixes the most severe data accuracy issue (CRITICAL) alongside a related currency symbol inconsistency (MAJOR). Both are currency-related, share testing patterns, and have zero dependencies.
**Decisions included:** D-01, D-05
**Order:** D-05 first (simpler, lower risk), then D-01 (more files touched)
**Validation required:**
- Verify CurrencyDisplay handles null/undefined currency gracefully
- Test expense reports page with multi-currency data
- Test analytics page currency displays
- Test MoneyInput in expense form and compensation form
- Lint + build pass

### Batch 2: Dashboard Reliability
**Why this batch exists:** Fixes the second CRITICAL issue (silent error swallowing). Isolated to one component with zero dependencies.
**Decisions included:** D-02
**Order:** Single change
**Validation required:**
- Simulate approve/decline failure (network error or bad response)
- Verify error message appears on card
- Verify "Try again" resets properly
- Verify successful approve/decline still works (regression check)
- Lint + build pass

### Batch 3: Navigation & Discovery
**Why this batch exists:** Four interconnected navigation fixes that make the sidebar and notification center more honest. Must be tested together since they affect how users find features.
**Decisions included:** D-03, D-04, D-06, D-07
**Order:** D-03 + D-04 together (same nav item), then D-06 (new nav item), then D-07 (notification center link)
**Validation required:**
- Sidebar renders "Announcements" with correct icon and new shortcut hint
- G+A still navigates to /approvals
- "Time tracking" appears in sidebar under "My work"
- Clicking "Time tracking" reaches /time-attendance
- Notification center "View all" goes to /announcements
- Command palette finds "Announcements" and "Time tracking"
- Lint + build pass

### Batch 4: Team Hub Content Management
**Why this batch exists:** Completes the core purpose of a LIMITED_PILOT module. Largest batch but self-contained — all changes are within the team-hub directory.
**Decisions included:** D-08
**Order:** Hub creation → Section creation → Page creation (each depends on the previous level existing)
**Validation required:**
- Create a new hub from /team-hub (admin role)
- Create a new section inside a hub (lead/admin role)
- Create a new page inside a section (lead/admin role)
- Verify created items appear in list without page refresh
- Verify forms handle API errors gracefully
- Verify the "coming soon" banner is updated
- Lint + build pass

---

## PHASE 2 COMPLETE — DECISIONS LOCKED

8 decisions approved. 5 deferred. 3 classified as out of scope.
4 implementation batches defined.
Ready for Phase 3 execution.
