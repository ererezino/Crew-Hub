# PHASE 1 — VERIFICATION
**Date:** 2026-03-09
**Method:** Codebase analysis + browser verification

---

## 1. PRODUCT MAP

### A. Route Map

**Public Routes (no auth)**
| Route | Component | Entry Point |
|-------|-----------|-------------|
| `/login` | LoginPage | Direct / redirect |
| `/mfa-setup` | MfaSetupPage | Post-login redirect |
| `/privacy` | PrivacyPage | Footer link |
| `/terms` | TermsPage | Footer link |

**Authenticated Routes (Shell)**
| Route | Component | Access Roles | Nav Type | Entry |
|-------|-----------|-------------|----------|-------|
| `/dashboard` | DashboardClient | All | Sidebar "Home" | G H |
| `/announcements` | AnnouncementsClient | All | Sidebar "Notifications" | G A (CONFLICT) |
| `/announcements/archive` | AnnouncementsArchiveClient | All | Link from /announcements | — |
| `/time-off` | TimeOffClient | All | Sidebar "Time off" | — |
| `/me/pay` | PayClient | All | Sidebar "My pay" | — |
| `/documents` | DocumentsClient | All | Sidebar "Documents" | G D |
| `/me/documents` | MyDocumentsClient | All | Dashboard quick action only | — |
| `/expenses` | ExpensesClient | All | Sidebar "Expenses" | G E |
| `/expenses/reports` | ExpenseReportsClient | MGR/FIN/HR/SUPER | Link from /expenses | — |
| `/learning` | LearningClient | All | Sidebar "Learning" (HIDDEN: UNAVAILABLE) | — |
| `/learning/courses/[id]` | LearningCourseClient | All | Link from /learning | — |
| `/approvals` | ApprovalsClient | MGR/LEAD/HR/FIN/SUPER | Sidebar "Approvals" | G V (but G A ALSO points here) |
| `/people` | PeopleClient | MGR/LEAD/HR/SUPER | Sidebar "Crew Members" | G P |
| `/people/[id]` | PeopleProfileClient | MGR+ / Self | Link from /people | — |
| `/scheduling` | SchedulingClient | CS dept / SUPER | Sidebar "Scheduling" | G S |
| `/onboarding` | OnboardingClient | MGR/LEAD/HR/SUPER | Sidebar "Onboarding" | — |
| `/onboarding/[id]` | OnboardingInstanceClient | MGR+ | Link from /onboarding | — |
| `/team-hub` | TeamHubClient | All | Sidebar "Team hub" | G B |
| `/team-hub/[hubId]` | HubHomeClient | All | Link from /team-hub | — |
| `/team-hub/[hubId]/[sectionId]` | SectionClient | All | Link from hub | — |
| `/team-hub/[hubId]/[sectionId]/[pageId]` | PageViewClient | All | Link from section | — |
| `/payroll` | PayrollDashboardClient | FIN/HR/SUPER | Sidebar "Payroll" | — |
| `/payroll/runs/new` | PayrollRunCreateClient | FIN/SUPER | Button from /payroll | — |
| `/payroll/runs/[id]` | PayrollRunDetailClient | FIN/SUPER | Link from /payroll | — |
| `/payroll/settings/deductions` | SettingsClient | FIN/HR/SUPER | Link from /payroll | — |
| `/admin/compensation` | AdminCompensationClient | FIN/HR/SUPER | Sidebar "Compensation" | — |
| `/admin/compensation-bands` | CompensationBandsClient | FIN/HR/SUPER | Link from compensation | — |
| `/performance` | PerformanceClient | All (admin features: HR/SUPER) | Sidebar "Performance" | — |
| `/performance/admin` | PerformanceAdminClient | HR/SUPER | Link from /performance | — |
| `/compliance` | ComplianceClient | All (admin features: HR/SUPER) | Sidebar "Compliance" | — |
| `/analytics` | AnalyticsClient | HR/FIN/SUPER | Sidebar "Analytics" | — |
| `/signatures` | SignaturesClient | All | Sidebar "Signatures" (HIDDEN: UNAVAILABLE) | — |
| `/time-attendance` | TimeAttendanceClient | All | **Dashboard quick action only — NOT in sidebar** | — |
| `/surveys/[id]` | SurveyDetailClient | All | Link from /learning?tab=surveys | — |
| `/admin/surveys` | AdminSurveysClient | HR/SUPER | Link from admin | — |
| `/admin/surveys/new` | NewSurveyPage | HR/SUPER | Link from admin | — |
| `/admin/surveys/[id]/results` | SurveyResultsClient | HR/SUPER | Link from admin | — |
| `/admin/learning` | LearningAdminClient | HR/SUPER | Link from /learning | — |
| `/admin/learning/courses/new` | NewLearningCoursePage | HR/SUPER | Link from admin | — |
| `/admin/learning/reports` | LearningReportsClient | HR/SUPER | Link from admin | — |
| `/admin/access-control` | AccessControlClient | SUPER | Sidebar "Roles & access" | — |
| `/settings` | SettingsClient | All | Sidebar bottom | — |
| `/notifications` | NotificationsClient | All | TopBar bell → "View all" | — |
| `/support` | SupportPage | All | Sidebar bottom | — |
| `/me/onboarding` | MyOnboardingClient | All | Dashboard link | — |

**Redirect Routes (~20)**
All redirect routes are clean server-side redirects mapping convenience URLs (e.g., `/me/payslips` → `/me/pay?tab=payslips`, `/surveys` → `/learning?tab=surveys`). They're properly implemented.

### B. Entity Map

See PRODUCT_AUDIT.md Section 1.2 — verified accurate. Key observations:
- Compensation records editable ONLY from `/admin/compensation` (single source of truth ✓)
- Leave requests created from `/time-off`, approved from `/approvals` (clean separation ✓)
- Expenses created from `/expenses`, approved from `/approvals` (clean separation ✓)
- Documents viewable from 2 locations: `/documents` (org-wide) and `/me/documents` (personal) — split is intentional but routing confusing (see finding VF-06)

### C. Action Map

| Action | Trigger Location(s) | Post-Completion | Error Handling |
|--------|---------------------|-----------------|----------------|
| Approve leave | /approvals, Dashboard decision card | Toast success / silent fail | ConfirmDialog in /approvals, **silent catch in DecisionCard** |
| Approve expense | /approvals, Dashboard decision card | Toast success / silent fail | ConfirmDialog in /approvals, **silent catch in DecisionCard** |
| Create payroll run | /payroll/runs/new | Redirect to /payroll/runs/[id] | Inline form errors |
| Calculate payroll | /payroll/runs/[id] | Toast + refresh | Toast error |
| Submit expense | /expenses (SlidePanel) | Toast + list refresh | Inline form errors |
| Create announcement | /announcements (SlidePanel) | Toast + list refresh | Inline form errors |
| Create goal | /performance (SlidePanel) | Toast + refresh | Inline form errors |
| Clock in/out | /time-attendance | Visual state change | Toast error |
| Edit employee profile | /people/[id] (SlidePanel) | Toast + refresh | Inline errors |
| Offboard employee | /people/[id] | Custom modal confirm | Error state |

### D. Pattern Map

| Pattern | Canonical | Variants Found | Impact |
|---------|-----------|----------------|--------|
| Confirmation dialog | `ConfirmDialog` + `useConfirmAction` | 3 files use custom `modal-overlay` divs (people-overview offboarding, payroll rejection, time-attendance approvals) | Accessibility gap in variants |
| Toast notifications | None (no shared component) | 16+ files with inline implementation, 3 JSX variants | High duplication, but consistent timeout (4000ms) |
| Skeleton loading | Mostly inline per-component | 1 shared (dashboard-skeleton.tsx), 20+ inline | Duplication but consistent CSS pattern |
| Status badge | `StatusBadge` (7 tones) | Consistently used across 50+ files | Well-standardized ✓ |
| Empty state | `EmptyState` component | Consistently used | Well-standardized ✓ |
| Error state | `ErrorState` with sanitization | Consistently used | Well-standardized ✓ |
| Tables | Raw `<table>` per module | Every module builds its own | High duplication |
| Slide panel | `SlidePanel` component | Consistently used across 18 files | Well-standardized ✓ |
| Feature state | `FeatureBanner` + `FeatureBadge` + `FeatureGate` | Consistently applied | Well-standardized ✓ |
| Currency display | `CurrencyDisplay` (minor units) | `MoneyInput` has own symbol map (text codes vs proper symbols) | Inconsistency (see VF-05) |
| Page header | `PageHeader` | Consistently used | Well-standardized ✓ |

---

## 2. VERIFIED FINDINGS

### VF-01: Expense reports and analytics hardcode NGN currency

**Category:** Broken flow
**Routes affected:** `/expenses/reports`, `/analytics`
**Files affected:** `app/(shell)/expenses/reports/reports-client.tsx`, `app/(shell)/analytics/analytics-client.tsx`
**Roles affected:** MANAGER, FINANCE_ADMIN, HR_ADMIN, SUPER_ADMIN

**Current behavior:** Every `<CurrencyDisplay>` in expense reports uses `currency="NGN"` (9 instances). Every payroll/expense metric in analytics uses `currency="NGN"` (7 instances). Meanwhile, the main expenses page (`expenses-client.tsx`) correctly uses dynamic currency from expense records, and the API returns per-expense currency from the database.

**Evidence:**
- `reports-client.tsx` line 75: `<CurrencyDisplay amount={row.totalAmount} currency="NGN" />`
- 8 more identical hardcoded instances across metric cards and table cells
- `analytics-client.tsx` lines 618-711: 7 instances of `currency="NGN"` for payroll and expense metrics
- `expenses-client.tsx` lines 543-546: correctly derives `summaryCurrency` from first expense record
- API `expenses/reports/route.ts` returns `expense.currency` per record

**Why this is a real problem:** Accrue has employees in Nigeria, Ghana, Kenya, South Africa, and Canada. An expense submitted in GHS (Ghana) displays as NGN in reports. A Canadian contractor's CAD expenses show as NGN. The data is correct in the database but incorrectly displayed. This makes expense reporting unreliable for multi-currency teams.

**Smallest acceptable fix:** Replace each hardcoded `currency="NGN"` with the actual `currency` field from the data record (which the API already returns). For aggregate totals, either pass currency from the records or display a note when mixed currencies exist.

**Out of scope:** Multi-currency aggregation/conversion logic. We're only fixing display of currency that already exists in the data.

**Severity:** CRITICAL — materially misrepresents financial data for non-Nigerian employees.

---

### VF-02: Dashboard decision card silently swallows API errors

**Category:** Broken flow
**Routes affected:** `/dashboard`
**Files affected:** `components/dashboard/decision-card.tsx`
**Roles affected:** MANAGER, TEAM_LEAD, HR_ADMIN, FINANCE_ADMIN, SUPER_ADMIN

**Current behavior:** When `handleApprove()` or `handleDecline()` fails, the catch block calls `setStatus("idle")` with no error message, no toast, no visual feedback. The card silently resets to its initial state.

**Evidence:**
- `decision-card.tsx` lines 32-38: `catch { setStatus("idle"); }` — empty catch, no error display
- `decision-card.tsx` lines 40-47: identical silent catch for decline
- No toast integration, no error state variable, no visual error indicator

**Why this is a real problem:** A manager approving a leave request from the dashboard who encounters a network error or permission issue sees buttons re-enable with no explanation. They may believe the action succeeded. The dashboard is the primary surface for approval actions — silent failures here mean missed approvals.

**Smallest acceptable fix:** Add an `error` status to the card's state machine. In the catch block, set `setStatus("error")` and render a brief error message (e.g., "Action failed — try again") with a retry affordance. No toast needed — inline error on the card itself is sufficient and simpler.

**Out of scope:** Changing the approval flow architecture. This is a localized error handling fix.

**Severity:** CRITICAL — managers cannot tell when dashboard approval actions fail.

---

### VF-03: Sidebar "Notifications" label links to /announcements — naming confusion

**Category:** Information architecture
**Routes affected:** `/announcements`, `/notifications`
**Files affected:** `lib/navigation.ts` (line 56-61), `components/shared/notification-center.tsx`, `app/(shell)/notifications/notifications-client.tsx`
**Roles affected:** All

**Current behavior:**
- Sidebar shows "Notifications" (Bell icon) → links to `/announcements`
- Topbar shows bell icon → opens notification center dropdown (mixed announcements + notifications)
- Notification center "View all" → links to `/notifications` (shows only notifications, NOT announcements)
- `/announcements` page shows company announcements
- `/notifications` page shows system notifications

**Evidence:**
- `navigation.ts`: `{ label: "Notifications", href: "/announcements", icon: "Bell" }`
- `notification-center.tsx` lines 62-101: merges notifications + announcements into unified feed
- `notification-center.tsx` line 243-249: "View all" links to `/notifications`

**Why this is a real problem:** Three different surfaces (sidebar, dropdown, full page) show three different subsets of data under the same "Notifications" concept. A user seeing an announcement in the dropdown who clicks "View all" lands on a page without that announcement. The sidebar labeled "Notifications" takes you to "Announcements."

**Smallest acceptable fix:** Rename the sidebar item label from "Notifications" to "Announcements" — this matches the destination (`/announcements`). The label should match where it goes. The topbar bell and notification center remain as-is (they serve a different purpose: real-time feed vs. archival view).

**Out of scope:** Merging announcements and notifications into one system. Redesigning the notification center. Changing the /notifications page content.

**Severity:** MAJOR — naming mismatch causes real confusion about where to find announcements vs notifications.

---

### VF-04: Keyboard shortcut G+A conflicts — sidebar says announcements, binding goes to approvals

**Category:** Inconsistency
**Routes affected:** `/announcements`, `/approvals`
**Files affected:** `lib/navigation.ts`, `hooks/use-keyboard-shortcuts.ts`
**Roles affected:** All keyboard users

**Current behavior:**
- `navigation.ts` declares `shortcut: "G A"` for the Notifications/Announcements sidebar item (href: `/announcements`)
- `use-keyboard-shortcuts.ts` maps `{ second: "a", path: "/approvals" }` — G+A goes to Approvals
- The sidebar displays "G A" next to "Notifications" but pressing G then A navigates to `/approvals`

**Evidence:**
- `navigation.ts` line 59: `shortcut: "G A"` on announcements item
- `use-keyboard-shortcuts.ts` line 15: `{ second: "a", path: "/approvals" }`

**Why this is a real problem:** The displayed shortcut is a lie. A user who trusts the sidebar shortcut hint and presses G+A ends up on a different page than expected.

**Smallest acceptable fix:** Update the sidebar shortcut display for the Announcements item to a non-conflicting key (e.g., "G N" for Notifications/Announcements — checking that "G N" is not already taken). The actual keyboard binding for G+A → /approvals is correct and should remain.

**Out of scope:** Redesigning the keyboard shortcut system. Adding shortcuts for all items.

**Severity:** MINOR — affects only keyboard shortcut users, and both destinations are easily reachable via sidebar clicks.

---

### VF-05: MoneyInput uses text currency codes instead of proper symbols

**Category:** Inconsistency
**Routes affected:** Any page with expense or compensation forms
**Files affected:** `components/ui/money-input.tsx`, `lib/format-currency.ts`
**Roles affected:** All (expense submitters), FIN/HR/SUPER (compensation editors)

**Current behavior:**
- `MoneyInput` shows "NGN" as input prefix instead of "₦"
- Shows "GHS" instead of "GH₵", "KES" instead of "KSh", "ZAR" instead of "R"
- `CurrencyDisplay` (used for display) correctly shows "₦5,000" via `Intl.NumberFormat`
- `format-currency.ts` has `getCurrencySymbol()` with correct symbols for all 8 currencies

**Evidence:**
- `money-input.tsx` lines 12-29: own symbol map using text codes `{ NGN: "NGN", GHS: "GHS", KES: "KES", ZAR: "ZAR", USD: "$", CAD: "CA$" }`
- `format-currency.ts`: `{ NGN: { symbol: "₦" }, GHS: { symbol: "GH₵" }, KES: { symbol: "KSh" }, ZAR: { symbol: "R" } }`

**Why this is a real problem:** Input shows "NGN 5000" but display shows "₦5,000" — the inconsistency between entering and viewing money creates visual confusion. It also looks unpolished.

**Smallest acceptable fix:** Import `getCurrencySymbol` from `lib/format-currency.ts` in `MoneyInput` and use it instead of the inline map.

**Out of scope:** Redesigning the MoneyInput component. Changing currency storage format.

**Severity:** MAJOR — visible in every expense and compensation form, visually inconsistent with display components.

---

### VF-06: Time Attendance has no sidebar entry despite being LIVE

**Category:** Information architecture
**Routes affected:** `/time-attendance`
**Files affected:** `lib/navigation.ts`, `app/(shell)/dashboard/dashboard-client.tsx`
**Roles affected:** All employees who clock in/out

**Current behavior:**
- `/time-attendance` is a LIVE module with clock-in/out, timesheet tracking, and approval flows
- It is NOT in the sidebar navigation at all
- The only entry point is a "Clock in" quick action card on the Dashboard, which only appears when `hasTimePolicy` is true
- There is no keyboard shortcut for it

**Evidence:**
- `navigation.ts`: no entry for `/time-attendance` in any nav group
- `dashboard-client.tsx` line 80: `{hasTimePolicy ? <Link href="/time-attendance">...` — conditional quick action
- Feature state: `time_attendance: "LIVE"` in `lib/feature-state.ts`

**Why this is a real problem:** Time attendance is a daily-use feature for employees who clock in/out. Requiring them to go to the Dashboard first (and only see it conditionally) adds friction. After the first visit, they must remember to bookmark it or navigate via Dashboard every time.

**Smallest acceptable fix:** Add a "Time tracking" entry to the "My work" sidebar group with `moduleId: "time_attendance"`. Gate visibility on the same `hasTimePolicy` condition used in the dashboard if needed, or simply show it for all roles (the page already handles the no-policy state gracefully).

**Out of scope:** Redesigning the time attendance module. Adding new functionality.

**Severity:** MAJOR — daily-use feature is hidden from persistent navigation.

---

### VF-07: Notification center "View all" goes to /notifications, losing announcements

**Category:** Broken flow
**Routes affected:** Topbar notification dropdown → `/notifications`
**Files affected:** `components/shared/notification-center.tsx`, `app/(shell)/notifications/notifications-client.tsx`
**Roles affected:** All

**Current behavior:**
- Notification center dropdown merges announcements + notifications into a unified chronological feed
- "View all" link at bottom navigates to `/notifications`
- `/notifications` page shows ONLY system notifications — announcements are not included
- Announcements in the dropdown become invisible after clicking "View all"

**Evidence:**
- `notification-center.tsx` lines 62-101: merges both sources into `feedItems`
- `notification-center.tsx` line 244: `<Link href="/notifications">`
- `notifications-client.tsx`: fetches only from `/api/v1/notifications`, no announcement data

**Why this is a real problem:** Users see announcements in the dropdown, click "View all" expecting to see them in a full list, and they're gone. The dropdown promises a unified view but "View all" delivers only a partial view.

**Smallest acceptable fix:** Change the "View all" link to `/announcements` since the sidebar "Notifications" item also goes to `/announcements`, and announcements are the higher-value content. Alternatively, add a small link separator: "View all notifications" and "View all announcements" as two separate links.

**Out of scope:** Merging /announcements and /notifications into a single page. Redesigning the notification architecture.

**Severity:** MAJOR — creates a "where did my announcement go?" moment that breaks trust in the notification system.

---

### VF-08: Dashboard persona is exclusive — multi-role users lose role-specific widgets

**Category:** Missing state of existing feature
**Routes affected:** `/dashboard`
**Files affected:** `lib/dashboard-persona.ts`, `app/(shell)/dashboard/dashboard-client.tsx`
**Roles affected:** Users with multiple roles (e.g., HR_ADMIN + MANAGER)

**Current behavior:**
- `getDashboardPersona()` uses early-return priority: SUPER_ADMIN > FINANCE_ADMIN > HR_ADMIN > MANAGER > new_hire > employee
- Only ONE persona is returned; widgets are rendered for that persona only
- An HR_ADMIN who is also a MANAGER loses manager-specific widgets (team approval counts, direct report onboarding status)

**Evidence:**
- `dashboard-persona.ts` line 41: `if (hasRole(profile.roles, "HR_ADMIN")) return "hr_admin";` — checked before MANAGER at line 42
- Return type is a single string literal, not a union

**Why this is a real problem:** In a ~15-person company, multiple-role overlap is common. An HR admin who also manages people needs to see both their HR dashboard (org-wide metrics) and their manager dashboard (team-specific actions). Currently they only see HR widgets.

**Smallest acceptable fix:** This is a structural design decision, not a simple bug. The smallest fix would be: if a user has MANAGER/TEAM_LEAD in addition to their primary persona, also render the "Pending approvals" decision cards that the manager persona would show. This doesn't require redesigning the persona system — just adding a supplementary widget check.

**Out of scope:** Redesigning the dashboard layout system. Adding new widget types.

**Severity:** MAJOR — affects the small subset of multi-role users, but in a 15-person company that subset is likely significant.

---

### VF-09: Team Hub cannot create hubs, sections, or pages from UI

**Category:** Incomplete existing capability
**Routes affected:** `/team-hub`, `/team-hub/[hubId]`, `/team-hub/[hubId]/[sectionId]`
**Files affected:** `app/(shell)/team-hub/team-hub-client.tsx`, `app/(shell)/team-hub/[hubId]/hub-home-client.tsx`, `app/(shell)/team-hub/[hubId]/[sectionId]/section-client.tsx`
**Roles affected:** HR_ADMIN, SUPER_ADMIN, TEAM_LEAD (content creators)

**Current behavior:**
- Team Hub is in LIMITED_PILOT state
- Banner states: "Team Hub is in limited pilot. Content management features are coming soon."
- Hubs and sections are read-only — no create/edit/delete buttons in UI
- Only page-level content editing is available (for leads/admins via SlidePanel)
- API endpoints for creating hubs, sections, and pages ALL exist and are functional
- Props like `isLeadOrAdmin` are passed to components but not used for create actions

**Evidence:**
- `team-hub-client.tsx`: no create button, no form, no SlidePanel for hub creation
- `hub-home-client.tsx`: receives `isLeadOrAdmin` prop but only uses it for display gating
- API routes: `POST /api/v1/team-hubs`, `POST /api/v1/team-hubs/[id]/sections`, `POST /api/v1/team-hubs/[id]/sections/[sectionId]/pages` all exist

**Why this is a real problem:** Team Hub is meant to replace Notion as a knowledge base. Without content creation, it's a read-only viewer for pre-seeded content. The APIs are ready, the role checks are in place, but the UI buttons don't exist.

**Smallest acceptable fix:** Add "Create hub" button (for HR_ADMIN/SUPER_ADMIN on the main /team-hub page), "Add section" button (for leads/admins on hub pages), and "Add page" button (for leads/admins on section pages) — each opening a SlidePanel with a minimal form (title + optional description). The API endpoints already handle the rest.

**Out of scope:** Rich text editing, drag-and-drop reordering, template systems, hub permissions beyond existing role checks.

**Severity:** CRITICAL — the module's core purpose (content creation) is impossible from the UI despite backend readiness.

---

### VF-10: Surveys redirect into Learning module — conceptual mismatch

**Category:** Information architecture
**Routes affected:** `/surveys` → redirects to `/learning?tab=surveys`
**Files affected:** `app/(shell)/surveys/page.tsx`
**Roles affected:** All (survey respondents)

**Current behavior:**
- `/surveys` is a server-side redirect to `/learning?tab=surveys`
- Learning module is in UNAVAILABLE state (hidden from nav, actions disabled)
- Surveys (engagement, pulse, exit) are conceptually different from Learning (courses, certificates)

**Evidence:**
- `app/(shell)/surveys/page.tsx`: `redirect("/learning?tab=surveys")` — server redirect
- `lib/feature-state.ts`: `learning: "UNAVAILABLE"`, `surveys: "UNAVAILABLE"`
- Both modules are UNAVAILABLE, so this redirect connects two hidden modules

**Why this is a real problem:** When surveys eventually become LIVE, users told to "fill out a survey" will either navigate to a hidden Learning module or need to know the URL directly. The conceptual mismatch (surveys ≠ learning) creates confusion about where to find surveys.

**Smallest acceptable fix:** Since both modules are UNAVAILABLE, defer this. When either module is promoted to LIVE, surveys should have their own top-level page rather than being nested under Learning. Flag for future work.

**Out of scope:** Building survey functionality. This is an IA decision for when the modules go live.

**Severity:** MINOR — both modules are UNAVAILABLE so no user is currently affected. This is a future readiness issue.

---

## 3. DISCARDED FINDINGS

### DF-01: "Two Documents sidebar entries" — DISCARDED (Previous audit A-05)
**Previous claim:** Documents accessible from two separate sidebar entries with different scope.
**Verified reality:** There is exactly ONE "Documents" sidebar entry in the "My work" group, linking to `/documents`. The `/me/documents` page (personal documents + travel letters) has NO sidebar entry. The previous audit was factually wrong about two sidebar entries.
**Actual status:** The split between `/documents` (org-wide) and `/me/documents` (personal) is intentional and not confusing in practice — `/me/documents` is reachable via a tab on the personal profile and dashboard quick actions.

### DF-02: "Scheduling templates unreachable from any navigation" — DISCARDED (Previous audit C-02)
**Previous claim:** `/admin/scheduling/templates` is unreachable from any navigation.
**Verified reality:** Scheduling templates are accessible via the "Templates" tab on the `/scheduling` page. The tab is role-gated to HR_ADMIN/SUPER_ADMIN users but is discoverable for those who have access. It renders inline via `SchedulingTemplatesAdminClient` when `activeTab === "templates"`.
**Actual status:** Properly implemented with role-based tab visibility.

### DF-03: "No shared skeleton component" — DOWNGRADED from MINOR finding
**Previous claim:** Every page defines its own skeleton loading component, creating maintenance burden.
**Verified reality:** While skeletons ARE mostly inline, they use consistent CSS classes (`skeleton-box`, `table-skeleton-row`, etc.) and the structural pattern is identical. The duplication is cosmetic code, not behavioral divergence. The CSS is the single source of truth for skeleton appearance. Consolidating inline skeleton functions would save code but wouldn't change behavior.
**Actual status:** Not worth fixing — the cost of change exceeds the benefit. The CSS-level consistency means visual output is already uniform.

### DF-04: "monthToDateRange duplicated" — DISCARDED (Previous audit A-06)
**Previous claim:** Same function duplicated between time-off and expenses libs.
**Verified reality:** While both modules have date range utilities, they serve module-specific contexts and the code is minimal (3-5 lines). Consolidating would create a dependency between unrelated modules for trivial benefit.
**Actual status:** Not a meaningful problem.

---

## 4. DOWNGRADED FINDINGS

### DG-01: Toast duplication — DOWNGRADED from MAJOR to MINOR
**Previous severity:** MAJOR (A-01 in prior audit)
**Verified reality:** While 16+ files duplicate toast logic, the pattern is consistent (all use 4000ms timeout, same CSS classes, same aria attributes). The JSX has 3 variants but they're functionally identical. A shared toast component would be better engineering, but the current duplication doesn't cause user-facing confusion or behavioral inconsistency.
**Revised severity:** MINOR — maintainability issue, not a user-facing problem. Would not prioritize over flow fixes.

### DG-02: No shared DataTable — DOWNGRADED from MAJOR to MINOR
**Previous severity:** MAJOR (A-03 in prior audit)
**Verified reality:** Tables use consistent CSS classes (`data-table`, `data-table-row`, `table-sort-trigger`). Sort behavior varies slightly but all modules with sort show the same ↑/↓ indicators. The duplication is code-level, not behavior-level. Building a shared DataTable is a significant refactor with regression risk for modest user-facing benefit.
**Revised severity:** MINOR — engineering debt, but changing it now would risk regressions across every list view.

### DG-03: Custom modal-overlay divs — DOWNGRADED from MAJOR to MINOR
**Previous severity:** MAJOR (A-04 in prior audit)
**Verified reality:** Only 3 files use custom modal-overlay instead of ConfirmDialog. The keyboard-shortcuts-modal is legitimately different (not a confirmation). The people-overview offboarding and payroll rejection modals could use ConfirmDialog but work correctly. The accessibility gap (no focus trapping in custom modals) is real but low-frequency.
**Revised severity:** MINOR — polish issue, not blocking any flow.

### DG-04: Detail views use different patterns — NOT A FINDING
**Previous severity:** MINOR (D-05 in prior audit)
**Verified reality:** The pattern choice (full page vs slide panel vs inline) follows a reasonable logic: entities with many fields and sub-tabs (employee, payroll run) get full pages; simple entities with few fields (expense, document) get slide panels; very simple items (announcements) are inline. This is intentional design, not inconsistency.
**Actual status:** Discarded — not a problem.

### DG-05: Surveys → Learning redirect — DOWNGRADED from MAJOR to MINOR
**Previous severity:** MAJOR (B-06 in prior audit)
**Verified reality:** Both modules are UNAVAILABLE. No user is currently affected. This should be fixed when either module is promoted to LIVE, but it's not a current problem.
**Revised severity:** MINOR — future readiness issue only.

---

## 5. PRIORITY RANKING

**CRITICAL (blocks existing core flow):**
1. VF-01: Expense reports/analytics hardcode NGN currency
2. VF-02: Dashboard decision card swallows errors silently
3. VF-09: Team Hub cannot create content from UI

**MAJOR (meaningful confusion or structural weakness):**
4. VF-03: Sidebar "Notifications" label → /announcements mismatch
5. VF-05: MoneyInput uses text codes instead of proper currency symbols
6. VF-06: Time Attendance has no sidebar entry
7. VF-07: Notification center "View all" loses announcements
8. VF-08: Dashboard persona exclusive — multi-role users lose widgets

**MINOR (lower-frequency, polish, future readiness):**
9. VF-04: Keyboard shortcut G+A conflict
10. VF-10: Surveys → Learning redirect (both UNAVAILABLE)
11. DG-01: Toast duplication (maintainability)
12. DG-02: DataTable duplication (maintainability)
13. DG-03: Custom modal-overlay (accessibility polish)

---

## 6. RECOMMENDED FIX BATCHES

### Batch 1: Financial Data Integrity
**Why together:** Both fixes correct how monetary data is displayed. They share the same files (reports, analytics) and the same testing pattern (verify multi-currency display).
**Findings resolved:** VF-01 (hardcoded NGN), VF-05 (MoneyInput symbols)
**Dependencies:** None
**Estimate:** Small — string replacements and one import change
**Can defer:** No — VF-01 is CRITICAL

### Batch 2: Dashboard Reliability
**Why together:** Both fixes improve the dashboard as the primary action surface. They share the same page and the same testing pattern (dashboard role-based behavior).
**Findings resolved:** VF-02 (decision card errors), VF-08 (multi-role persona)
**Dependencies:** None
**Estimate:** Small for VF-02 (add error state). Medium for VF-08 (add supplementary widget logic).
**Can defer:** VF-08 can be deferred if scope is tight. VF-02 cannot — it's CRITICAL.

### Batch 3: Navigation & Discovery
**Why together:** All fixes improve navigation labels and entry points. They must be tested together because changing sidebar items affects how users find everything.
**Findings resolved:** VF-03 (Notifications label), VF-04 (G+A shortcut), VF-06 (Time Attendance sidebar), VF-07 (View all link)
**Dependencies:** VF-03 and VF-04 are linked (same sidebar item). VF-07 relates to VF-03 conceptually.
**Estimate:** Small — label changes, one new nav item, one link change
**Can defer:** All are MAJOR but low-risk. Could defer VF-04 (MINOR).

### Batch 4: Team Hub Content Management
**Why together:** Single module completion.
**Findings resolved:** VF-09 (Team Hub create)
**Dependencies:** None
**Estimate:** Medium — requires 3 new SlidePanel forms (hub, section, page creation), wiring to existing API endpoints
**Can defer:** Only if Team Hub itself is deprioritized. It's LIMITED_PILOT and meant to replace Notion.

---

## PHASE 1 COMPLETE — READY FOR DECISION MEMO
