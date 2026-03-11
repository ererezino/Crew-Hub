# Crew Hub Product Audit

**Date:** 2026-03-09
**Auditor:** Claude (Senior PM, 10yr experience at Stripe/Linear/Rippling)
**Codebase snapshot:** commit `c00f72b` on `main`

---

## Section 1: Product Map

### 1.1 Route Inventory

#### Public Routes
| Route | Component | State |
|-------|-----------|-------|
| `/login` | LoginPage | Functional |
| `/mfa-setup` | MfaSetupPage | Functional |
| `/privacy` | PrivacyPage | Static |
| `/terms` | TermsPage | Static |

#### Authenticated Routes (Shell)
| Route | Component | Access | Feature State | Entry Point |
|-------|-----------|--------|---------------|-------------|
| `/dashboard` | DashboardClient | All | LIVE | Sidebar "Home" |
| `/announcements` | AnnouncementsClient | All | LIVE | Sidebar "Notifications" |
| `/announcements/archive` | AnnouncementsArchiveClient | All | LIVE | Link from /announcements |
| `/time-off` | TimeOffClient | All | LIVE | Sidebar "Time off" |
| `/time-off/approvals` | Redirect → `/approvals?tab=time-off` | — | — | — |
| `/time-off/calendar` | Redirect → `/time-off?tab=calendar` | — | — | — |
| `/me/pay` | PayClient | All | LIVE | Sidebar "My pay" |
| `/me/payslips` | Redirect → `/me/pay?tab=payslips` | — | — | — |
| `/me/payment-details` | Redirect → `/me/pay?tab=payment-details` | — | — | — |
| `/me/compensation` | Redirect → `/me/pay?tab=compensation` | — | — | — |
| `/me/documents` | MyDocumentsClient | All | LIVE | Sidebar "Documents" |
| `/me/onboarding` | MyOnboardingClient | All | LIVE | Dashboard link |
| `/documents` | DocumentsClient | All | LIVE | Sidebar "Documents" |
| `/expenses` | ExpensesClient | All | LIVE | Sidebar "Expenses" |
| `/expenses/approvals` | Redirect → `/approvals?tab=expenses` | — | — | — |
| `/expenses/reports` | ExpenseReportsClient | MGR+ | LIVE | Link from /expenses |
| `/learning` | LearningClient | All | UNAVAILABLE | Sidebar (hidden) |
| `/learning/courses/[id]` | LearningCourseClient | All | UNAVAILABLE | Link from /learning |
| `/learning/certificates` | Redirect → `/learning?tab=certificates` | — | — | — |
| `/approvals` | ApprovalsClient | MGR+ | LIVE | Sidebar "Approvals" |
| `/people` | PeopleClient | MGR+ | LIVE | Sidebar "Crew Members" |
| `/people/[id]` | PeopleProfileClient | MGR+ / Self | LIVE | Link from /people |
| `/scheduling` | SchedulingClient | CS dept / SUPER_ADMIN | LIMITED_PILOT | Sidebar "Scheduling" |
| `/scheduling/manage` | Redirect → `/scheduling?tab=manage` | — | — | — |
| `/scheduling/open-shifts` | Redirect → `/scheduling?tab=open-shifts` | — | — | — |
| `/scheduling/swaps` | Redirect → `/scheduling?tab=swaps` | — | — | — |
| `/onboarding` | OnboardingClient | MGR+ | LIVE | Sidebar "Onboarding" |
| `/onboarding/[id]` | OnboardingInstanceClient | MGR+ | LIVE | Link from /onboarding |
| `/team-hub` | TeamHubClient | All | LIMITED_PILOT | Sidebar "Team hub" |
| `/team-hub/[hubId]` | HubHomeClient | All | LIMITED_PILOT | Link from /team-hub |
| `/team-hub/[hubId]/[sectionId]` | SectionClient | All | LIMITED_PILOT | Link from hub |
| `/team-hub/[hubId]/[sectionId]/[pageId]` | PageViewClient | All | LIMITED_PILOT | Link from section |
| `/payroll` | PayrollDashboardClient | FIN/HR/SUPER | LIMITED_PILOT | Sidebar "Payroll" |
| `/payroll/runs/new` | PayrollRunCreateClient | FIN/SUPER | LIMITED_PILOT | Button from /payroll |
| `/payroll/runs/[id]` | PayrollRunDetailClient | FIN/SUPER | LIMITED_PILOT | Link from /payroll |
| `/payroll/settings/deductions` | SettingsClient | FIN/HR/SUPER | LIMITED_PILOT | Link from /payroll |
| `/admin/compensation` | AdminCompensationClient | FIN/HR/SUPER | LIVE | Sidebar "Compensation" |
| `/admin/compensation-bands` | CompensationBandsClient | FIN/HR/SUPER | LIVE | Link from compensation |
| `/performance` | PerformanceClient | All | LIMITED_PILOT | Sidebar "Performance" |
| `/performance/admin` | PerformanceAdminClient | HR/SUPER | LIMITED_PILOT | Link from /performance |
| `/compliance` | ComplianceClient | All | LIVE | Sidebar "Compliance" |
| `/analytics` | AnalyticsClient | HR/FIN/SUPER | ADMIN_ONLY | Sidebar "Analytics" |
| `/signatures` | SignaturesClient | All | UNAVAILABLE | Sidebar "Signatures" |
| `/time-attendance` | TimeAttendanceClient | All | LIVE | Sidebar (via quick actions) |
| `/time-attendance/approvals` | Redirect → `/approvals?tab=timesheets` | — | — | — |
| `/surveys` | Redirect → `/learning?tab=surveys` | — | UNAVAILABLE | — |
| `/surveys/[id]` | SurveyDetailClient | All | UNAVAILABLE | Link from /surveys |
| `/admin/surveys` | AdminSurveysClient | HR/SUPER | UNAVAILABLE | Link from admin |
| `/admin/surveys/new` | NewSurveyPage | HR/SUPER | UNAVAILABLE | Link from admin |
| `/admin/surveys/[id]/results` | SurveyResultsClient | HR/SUPER | UNAVAILABLE | Link from admin |
| `/admin/learning` | LearningAdminClient | HR/SUPER | UNAVAILABLE | Link from /learning |
| `/admin/learning/courses/new` | NewLearningCoursePage | HR/SUPER | UNAVAILABLE | Link from admin |
| `/admin/learning/reports` | LearningReportsClient | HR/SUPER | UNAVAILABLE | Link from admin |
| `/admin/access-control` | AccessControlClient | SUPER | LIVE | Sidebar "Roles & access" |
| `/admin/users` | Redirect → `/people` | — | — | — |
| `/admin/payment-details` | Redirect → `/me/pay` | — | — | — |
| `/admin/time-policies` | Redirect → `/settings?tab=time-policies` | — | — | — |
| `/admin/scheduling/templates` | SchedulingTemplatesClient | SUPER | LIMITED_PILOT | Link from scheduling |
| `/settings` | SettingsClient | All | LIVE | Sidebar bottom |
| `/notifications` | NotificationsClient | All | LIVE | TopBar bell link |
| `/support` | SupportPage | All | LIVE | Sidebar bottom |

#### Redirect Routes (20+)
The application uses ~20 redirect pages to map old/convenience URLs to canonical tab-based pages. These are clean and well-implemented.

---

### 1.2 Data Entity Map

| Entity | DB Table | Displayed | Created | Edited | Deleted | Related To |
|--------|----------|-----------|---------|--------|---------|------------|
| Profile | `profiles` | /people, /people/[id], dashboard, payroll | /people (invite form) | /people/[id] (slide panel) | — (offboarding only) | Compensation, leaves, expenses, shifts |
| CompensationRecord | `compensation_records` | /admin/compensation, /me/pay | /admin/compensation (panel) | /admin/compensation (panel) | /admin/compensation | Profile |
| Allowance | `allowances` | /admin/compensation | /admin/compensation | /admin/compensation | /admin/compensation | Profile |
| EquityGrant | `equity_grants` | /admin/compensation | /admin/compensation | /admin/compensation | /admin/compensation | Profile |
| CompensationBand | `compensation_bands` | /admin/compensation-bands | /admin/compensation-bands | /admin/compensation-bands | /admin/compensation-bands | BenchmarkData, Assignments |
| PayrollRun | `payroll_runs` | /payroll, /payroll/runs/[id] | /payroll/runs/new | /payroll/runs/[id] | — (cancel only) | PayrollItems, Profiles |
| PayrollItem | `payroll_items` | /payroll/runs/[id] | Auto-generated by calculate | Adjustments via panel | — | PayrollRun, Profile |
| PaymentBatch | `payment_batches` | /payroll/runs/[id] | Auto from payroll approval | — | — | PayrollRun |
| PaymentDetail | `payment_details` | /me/pay, /admin/payment-details | /me/pay (form) | /me/pay (form) | — | Profile |
| Payslip | `payment_statements` | /me/payslips | Auto from payslip generation | — | — | PayrollItem |
| LeaveRequest | `leave_requests` | /time-off, /approvals, dashboard | /time-off (panel) | — | Cancel only | Profile, LeaveBalance |
| LeaveBalance | `leave_balances` | /time-off | System-managed | — | — | Profile, LeavePolicy |
| LeavePolicy | `leave_policies` | /settings?tab=time-policies | /settings (form) | /settings (form) | — | Country |
| Expense | `expenses` | /expenses, /approvals, dashboard | /expenses (panel) | /expenses (panel) | — | Profile |
| Document | `documents` | /documents, /me/documents | Upload panel | — | — | Profile, Signatures |
| Announcement | `announcements` | /announcements, dashboard, notification center | /announcements (panel) | /announcements (panel) | /announcements (SUPER only) | Reads, Dismissals |
| SignatureRequest | `signature_requests` | /signatures | /signatures or /documents (panel) | — | — | Document, Signers |
| Schedule | `schedules` | /scheduling?tab=manage | /scheduling/manage (form) | /scheduling/manage | — | Shifts, Department |
| Shift | `shifts` | /scheduling | Auto or manual via manage | /scheduling/manage | — | Schedule, Template, Profile |
| ShiftSwap | `shift_swaps` | /scheduling?tab=swaps | /scheduling (form) | — | — | Shift, Profile |
| TimeEntry | `time_entries` | /time-attendance | /time-attendance (clock) | — | — | Profile, Timesheet |
| Timesheet | `timesheets` | /time-attendance, /approvals | Auto-generated | — | — | TimeEntry, Profile |
| ReviewCycle | `review_cycles` | /performance/admin | /performance/admin (form) | /performance/admin | — | Assignments, Templates |
| ReviewAssignment | `review_assignments` | /performance, /performance/admin | Bulk assign in admin | — | — | Cycle, Profile, Template |
| Goal | `performance_goals` | /performance | /performance (panel) | /performance (panel) | — | Profile, Cycle |
| LearningCourse | `learning_courses` | /learning, /admin/learning | /admin/learning/courses/new | — | — | Assignments |
| LearningAssignment | `learning_assignments` | /learning | /admin/learning (bulk) | Progress updates | — | Course, Profile |
| Survey | `surveys` | /surveys, /admin/surveys | /admin/surveys/new | — | — | Responses |
| SurveyResponse | `survey_responses` | /admin/surveys/[id]/results | /surveys/[id] (form) | — | — | Survey, Profile |
| OnboardingTemplate | `onboarding_templates` | /onboarding (Templates tab) | /onboarding (panel) | — | — | Tasks |
| OnboardingInstance | `onboarding_instances` | /onboarding, /me/onboarding | /onboarding (panel) | — | — | Template, Profile, Tasks |
| ComplianceDeadline | `compliance_deadlines` | /compliance | Auto-generated or manual | /compliance (panel) | — | Profile, Document |
| TravelSupportRequest | `travel_support_requests` | /me/documents (Travel tab) | /me/documents (panel) | — | — | Profile, LetterheadEntity |
| TeamHub | `team_hubs` | /team-hub | — | — | — | Sections |
| TeamHubSection | `team_hub_sections` | /team-hub/[hubId] | — | — | — | Hub, Pages |
| TeamHubPage | `team_hub_pages` | /team-hub/.../[pageId] | — | Edit for doc/runbook | — | Section |
| Notification | `notifications` | /notifications, notification center | System-generated | Mark read | Delete (SUPER) | Profile |

---

### 1.3 Shared Component Usage

#### Core Shared Components
| Component | Location | Used By (count) |
|-----------|----------|-----------------|
| `StatusBadge` | components/shared/status-badge.tsx | 30+ client components |
| `EmptyState` | components/shared/empty-state.tsx | 25+ client components |
| `ErrorState` | components/shared/error-state.tsx | 20+ client components |
| `SlidePanel` | components/shared/slide-panel.tsx | 15+ client components |
| `ConfirmDialog` | components/shared/confirm-dialog.tsx | 12 client components |
| `PageHeader` | components/shared/page-header.tsx | All page-level components |
| `PageTabs` | components/shared/page-tabs.tsx | 10+ tabbed pages |
| `FeatureBanner` | components/shared/feature-banner.tsx | Pilot/unavailable modules |
| `CurrencyDisplay` | components/ui/currency-display.tsx | Payroll, expenses, compensation, analytics |
| `MoneyInput` | components/ui/money-input.tsx | Expense form, compensation form |
| `MetricCard` | components/shared/metric-card.tsx | Dashboard, analytics, admin pages |

#### Duplicate Pattern Implementations
| Pattern | Canonical | Ad-hoc Versions |
|---------|-----------|-----------------|
| Confirmation modal | `ConfirmDialog` | Custom `modal-overlay` div in people-overview-client.tsx (offboarding), payroll-run-detail-client.tsx (rejection), time-attendance/approvals-client.tsx |
| Toast notifications | None (no shared component) | Each client component implements its own toast region with identical logic |
| Skeleton loading | None (no shared component) | Every client component defines its own `*Skeleton()` function |
| Table | None (no shared DataTable) | Every module builds `<table>` from scratch with similar but different patterns |

---

### 1.4 Navigation & Entry Points

#### Sidebar Groups (6)
1. **Home** (ungrouped): Dashboard, Notifications — All roles
2. **My work**: Time off, My pay, Documents, Expenses, Learning — All roles
3. **Team**: Approvals, Crew Members, Scheduling, Onboarding, Team hub — MGR+
4. **Finance**: Payroll, Compensation — FIN/HR/SUPER
5. **Operations**: Performance, Compliance, Analytics, Signatures — HR/SUPER
6. **Admin**: Roles & access, Audit log — SUPER only

#### Command Palette (Cmd+K)
- Searches: Routes (fuzzy), People, Documents, Policies, Expenses, Time Off
- Shows recently visited routes (last 6)
- Triggers at 2+ characters for entity search

#### Keyboard Shortcuts
- Navigation chords: G+H (Home), G+A (Approvals), G+P (People), G+S (Scheduling), G+T (Team hub)
- Actions: N (new action), ? (help modal), Cmd+K (palette)

#### Island Pages (no inbound links from functional pages)
- `/admin/scheduling/templates` — No sidebar link, reachable only via direct URL
- `/admin/payment-details` — Redirect to /me/pay, but original route not linked
- `/admin/time-policies` — Redirect to /settings, but original route not linked

---

### 1.5 State Handling Inventory

#### Consistent Patterns
| State | Pattern | Coverage |
|-------|---------|----------|
| Loading | Per-component `*Skeleton()` function | All pages |
| Empty | `EmptyState` component with icon, title, description, CTA | All pages |
| Error | `ErrorState` component with sanitized message + retry | All pages |
| Toasts | Per-component toast array with auto-dismiss (3-4s) | All mutation pages |

#### Feature State System
Well-designed centralized system in `lib/feature-state.ts` with 8 states (LIVE, LIMITED_PILOT, UNAVAILABLE, COMING_SOON, SIMULATION, ADMIN_ONLY, SETUP_REQUIRED, BLOCKED) that controls navigation visibility, action enablement, and page banners. Current module states:
- LIVE (13): dashboard, time_off, my_pay, documents, approvals, people, onboarding, expenses, compliance, time_attendance, notifications, announcements, compensation
- LIMITED_PILOT (4): scheduling, payroll, team_hub, performance
- UNAVAILABLE (4): learning, signatures, surveys, payroll_disbursement
- COMING_SOON (4): payroll_withholding_gh/ke/za/ca
- ADMIN_ONLY (1): analytics
- SETUP_REQUIRED (1): scheduling_auto_generate

#### Pagination
Only the audit log viewer (`/settings?tab=audit`) has pagination. All other tables render all data at once.

---

## Section 2: Findings

### A. DUPLICATION AND REDUNDANCY

**A-01 | No shared toast component — identical toast logic duplicated across 15+ modules**
- **Location:** Every `*-client.tsx` file that performs mutations (time-off-client, expenses-client, people-client, payroll-run-detail-client, announcements-client, documents-client, signatures-client, onboarding-client, performance-client, admin-compensation-client, compensation-bands-client, my-documents-client, etc.)
- **What exists:** Each component independently defines: a `ToastMessage` type (`{id, variant, message}`), a `toasts` state array, a `showToast()` function, a `dismissToast()` function, a `<section className="toast-region" aria-live="polite">` render block, and a `setTimeout` auto-dismiss (3-4 seconds varying by file).
- **The problem:** This is ~30 lines of identical boilerplate in every component. A `useToast()` hook and `<ToastProvider>` would eliminate this entirely. The auto-dismiss timeout also varies (3s in some files, 4s in others, 5s implied in onboarding), creating inconsistent UX.
- **Severity:** MAJOR

**A-02 | No shared skeleton component — every page builds its own loading skeleton**
- **Location:** `dashboard-skeleton.tsx`, plus inline `*Skeleton()` functions in every client component (time-off-client, expenses-client, people-client, payroll-dashboard-client, scheduling-client, learning-client, etc.)
- **What exists:** Each component defines a local function like `timeOffSkeleton()`, `expensesSkeleton()`, `documentsSkeleton()` etc. with nearly identical structure: metric card skeletons + table row skeletons using the same CSS classes (`skeleton-box`, `skeleton-line`).
- **The problem:** Duplicated structural code that's hard to maintain. Changes to skeleton styling require editing 20+ files. A shared `<TableSkeleton rows={6} />` and `<MetricCardSkeleton count={4} />` would handle most cases.
- **Severity:** MINOR

**A-03 | No shared DataTable component — every module builds tables from raw HTML**
- **Location:** All list views across people-client, payroll-dashboard-client, payroll-run-detail-client, time-off-client, expenses-client, documents-client, scheduling-client, learning-client, performance-client, onboarding-client, etc.
- **What exists:** Each module creates its own `<table>` with `<thead>` and `<tbody>`, implements its own sort state and toggle function, its own column definitions, and its own row action patterns. They share CSS class conventions (`data-table`, `data-table-row`, `table-sort-trigger`, `table-action-column`) but the JS logic is fully duplicated.
- **The problem:** Sort behavior, column alignment, empty row handling, and action patterns are reimplemented 15+ times. A shared `<DataTable columns={[]} data={[]} />` component would dramatically reduce code and ensure consistency. Currently sort direction toggles differ in implementation across modules.
- **Severity:** MAJOR

**A-04 | Custom modal-overlay divs used alongside ConfirmDialog**
- **Location:** `app/(shell)/people/[id]/people-overview-client.tsx` (offboarding modal), `app/(shell)/payroll/runs/[id]/payroll-run-detail-client.tsx` (rejection modal), `app/(shell)/time-attendance/approvals/approvals-client.tsx`
- **What exists:** `ConfirmDialog` is the canonical confirmation component (used in 12+ places), but 3 components build their own `<div className="modal-overlay">` modals with custom backdrop, custom buttons, and custom keyboard handling.
- **The problem:** The custom modals lack the accessibility features of ConfirmDialog (escape key handling, focus trapping, aria attributes). The offboarding modal in people-overview specifically should use ConfirmDialog with tone="danger" since offboarding is a destructive action. Two components for the same pattern creates confusion about which to use.
- **Severity:** MAJOR

**A-05 | Documents accessible from two separate sidebar entries**
- **Location:** Sidebar "Documents" → `/documents` (shared documents view) AND sidebar "Documents" under "My work" also maps to `/documents`. Additionally `/me/documents` exists as a separate personal documents page.
- **What exists:** `/documents` shows all documents with admin controls. `/me/documents` shows personal documents + travel letters. Both are accessible via sidebar. The sidebar "Documents" item under "My work" links to `/documents` (the admin/shared view), not `/me/documents`.
- **The problem:** An employee clicking "Documents" in "My work" sees the org-wide document view, not their personal documents. The `/me/documents` page (which includes personal travel letters, ID docs, tax forms) is only reachable via direct URL or dashboard quick actions. The mental model is confusing: "My work > Documents" should show MY documents.
- **Severity:** MAJOR

**A-06 | `monthToDateRange` duplicated between time-off and expenses libs**
- **Location:** `lib/time-off.ts` defines `monthToDateRange()`, `lib/expenses.ts` (and related API routes) uses `monthDateRange()` — same logic, different function names.
- **What exists:** Both functions take a YYYY-MM string and return `{startDate, endDate}` ISO date strings. The implementations are functionally identical.
- **The problem:** Two functions doing the same thing in two places. Should be consolidated into `lib/datetime.ts` (which already exists and provides canonical date formatting).
- **Severity:** MINOR

---

### B. DISJOINTED AND BROKEN FLOWS

**B-01 | Expense reports hardcode NGN currency — breaks for non-Nigerian employees**
- **Location:** `app/(shell)/expenses/reports/reports-client.tsx`, `app/(shell)/analytics/analytics-client.tsx`, `app/(shell)/payroll/settings/deductions/settings-client.tsx`
- **What exists:** The expense reports page passes `currency="NGN"` to every `<CurrencyDisplay>` component. The analytics page does the same. The payroll deductions settings page similarly hardcodes NGN. Meanwhile, the expense submission form correctly lets users select any supported currency (NGN, USD, GHS, KES, ZAR, CAD).
- **The problem:** A Ghanaian employee submitting an expense in GHS will see it displayed as NGN in the reports view. A Canadian contractor's expenses will also show as NGN. The system supports multi-currency in data entry but flattens everything to NGN in reporting. For a company with employees across 5 countries, this is fundamentally broken.
- **Severity:** CRITICAL

**B-02 | Decision card silently swallows errors — no feedback when approve/decline fails**
- **Location:** `components/dashboard/decision-card.tsx`
- **What exists:** When a user clicks Approve or Decline on a dashboard decision card, if the API call fails, the card silently resets to its `idle` state. There is no error toast, no error message, no indication that anything went wrong. The catch block simply calls `setStatus("idle")`.
- **The problem:** A manager clicking "Approve" on a leave request that fails (network error, permission issue, stale data) will see the button re-enable with no explanation. They may think the action succeeded and move on, leaving the request unapproved. This is particularly bad because the dashboard is the primary place managers act on approvals.
- **Severity:** CRITICAL

**B-03 | Payroll approval timestamps use raw `.toLocaleString()` instead of canonical formatters**
- **Location:** `app/(shell)/payroll/runs/[id]/payroll-run-detail-client.tsx` lines 655, 677
- **What exists:** Payroll approval timestamps display `new Date(runQuery.data.run.firstApprovedAt).toLocaleString()` and `new Date(runQuery.data.run.finalApprovedAt).toLocaleString()`. Every other timestamp in the application uses the canonical `formatDateTimeTooltip()` or `formatRelative()` from `lib/datetime.ts`.
- **The problem:** These timestamps will render differently depending on the user's browser locale, while all other timestamps in the app render consistently via the shared formatter. In a multi-timezone team, this creates confusion about when approvals actually happened.
- **Severity:** MINOR

**B-04 | MoneyInput component doesn't use `getCurrencySymbol()` from format-currency.ts**
- **Location:** `components/ui/money-input.tsx` vs `lib/format-currency.ts`
- **What exists:** `format-currency.ts` defines `getCurrencySymbol()` with correct symbols for 8 currencies (₦, $, GH₵, KSh, R, CA$, £, €). `money-input.tsx` hardcodes its own symbol map with only 6 currencies, and uses plain text codes ("NGN", "GHS", "KES", "ZAR") instead of proper symbols.
- **The problem:** The expense submission form shows "NGN 5000" instead of "₦5,000" as the input prefix. Ghana shows "GHS" instead of "GH₵". The display component (`CurrencyDisplay`) correctly shows "₦5,000" but the input shows different symbols. This inconsistency is confusing.
- **Severity:** MAJOR

**B-05 | Notification center (dropdown) and Notifications page (/notifications) have divergent behavior**
- **Location:** `components/shared/notification-center.tsx` vs `app/(shell)/notifications/notifications-client.tsx`
- **What exists:** The notification center dropdown combines announcements + notifications into a unified feed, limits to 8 items, polls every 60s, and auto-dismisses. The notifications page shows only notifications (not announcements), loads 200 items, has sort controls, and auto-marks all as read on mount.
- **The problem:** Clicking the bell icon shows announcements mixed with notifications. Clicking "View all" navigates to `/notifications` which shows only notifications — the announcements disappear. A user seeing an important announcement in the dropdown may click "View all" and not find it because it's on `/announcements` instead. The data model separation (announcements vs notifications) is invisible to users in the dropdown but enforced on the full pages.
- **Severity:** MAJOR

**B-06 | Surveys redirect to Learning tab — conceptual mismatch**
- **Location:** `app/(shell)/surveys/page.tsx` redirects to `/learning?tab=surveys`
- **What exists:** The `/surveys` route redirects to `/learning?tab=surveys`. Surveys (engagement, pulse, exit, custom) are conceptually distinct from learning (courses, certificates). They're grouped together because both are under "employee development" but the user model doesn't match — a pulse survey about workplace satisfaction has nothing to do with a compliance training course.
- **The problem:** An employee told "fill out the engagement survey" who navigates to `/surveys` gets redirected to the Learning page. The Learning module is currently UNAVAILABLE (hidden from nav), so the redirect leads to a page they may not have access to see. Even if Learning were LIVE, the cognitive overhead of "surveys are inside learning" is unnecessary friction.
- **Severity:** MAJOR

**B-07 | Team Hub has no content management — hubs exist but cannot be created or edited from UI**
- **Location:** `app/(shell)/team-hub/team-hub-client.tsx`, `app/(shell)/team-hub/[hubId]/hub-home-client.tsx`
- **What exists:** Team Hub pages can display hubs, sections, and pages. The feature banner states "Content management features are coming soon." Hub and section CRUD APIs exist (`POST/PUT /api/v1/team-hubs`), but the UI has no create/edit buttons for hubs or sections. Only page content (document/runbook type) can be edited via a slide panel.
- **The problem:** Team Hubs are meant to replace Notion as department knowledge bases, but there's no way to create hubs, add sections, or add pages from the UI. Data must be seeded via API or database. This makes the feature essentially read-only for any content that isn't already seeded, which defeats the purpose of a knowledge base.
- **Severity:** CRITICAL (for the Team Hub module specifically — it's a LIMITED_PILOT feature that can't fulfill its core purpose)

---

### C. ORPHANED AND DEAD ELEMENTS

**C-01 | Feature state system properly handles Coming Soon/Unavailable modules**
- **Location:** `lib/feature-state.ts`, `components/shared/feature-banner.tsx`, `components/shared/feature-badge.tsx`
- **What exists:** The feature state system is well-designed: UNAVAILABLE modules are hidden from nav (`hideFromNav: true`), their actions are disabled (`actionsDisabled: true`), and pages show clear banners explaining the state. COMING_SOON modules show in nav with badges but disable actions.
- **The problem:** No problem — this is done correctly. Noting it here because the audit instructions ask about placeholder handling. The system does NOT have the common anti-pattern of perpetual "Coming Soon" with no context. Each state has clear metadata.
- **Severity:** N/A (positive finding)

**C-02 | `/admin/scheduling/templates` is unreachable from any navigation**
- **Location:** `app/(shell)/admin/scheduling/templates/page.tsx`
- **What exists:** A fully functional scheduling templates management page exists at `/admin/scheduling/templates`. It has CRUD for shift templates (name, department, start/end time, break, color). However, there is no sidebar link, no button on `/scheduling`, and no link from `/scheduling?tab=manage` pointing to it.
- **The problem:** Scheduling managers need to create shift templates before they can build schedules, but the template management page is only accessible via direct URL. This is a critical prerequisite page that's completely hidden.
- **Severity:** CRITICAL (for scheduling module — templates are a prerequisite for schedule creation)

**C-03 | Keyboard shortcut chord G+T maps to Team Hub but G+A maps to Approvals, not Announcements**
- **Location:** `hooks/use-keyboard-shortcuts.ts`, sidebar navigation config
- **What exists:** The sidebar shows "Notifications" (which maps to `/announcements`) with shortcut "G A". But the keyboard shortcuts also show "G A" for Approvals in the help modal. The actual chord sequence G→A navigates to `/approvals`, not `/announcements`.
- **The problem:** The sidebar displays "G A" next to the Notifications/Announcements item, but pressing G then A goes to Approvals. The displayed shortcut is wrong — it should show the correct shortcut or the conflict should be resolved.
- **Severity:** MINOR

**C-04 | `who-is-online` component exists but has no integration with scheduling or time-off**
- **Location:** `components/shared/who-is-online.tsx`
- **What exists:** The sidebar shows an expandable "Who's online" panel with presence dots (online/away/offline) and availability status (AFK, OOO). This is fetched from a presence endpoint.
- **The problem:** When a manager looks at the scheduling page to manage shifts, there's no visibility into who is currently AFK or OOO. When viewing the people directory, there's no presence indicator. The presence data exists in the sidebar but is siloed — it doesn't inform the pages where it would be most useful (scheduling, team views, approval contexts).
- **Severity:** MAJOR

---

### D. INCONSISTENCY ACROSS MODULES

**D-01 | Inconsistent confirmation patterns for destructive actions**
- **Location:** Across all modules
- **What exists:**
  - Announcement delete: `ConfirmDialog` with tone="danger" ✓
  - Leave request cancel: `useConfirmAction()` hook (which wraps ConfirmDialog) ✓
  - Employee offboarding: Custom `<div className="modal-overlay">` modal (NOT ConfirmDialog)
  - Payroll run rejection: Custom modal overlay (NOT ConfirmDialog)
  - Expense approval/rejection: Inline form (no confirmation dialog at all)
  - Compensation record delete: `useConfirmAction()` ✓
  - Notification delete: `ConfirmDialog` ✓
- **The problem:** Three different patterns for confirming destructive actions: (1) ConfirmDialog (canonical), (2) useConfirmAction hook (convenience wrapper), (3) custom modal divs. Two destructive operations have NO confirmation at all. Users experience inconsistent friction for actions of similar severity.
- **Severity:** MAJOR

**D-02 | Table sorting implemented differently across modules**
- **Location:** All table views
- **What exists:** Sort implementations vary:
  - People: No visible sort controls in list view
  - Payroll runs: Sort by period with ↑/↓ arrow indicator, `toggleSort()` function
  - Time-off requests: Sort by start date with button toggle
  - Expenses: Sort by column with direction state
  - Learning assignments: Sort by due date
  - Performance admin: Multi-column sort with `toggleSort()` mechanism
  - Compliance: No visible sort
  - Onboarding: Sort by employee name or started date
- **The problem:** Sort triggers look different (button vs header click), sort indicators vary (↑/↓ vs arrow icons), and sort capabilities differ (some tables are sortable, some aren't, with no apparent logic to which). A shared sort hook and consistent column header pattern would unify this.
- **Severity:** MINOR

**D-03 | Status badge tone mapping inconsistencies across modules**
- **Location:** All modules using StatusBadge
- **What exists:** The StatusBadge supports 7 tones (success, warning, error, info, pending, draft, processing). Different modules map similar concepts to different tones:
  - "Approved": success in time-off, info in expenses
  - "Pending": pending in time-off, pending in expenses (consistent)
  - "Manager approved" (expense awaiting finance): warning tone — which typically signals "something wrong" rather than "in progress"
  - "Active" (schedule/shift): info in scheduling, processing in onboarding
  - Cancelled: warning in some places, error in others
- **The problem:** "Warning" is used for both "cancelled" (time-off) and "awaiting next step" (expenses manager_approved). The tones should carry consistent semantic meaning: warning = needs attention, success = complete, pending = waiting, processing = in progress, error = failed/rejected.
- **Severity:** MINOR

**D-04 | CurrencyDisplay expects minor units (cents) but MoneyInput accepts major units (dollars)**
- **Location:** `components/ui/currency-display.tsx` vs `components/ui/money-input.tsx`
- **What exists:** `CurrencyDisplay` takes an `amount` prop that's expected in minor units (e.g., 10000 for $100.00) and divides by `10^decimals`. `MoneyInput` accepts user input in major units (e.g., "100.00"). Database fields store amounts as `bigint` (minor units).
- **The problem:** Any developer connecting these components must remember the unit conversion. Forms that display a `CurrencyDisplay` of the current value alongside a `MoneyInput` for editing require manual conversion. This is a foot-gun for future development.
- **Severity:** MINOR

**D-05 | Detail views use different patterns: slide panels vs full pages**
- **Location:** Across modules
- **What exists:**
  - Employee profile: Full page (`/people/[id]`)
  - Payroll run detail: Full page (`/payroll/runs/[id]`)
  - Onboarding instance: Full page (`/onboarding/[id]`)
  - Team hub page: Full page (`/team-hub/[hubId]/[sectionId]/[pageId]`)
  - Expense detail: Slide panel (from /expenses list)
  - Leave request detail: Inline in table (expandable row)
  - Signature request detail: Slide panel (from /signatures list)
  - Document detail: Slide panel (from /documents list)
  - Compliance deadline detail: Slide panel (from /compliance)
  - Announcement detail: Inline card (from /announcements)
- **The problem:** No consistent mental model for "how do I see details." Some entities open full pages (require navigation), others open slide panels (stay in context), others expand inline. The pattern seems arbitrary rather than intentional (e.g., expenses and leave requests are both "requests to approve" but use different detail patterns).
- **Severity:** MINOR

---

### E. NAVIGATION AND INFORMATION ARCHITECTURE

**E-01 | Announcements labeled as "Notifications" in sidebar — confusion with actual notifications**
- **Location:** Sidebar nav config in `lib/navigation.ts`, notification center in `components/shared/notification-center.tsx`
- **What exists:** The sidebar item labeled "Notifications" with a Bell icon links to `/announcements`. The topbar has a separate bell icon for the notification center dropdown. The notification center dropdown merges announcements + notifications. The `/notifications` page (full page) shows only notifications.
- **The problem:** Two bell icons (sidebar + topbar), three different views (sidebar → announcements page, topbar dropdown → merged feed, "View all" → notifications page), and the sidebar label "Notifications" actually goes to Announcements. A user cannot form a clear mental model of where their notifications live vs where company announcements live.
- **Severity:** MAJOR

**E-02 | Documents, Team Hubs, and Announcements overlap conceptually**
- **Location:** `/documents`, `/team-hub`, `/announcements`
- **What exists:** Three separate modules handle "company information":
  - Documents: Policy documents, compliance docs, employee personal docs
  - Team Hubs: Department knowledge bases with pages (documents, runbooks, contact lists)
  - Announcements: Company-wide communications
  - A policy document could logically live in Documents OR in a Team Hub section OR be referenced in an Announcement
- **The problem:** When someone asks "where's the PTO policy?", the answer could be: (1) Documents page as a policy document, (2) HR Team Hub as a page, or (3) referenced in an Announcement. There's no cross-linking between these systems. A document uploaded to Documents isn't discoverable from Team Hub. A policy announced in Announcements doesn't link to its Document entry. These three modules are information islands.
- **Severity:** MAJOR

**E-03 | AFK/Availability status not surfaced where managers need it**
- **Location:** Who-is-online sidebar widget, `/people`, `/scheduling`, `/approvals`
- **What exists:** The sidebar shows who is online/away/offline. Employees can set AFK status via the topbar user menu. The time-off module tracks approved leaves. But:
  - The `/people` directory does not show current availability status
  - The `/scheduling` page does not show who is currently AFK when assigning shifts
  - The `/approvals` page does not show if a requester is currently available
  - The `/time-off` page shows a team availability panel but it's separate from the AFK/presence system
- **The problem:** A manager approving a shift swap can't see at a glance whether the swap target is currently AFK. A scheduler building next week's schedule can't see who has approved time off during that period from the scheduling UI. Availability data exists in multiple systems (presence/AFK, time-off, scheduling) but is not integrated.
- **Severity:** MAJOR

**E-04 | Time Attendance not in sidebar — only reachable via dashboard quick actions**
- **Location:** Sidebar navigation in `lib/navigation.ts`, dashboard quick actions
- **What exists:** Time Attendance (`/time-attendance`) is a LIVE module with clock-in/out functionality and timesheet tracking. However, it has no sidebar entry. It's reachable via: (1) Dashboard "Quick Actions" row, (2) Approvals tab "Timesheets", (3) direct URL. The feature state system marks it as LIVE.
- **The problem:** An employee who needs to clock in every day must either bookmark the URL or navigate to the Dashboard first and click the quick action. There's no persistent navigation entry for a feature they use multiple times daily.
- **Severity:** MAJOR

**E-05 | Settings page bundles unrelated concerns into one page**
- **Location:** `app/(shell)/settings/settings-client.tsx`
- **What exists:** The Settings page has 5 tabs: Profile, Preferences (notification toggles), Security (MFA), Organization (SUPER only), and Audit Log (HR/SUPER only). The sidebar also has a separate "Audit log" item under Admin that links to `/settings?tab=audit`.
- **The problem:** Personal profile settings, notification preferences, MFA status, org-level configuration, and audit log viewing are conceptually different concerns. The audit log especially is an admin tool, not a "setting." Navigating from the Admin sidebar group to land on the Settings page creates cognitive dissonance. The audit log would be better as a standalone admin page.
- **Severity:** MINOR

---

### F. MISSING STATES AND EDGE CASES

**F-01 | No pagination on any data table (except audit log) — will break at scale**
- **Location:** All table views: people-client, expenses-client, time-off-client, payroll-dashboard-client, documents-client, scheduling-client, learning-client, onboarding-client, compliance-client, signatures-client, etc.
- **What exists:** Every table fetches all records and renders them. The people list fetches with `?scope=all`, expenses fetches all, documents fetches `?limit=250`. Only the audit log viewer has proper pagination.
- **The problem:** With 15 employees today, this works. At 50+ employees, the people directory, expense list (accumulating monthly), payroll runs, document library, and notification lists will become slow. The expense reports by-employee table and analytics data will grow linearly with headcount and time. There's no client-side pagination, no infinite scroll, and most endpoints don't accept limit/offset parameters.
- **Severity:** MAJOR

**F-02 | New employee first-login experience has gaps**
- **Location:** `/mfa-setup`, `/dashboard`, `/me/onboarding`
- **What exists:** A new employee's first experience is: (1) receive invite email, (2) set up password, (3) MFA setup page, (4) redirected to Dashboard. The dashboard detects "new_hire" persona if start_date is within 30 days AND an active onboarding instance exists. If so, it shows a NewHireGreeting with manager info and onboarding progress banner linking to `/me/onboarding`.
- **The problem:** If the HR admin hasn't created an onboarding instance for the employee yet, the new hire sees the regular "employee" dashboard with no guidance. The persona logic requires BOTH recent start_date AND active onboarding instance. A new hire without an onboarding instance gets a generic dashboard on their first day — no welcome message, no setup guidance, no orientation. The system assumes HR will always create the onboarding instance before the employee's first login, which is an operational dependency with no fallback.
- **Severity:** MAJOR

**F-03 | Multi-role users see duplicate information without clear priority**
- **Location:** Dashboard persona logic in `lib/dashboard-persona.ts`, sidebar role filtering
- **What exists:** A user with both HR_ADMIN and FINANCE_ADMIN roles gets only one dashboard persona (the first matching in priority order: SUPER_ADMIN > FINANCE_ADMIN > HR_ADMIN > MANAGER > new_hire > employee). The persona determines which greeting card and widgets appear.
- **The problem:** An HR_ADMIN who is also a MANAGER only sees the HR_ADMIN dashboard — they lose the manager-specific widgets (pending approvals for their team, team onboarding). The persona system is exclusive rather than additive. A person wearing multiple hats has to choose which hat the dashboard serves, and they don't even get to choose — the system picks the "highest" role. The sidebar correctly shows all items for all roles, but the dashboard's content is narrowed.
- **Severity:** MAJOR

**F-04 | No client-side route protection — pages render if URL is visited directly**
- **Location:** All page.tsx server components with role checks
- **What exists:** Pages check roles server-side in the page.tsx component (e.g., `if (!roles.some(r => ["HR_ADMIN", "SUPER_ADMIN"].includes(r))) { notFound(); }`). The sidebar hides items the user can't access. But the check happens server-side — if the page shell renders before the role check completes or if the client component loads without re-checking roles, there could be a flash of unauthorized content.
- **The problem:** Investigation shows the server-side role checks ARE properly implemented — pages call `notFound()` or redirect for unauthorized access. This is correctly handled. However, note that the access control system in `/admin/access-control` allows SUPER_ADMIN to grant/revoke specific nav items per employee, which could create edge cases where a user has database-level access (via Supabase RLS) but UI-level revocation, or vice versa. The UI-level and DB-level access controls are independent systems.
- **Severity:** MINOR (the basic auth works; the edge case of access-config mismatch with RLS is an architectural note)

**F-05 | Department with no manager — several flows assume manager exists**
- **Location:** `app/(shell)/people/[id]/people-overview-client.tsx`, `app/(shell)/onboarding/onboarding-client.tsx`, `app/(shell)/time-off/time-off-client.tsx`
- **What exists:** The people profile shows `manager_id` as a field and the admin edit panel allows setting a manager. The time-off approval system routes to the employee's manager for approval. Onboarding shows "Manager tasks overdue" counting.
- **The problem:** If an employee has no manager assigned (`manager_id` is null), time-off requests may have no approver. The UI doesn't warn about this state. A new hire added without a manager assignment will submit leave requests that may sit in limbo. The people profile doesn't flag "no manager assigned" as a warning state.
- **Severity:** MAJOR

**F-06 | Travel support approval uses hardcoded country list**
- **Location:** `app/(shell)/me/documents/my-documents-client.tsx`
- **What exists:** The travel support approval flow uses `ENTITY_COUNTRIES` constant with hardcoded values (USA, Nigeria, Canada, Ghana, South Africa) for letterhead entity selection. The `letterhead_entities` database table exists for dynamic configuration.
- **The problem:** If Accrue operates in Kenya (which it does — KES is a supported currency, Kenya employees exist in the system), the country is not in the hardcoded approval dropdown. Adding a new country requires a code change rather than database configuration. The letterhead entities API exists but the UI doesn't fully leverage it.
- **Severity:** MINOR

**F-07 | AFK log does not validate start/end times**
- **Location:** `app/(shell)/time-off/time-off-client.tsx` (AFK logging form)
- **What exists:** The AFK logging slide panel has time inputs for start and end time. There is no validation that end time is after start time, no check that times fall within working hours, and no prevention of 00:00 → 00:00 entries.
- **The problem:** An employee could log an AFK entry with start time 17:00 and end time 09:00 (negative duration), or 00:00 to 00:00 (zero duration). The form calculates and displays duration but doesn't prevent nonsensical values.
- **Severity:** MINOR

---

## Section 3: Summary Table

| ID | Category | Description | Severity |
|----|----------|-------------|----------|
| B-01 | Flow | Expense reports and analytics hardcode NGN currency — breaks multi-currency | CRITICAL |
| B-02 | Flow | Dashboard decision card silently swallows API errors | CRITICAL |
| B-07 | Flow | Team Hub has no content management UI — read-only without API/DB seeding | CRITICAL |
| C-02 | Orphan | Scheduling templates page unreachable from any navigation | CRITICAL |
| A-01 | Duplication | Toast notification logic duplicated across 15+ modules | MAJOR |
| A-03 | Duplication | No shared DataTable component — tables reimplemented per module | MAJOR |
| A-04 | Duplication | Custom modal-overlay divs bypass ConfirmDialog accessibility | MAJOR |
| A-05 | Duplication | Documents accessible from two sidebar entries with different scope | MAJOR |
| B-04 | Flow | MoneyInput uses wrong currency symbols (text codes vs proper symbols) | MAJOR |
| B-05 | Flow | Notification center and Notifications page show different data | MAJOR |
| B-06 | Flow | Surveys redirect into Learning module — conceptual mismatch | MAJOR |
| C-04 | Orphan | Presence/AFK data siloed in sidebar — not integrated with scheduling/people | MAJOR |
| D-01 | Inconsistency | Destructive action confirmation uses 3 different patterns | MAJOR |
| E-01 | NavIA | "Notifications" sidebar item goes to Announcements — naming confusion | MAJOR |
| E-02 | NavIA | Documents, Team Hubs, and Announcements are information islands | MAJOR |
| E-03 | NavIA | AFK/availability status not shown where managers need it | MAJOR |
| E-04 | NavIA | Time Attendance (LIVE, daily-use) has no sidebar entry | MAJOR |
| F-01 | Edge Case | No pagination on any data table — will break at scale | MAJOR |
| F-02 | Edge Case | New hire without onboarding instance gets generic dashboard | MAJOR |
| F-03 | Edge Case | Multi-role users get single dashboard persona, losing role-specific widgets | MAJOR |
| F-05 | Edge Case | No warning when employee has no manager — breaks approval routing | MAJOR |
| A-02 | Duplication | Every page defines its own skeleton loading component | MINOR |
| A-06 | Duplication | monthToDateRange duplicated between time-off and expenses libs | MINOR |
| B-03 | Flow | Payroll approval timestamps use raw .toLocaleString() not shared formatter | MINOR |
| C-03 | Orphan | Keyboard shortcut G+A conflicts between Notifications and Approvals | MINOR |
| D-02 | Inconsistency | Table sorting implemented differently across modules | MINOR |
| D-03 | Inconsistency | Status badge tone mapping inconsistent for similar concepts | MINOR |
| D-04 | Inconsistency | CurrencyDisplay (minor units) vs MoneyInput (major units) mismatch | MINOR |
| D-05 | Inconsistency | Detail views mix full pages, slide panels, and inline expansion | MINOR |
| E-05 | NavIA | Settings page bundles audit log with personal preferences | MINOR |
| F-04 | Edge Case | UI-level access config and Supabase RLS are independent systems | MINOR |
| F-06 | Edge Case | Travel support approval uses hardcoded country list | MINOR |
| F-07 | Edge Case | AFK log form doesn't validate start/end time logic | MINOR |

**Totals: 4 CRITICAL, 18 MAJOR, 11 MINOR = 33 findings**
