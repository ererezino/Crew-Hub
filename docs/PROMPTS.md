# Prompt Pack (Master)

## How To Use This Prompt Pack

- Run one prompt at a time.
- Always work on a non-`main` branch.
- Prefer `Commit + Create PR` for every module.
- Each module must pass `npm run lint` and `npm run build`.
- Use seed data to verify UI behavior and edge states.
- Never implement more than the current module.

## GLOBAL UI / DESIGN NON-NEGOTIABLES

1. No page should feel empty: `EmptyState` with helpful CTA.
2. Every table must have: skeleton loading, empty state, sort on at least one column, row hover actions.
3. Numbers are always Geist Mono with `tabular-nums`.
4. Currency always via `CurrencyDisplay` (symbol + formatted).
5. Status always `StatusBadge`.
6. Country always `CountryFlag`.
7. Dates show relative time with full date tooltip and respect viewer timezone.
8. All forms have inline validation errors.
9. Mobile: employee self-serve pages must work on mobile.
10. No orphan pages: every page reachable from sidebar and Cmd+K.

## Reusable TEMPLATE PROMPT (4 blanks)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: [BRANCH_NAME]
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read: [REFERENCE_DOCS]
- Read `docs/NORTH_STAR.md` if it exists.

TASK
- Build: [WHAT_TO_BUILD]

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- [UI_SPECIFICS]

SEED DATA + VERIFICATION
- If seed data is missing, run/create baseline seed (1 org, 10 employees, multi-country, all roles) before module verification.
- Verify default, loading, empty, success, and error states using seeded records.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- [COMMIT_MESSAGE]
```

## Phase 0 (Guardrails)

### 0.1 North Star + Build Plan + CI

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-0/0.1-north-star-build-plan-ci
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` if present.
- Read `docs/BUILD_PLAN.md` if present.
- Read this `docs/PROMPTS.md`.

TASK
- Create/update `docs/NORTH_STAR.md` and `docs/BUILD_PLAN.md` as canonical references.
- Add `.github/workflows/ci.yml` with npm install/lint/build checks for PRs and pushes to `main`.
- Do not build product features in this module.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- If any docs/demo screen is added, include meaningful `EmptyState` and skeleton examples.

SEED DATA + VERIFICATION
- If baseline seed data is missing, create the seed plan backlog item and reference Prompt 0.3.
- Verify CI runs and docs are discoverable from repository root.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 0.1: north star, build plan, and CI"
```

### 0.2 Local Environment Setup Guidance

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-0/0.2-local-env-setup
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` if present.
- Read this `docs/PROMPTS.md`.

TASK
- Create/update local setup guidance and setup script notes.
- Include what setup script must do: Node version check, package install, env template copy, Supabase local/dev connection check, lint/build smoke run.
- Include required `.env` keys (names only) and where each is used.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- For setup verification page (if created), include loading skeletons and actionable `EmptyState` with CTA.

SEED DATA + VERIFICATION
- If seed data is missing, include explicit instruction to run Prompt 0.3 after environment setup.
- Verify setup script output is deterministic and documented.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 0.2: local environment setup guidance"
```

### 0.3 Seed Data Strategy (Org + 10 Employees + Multi-country + Roles)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-0/0.3-seed-data-strategy
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` if present.
- Read this `docs/PROMPTS.md`.

TASK
- Implement seed strategy and scripts for one org and at least 10 employees across multiple countries.
- Include roles: Employee, Manager, HR Admin, Super Admin.
- Seed realistic departments, statuses, compensation currencies, and request history for UI testing.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Ensure seeded values drive `StatusBadge`, `CountryFlag`, `CurrencyDisplay`, and meaningful table states.

SEED DATA + VERIFICATION
- This module creates the baseline seed requirement for all later modules.
- Verify repeatable seeding and document reset/reseed flow.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 0.3: seed data strategy"
```

## Phase 1 (Foundation)

### 1.0 Design System Foundation

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.0-design-system-foundation
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build the Design System Foundation for Accrue Hub.
- Include the following exactly:
  - CSS variables color system (bg/text/status/brand + dark mode swap)
  - Typography scale (Geist/Geist Mono)
  - Component library list (DataTable, StatusBadge, CurrencyDisplay, MetricCard, SlidePanel, PageHeader, Timeline, CountryFlag, AvatarGroup, ProgressRing, EmptyState, Toast)
  - Layout patterns and navigation patterns
  - Interaction patterns
  - /app/design-system showcase page
  - Must pass lint + build
  - Commit message: "Phase 1.0: design system foundation"

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Enforce subtle borders, light default mode with dark support, and transitions in the 150-200ms range.
- Use Geist Mono + tabular figures for numeric components.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 seed baseline before UI verification.
- Verify each design-system component in loading, empty, success, and error states.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.0: design system foundation"
```

### 1.1 App Shell + Navigation

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.1-app-shell-navigation
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.
- Reuse Phase 1.0 design-system components.

TASK
- Build app shell with authenticated layout, sidebar, top bar, and command palette entry points.
- Ensure all current pages are reachable from sidebar and Cmd+K.
- Keep routing skeleton ready for Phase 2-5 modules.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Use `PageHeader`, `EmptyState`, and consistent sidebar active states.
- Mobile navigation must support employee self-serve access.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Verify route discoverability and no orphan pages.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.1: app shell and navigation"
```

### 1.2a Supabase Wiring + Login + Middleware (Minimal)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.2a-supabase-auth-middleware
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Add minimal Supabase client/server wiring.
- Implement login/logout flow and route-protection middleware.
- Keep implementation minimal and production-safe.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Auth screens must include inline errors, loading states, and actionable empty/help states.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 before final verification.
- Validate sign-in, sign-out, protected-route redirect, and session persistence.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.2a: Supabase wiring, auth, and middleware"
```

### 1.2b Seed Data (If Not Already Done)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.2b-seed-data
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read Prompt 0.3 from `docs/PROMPTS.md`.
- Read `docs/NORTH_STAR.md`.

TASK
- If seed data is already complete from Prompt 0.3, only verify and document usage.
- If missing/incomplete, implement the baseline seed package now.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Seed data must visibly exercise `StatusBadge`, `CountryFlag`, `CurrencyDisplay`, and table sorting.

SEED DATA + VERIFICATION
- Required: one org + 10 employees across countries + role mix.
- Verify deterministic seeding and safe rerun behavior.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.2b: seed data baseline verification"
```

### 1.2c DB Migrations + RLS + /api/v1/me

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.2c-db-migrations-me-api
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (database + API conventions).
- Read this `docs/PROMPTS.md`.

TASK
- Create migrations for `orgs`, `profiles`, and `audit_log`.
- Apply RLS policies to each table.
- Implement `/api/v1/me` with Zod validation and `{ data, error, meta }` response envelope.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- If `/me` is surfaced in UI, include skeleton loading + `EmptyState` fallback.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Verify RLS behavior for authorized vs unauthorized access.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.2c: DB foundations, RLS, and /api/v1/me"
```

### 1.3 People Directory + Profile Pages

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.3-people-directory-profile
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build people directory list and profile pages.
- Include search/filter/sort basics and role-aware profile actions.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Directory uses `DataTable` with skeleton, empty state, at least one sortable column, and row hover actions.
- Profiles use `PageHeader`, status chips (`StatusBadge`), and `CountryFlag`.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Verify multiple countries, statuses, and role visibility boundaries.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.3: people directory and profiles"
```

### 1.4 Settings Foundation + Audit Log Viewer

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-1/1.4-settings-audit-log
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (audit and RBAC principles).
- Read this `docs/PROMPTS.md`.

TASK
- Create settings module foundation and an audit log viewer.
- Show actor, action, table, old/new values summary, timestamp, and IP.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Audit table uses `DataTable`, sortable timestamp, and row hover actions opening `SlidePanel` details.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Verify audit events render with realistic seeded mutations.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 1.4: settings foundation and audit log viewer"
```

## Phase 2 (Core HR)

### 2.1 Announcements (Pinned + Read Receipts)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-2/2.1-announcements
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build announcements module with pinned posts and read receipts.
- Include role-based create/edit/delete controls.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- List includes pinned indicator, read/unread state, and skeleton/empty views.
- Detail view includes timeline of read receipts.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed pinned and unpinned announcements and verify receipts by role.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 2.1: announcements with read receipts"
```

### 2.2 Documents (Storage + Expiry Badges)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-2/2.2-documents-storage-expiry
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (Supabase Storage and RLS requirements).
- Read this `docs/PROMPTS.md`.

TASK
- Build documents module backed by Storage.
- Add expiry tracking with status indicators for expiring/expired docs.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Document table uses `DataTable`, `StatusBadge`, sortable expiry date, and row hover actions.
- Empty states must include upload CTA.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed active, expiring soon, and expired documents; verify badge logic and access control.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 2.2: documents and expiry tracking"
```

### 2.3 Onboarding/Offboarding Checklists

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-2/2.3-onboarding-offboarding
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build onboarding/offboarding checklist workflows with assignees and due dates.
- Support status transitions and completion tracking.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Use checklist cards plus `DataTable` history view with `StatusBadge`.
- Dates must show relative time with full-date tooltip in viewer timezone.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed in-progress and completed checklist examples across roles.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 2.3: onboarding and offboarding checklists"
```

### 2.4 Time Off (Requests + Approvals + Balances)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-2/2.4-time-off
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build time-off requests, manager approvals, and balance tracking.
- Include request policy validation and status transitions.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Requests and approvals must use `DataTable` with `StatusBadge` and row hover actions.
- Balance summary should use `MetricCard` and mobile-friendly request flow.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed pending/approved/rejected requests and validate balances after actions.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 2.4: time off requests and approvals"
```

## Phase 3 (Finance & Built-In Payroll)

### 3.1 Compensation + Allowances CRUD (Super Admin Approval)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.1-compensation-allowances
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (money storage rules and roles).
- Read this `docs/PROMPTS.md`.

TASK
- Build compensation and allowance CRUD with Super Admin approval gates.
- Store money in smallest unit integer + currency code.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Compensation table uses `CurrencyDisplay`, `StatusBadge`, and `DataTable` interactions.
- Numeric values use Geist Mono with tabular alignment.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed multiple currencies and pending approvals.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.1: compensation and allowances CRUD"
```

### 3.2 Payment Details Encrypted + 48-Hour Hold

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.2-payment-details-encryption
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build payment details module with encryption-at-rest and secure update flow.
- Enforce 48-hour hold before sensitive payment detail changes become active.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Sensitive forms must have inline validation and masked values.
- Show hold countdown status with `StatusBadge` and clear warning copy.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed pending hold updates and verify activation after hold window.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.2: secure payment details and hold window"
```

### 3.3 Deduction Rules + Nigeria Engine

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.3-deduction-rules-nigeria
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build deduction rule engine with Nigeria payroll calculations.
- MUST INLINE Nigeria bracket values (annual taxable income):
  - 0-300,000 at 7%
  - 300,001-600,000 at 11%
  - 600,001-1,100,000 at 15%
  - 1,100,001-1,600,000 at 19%
  - 1,600,001-3,200,000 at 21%
  - Above 3,200,000 at 24%
- MUST INLINE CRA formula:
  - CRA = max(200,000, 1% of gross annual income) + 20% of gross annual income
- MUST INLINE pension/NHF rules:
  - Employee pension contribution = 8%
  - Employer pension contribution = 10%
  - NHF contribution = 2.5% of monthly basic salary

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Show deduction breakdown in `DataTable` with expandable rows and `CurrencyDisplay` everywhere.
- Highlight outliers/negative net pay with warning banners.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed Nigerian employee salary profiles to validate every tax bracket and deduction path.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.3: deduction rules and Nigeria engine"
```

### 3.4a Payroll Run CRUD + Calculation + State Machine (No Approvals Yet)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.4a-payroll-run-core
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build payroll run CRUD, calculation orchestration, and state machine transitions.
- Explicitly exclude approval workflow in this module.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- PAYROLL UI SPEC TEMPLATE:
  - Payroll run list: DataTable columns [Pay Period, Status (StatusBadge), Employees, Total Gross (CurrencyDisplay), Initiated By, Date]. Row click opens SlidePanel summary.
  - Run detail: Timeline for states, 4x MetricCard summary grouped by currency, employee DataTable with expandable deduction breakdown, flagged items warning banner, approval card with AvatarGroup.
  - Payslip viewer: PDF inline render.
  - CurrencyDisplay everywhere; Geist Mono in tables.
- For this module, render approval card as read-only placeholder (approvals ship in 3.4b).

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed draft and calculated payroll runs in at least two currencies.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.4a: payroll run core and state machine"
```

### 3.4b Double Approval + Immutable Snapshots

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.4b-payroll-approvals-snapshots
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (audit and immutable mutation rules).
- Read this `docs/PROMPTS.md`.

TASK
- Add double-approval workflow to payroll runs.
- Generate immutable payroll snapshots at approval boundaries.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- PAYROLL UI SPEC TEMPLATE:
  - Payroll run list: DataTable columns [Pay Period, Status (StatusBadge), Employees, Total Gross (CurrencyDisplay), Initiated By, Date]. Row click opens SlidePanel summary.
  - Run detail: Timeline for states, 4x MetricCard summary grouped by currency, employee DataTable with expandable deduction breakdown, flagged items warning banner, approval card with AvatarGroup.
  - Payslip viewer: PDF inline render.
  - CurrencyDisplay everywhere; Geist Mono in tables.
- Approval card must support two distinct approvers with status timeline evidence.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed first-approval and fully-approved run states; verify immutable snapshot behavior.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.4b: payroll double approval and snapshots"
```

### 3.4c Payslip PDF Generation + Employee Inline Viewer

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.4c-payslip-pdf-viewer
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Implement payslip PDF generation and employee inline viewer.
- Restrict access with role and ownership checks.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- PAYROLL UI SPEC TEMPLATE:
  - Payroll run list: DataTable columns [Pay Period, Status (StatusBadge), Employees, Total Gross (CurrencyDisplay), Initiated By, Date]. Row click opens SlidePanel summary.
  - Run detail: Timeline for states, 4x MetricCard summary grouped by currency, employee DataTable with expandable deduction breakdown, flagged items warning banner, approval card with AvatarGroup.
  - Payslip viewer: PDF inline render.
  - CurrencyDisplay everywhere; Geist Mono in tables.
- Ensure PDF render fallback state uses `EmptyState` with retry CTA.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed approved payroll run and verify employee-specific payslip access.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.4c: payslip PDF generation and inline viewer"
```

### 3.5 Payment Gateway API Skeleton + Idempotency + Mock Provider

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.5-payment-gateway-skeleton
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (API conventions and audit requirements).
- Read this `docs/PROMPTS.md`.

TASK
- Build payment gateway API skeleton with idempotency keys and a mock provider adapter.
- Include request/response envelope `{ data, error, meta }` and robust error mapping.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Add internal operations views for payment attempts with `StatusBadge`, `CurrencyDisplay`, and retry actions.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed successful, failed, and duplicate idempotent request scenarios.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.5: payment gateway skeleton and idempotency"
```

### 3.6 Expense Management (Submission + Approvals + Reports)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-3/3.6-expense-management
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build expense submission, approval workflow, and reporting views.
- Include receipt metadata and policy validation.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Submission forms require inline validation.
- Expense table uses `DataTable`, `StatusBadge`, `CurrencyDisplay`, and row hover quick actions.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed draft/submitted/approved/rejected expenses and verify report totals.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 3.6: expense management module"
```

## Phase 4 (Performance & Analytics)

### 4.1 Performance Reviews (Cycles + Forms)

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-4/4.1-performance-reviews
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build review cycle management and performance review forms.
- Support manager/employee perspectives and status workflows.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Review cycle list uses `DataTable` + `StatusBadge`.
- Review forms require inline validation and autosave feedback via `Toast`.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed active and closed cycles with mixed completion states.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 4.1: performance reviews and cycles"
```

### 4.2 Analytics Dashboards + CSV Export

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-4/4.2-analytics-dashboards
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md`.
- Read this `docs/PROMPTS.md`.

TASK
- Build analytics dashboards with role-scoped metrics and CSV export.
- Ensure consistent metric definitions and timezone-aware date ranges.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Use `MetricCard`, charts, and export action states with skeletons and `EmptyState` fallbacks.
- Numeric outputs must use Geist Mono and tabular figures.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed representative records to verify dashboard calculations and CSV output.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 4.2: analytics dashboards and CSV export"
```

## Phase 5 (Compliance & Polish)

### 5.1 Compliance Tracker + Deadlines

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-5/5.1-compliance-tracker
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (audit, RLS, role model).
- Read this `docs/PROMPTS.md`.

TASK
- Build compliance tracker with deadline monitoring and ownership.
- Include escalation states and overdue detection.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Compliance list uses `DataTable` + `StatusBadge` with overdue highlighting.
- Deadline views must show relative time + full tooltip date in viewer timezone.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed on-track and overdue obligations to validate escalations.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 5.1: compliance tracker and deadlines"
```

### 5.2 Notifications Center + Resend Email For Selected Events

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-5/5.2-notifications-center-resend
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (Resend, API conventions).
- Read this `docs/PROMPTS.md`.

TASK
- Build in-app notifications center and Resend email triggers for selected events.
- Include delivery status tracking and retry behavior for transient failures.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Notification table/list must include loading skeleton, empty state, sorting, and row hover actions.
- Notification preferences forms require inline validation.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Seed notification events and validate in-app + email paths.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 5.2: notifications center and email events"
```

### 5.3 Security Hardening + Tests

```md
BEFORE CODING (SMART WAY)
- Confirm current git branch is NOT main.
- Switch/create branch: phase-5/5.3-security-hardening-tests
- Implement ONLY this module, then STOP after `npm run lint` + `npm run build` pass.

REFERENCE (MUST READ BEFORE STARTING)
- Read `docs/NORTH_STAR.md` (RLS, API validation, audit requirements).
- Read this `docs/PROMPTS.md`.

TASK
- Perform security hardening pass and add/expand tests for critical flows.
- Cover auth boundaries, RLS policy expectations, API validation, and audit logging.

UI SPECIFICS FOR THIS MODULE
- Apply GLOBAL UI / DESIGN NON-NEGOTIABLES from this prompt pack.
- Security-related UX states (access denied, expired session, blocked action) must use clear `EmptyState`/error cards with safe CTAs.

SEED DATA + VERIFICATION
- If seed data is missing, run Prompt 0.3 first.
- Verify tests with seeded cross-role scenarios and negative security cases.

STOP CONDITION
- One module only.
- `npm run lint` and `npm run build` must pass.

COMMIT MESSAGE
- "Phase 5.3: security hardening and tests"
```
