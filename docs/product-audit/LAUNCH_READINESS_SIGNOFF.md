# Launch-Readiness Signoff — Controlled Employee Onboarding

**Date**: 2026-03-18
**Status**: SIGNED OFF
**Scope**: Controlled onboarding launch for all employee roles

---

## Multi-Role Visual Audit

Eight distinct roles/personas were individually tested via browser login with
TOTP MFA. Each session verified the dashboard, sidebar nav, and at least one
secondary surface (drawer, detail panel, dropdown, or modal).

| Role / Persona | Account | Sidebar | Dashboard persona | Verified |
|---|---|---|---|---|
| SUPER_ADMIN | coo@accrue.test | Full nav | All widgets | Yes |
| MANAGER | eng.manager@accrue.test | Team + People sections | Manager widgets | Yes |
| EMPLOYEE | engineer1@accrue.test | MY WORK only | Standard employee | Yes |
| HR_ADMIN + FINANCE_ADMIN | people.finance@accrue.test | People + Finance | Combined HR/Finance | Yes |
| TEAM_LEAD | teamlead@accrue.test | MY WORK + TEAM | Team lead view | Yes |
| HR_ADMIN (solo) | hradmin@accrue.test | People, Compliance, Onboarding, Signatures | HR-focused | Yes |
| FINANCE_ADMIN (solo) | financeadmin@accrue.test | Payroll, Compensation, Expenses | Finance-focused | Yes |
| EMPLOYEE / new_hire | ops.associate@accrue.test | EMPLOYEE nav | Onboarding banner + 18 tasks | Yes |

### Key observations

- HR_ADMIN (solo) and FINANCE_ADMIN (solo) produce **clearly distinct** sidebar
  and dashboard experiences, confirming proper role-based separation.
- new_hire persona activates correctly based on `start_date` within 30 days +
  active onboarding instance.
- TEAM_LEAD has Scheduling access but no Finance or People admin sections.

---

## Secondary Surfaces Verified

| Surface | Location | Status |
|---|---|---|
| Tabs | Submit Expense (Work Expense / Personal Reimbursement) | Pass |
| Drawer | Submit Expense form with category grid, currency dropdown, file upload | Pass |
| Inline detail panel | Expense row > Details (Approval Timeline, Info Requests) | Pass |
| Notifications dropdown | Header bell icon, 3 items, mark-read actions | Pass |
| User menu dropdown | Avatar > name, email, role badge, Settings, Sign out | Pass |
| Language selector | Header EN/FR toggle | Pass |
| Progress stepper | Payroll Run detail (Draft > Calculated > Approved > Completed) | Pass |
| Approval workflow | Payroll Run Step 1 + Step 2 with resolved approver names | Pass |
| Onboarding task list | new_hire: 10 tasks, progress bar, due dates, action links | Pass |
| Data tables | Expenses (sortable columns, status badges), Payroll items | Pass |

---

## Bugs Found and Fixed

### Critical: Cross-user cache poisoning (`82f66e2`)

- **Symptom**: Switching users showed previous user's sidebar nav items.
- **Root cause**: Browser HTTP cache keyed on URL only (missing `Vary: Cookie`),
  React Query key identical across users.
- **Fix**: Added `Vary: Cookie` to `/me/access-config` API response headers,
  `cache: "no-store"` on client fetch, user email in React Query key.

### Medium: Payroll approver UUIDs shown instead of names (`f84dcc5`)

- **Symptom**: Approval workflow displayed raw UUIDs like `d6be79d9-5894-...`.
- **Root cause**: API resolved `initiated_by` to a name but not
  `first_approved_by` or `final_approved_by`.
- **Fix**: Batched profile lookup for all actor IDs, added
  `firstApprovedByName`/`finalApprovedByName` to type and all 4 call sites.

### Medium: /documents nav config stale after restructure (`472ed64`)

- **Symptom**: `/documents` row in `navigation_access_config` had ALL_ROLES
  from before the nav restructure.
- **Fix**: SQL migration to restrict `/documents` to HR_ADMIN + SUPER_ADMIN,
  insert `/me/documents` row for all roles.

### Low: Access control admin UI module list outdated (`8196dc1`)

- **Symptom**: Hardcoded `ALL_MODULES` array in admin client still had
  `/documents` under "My Work" category.
- **Fix**: Changed to `/me/documents` for personal docs, added `/documents` as
  "Document management" under Operations.

---

## /me/documents vs /documents — Resolved Model

| Route | Purpose | Category | Visible to |
|---|---|---|---|
| `/me/documents` | Personal documents | My Work | All roles |
| `/documents` | Document management | Operations | HR_ADMIN, SUPER_ADMIN |

Aligned across: database config, admin UI modules, sidebar nav, i18n (EN + FR).

---

## Accepted Exceptions (Non-blocking)

1. **Payroll PILOT banner**: Disbursement execution is disabled. Expected for
   controlled launch — payroll runs can be created and approved but not
   disbursed through a payment provider.
2. **Next.js dev overlay "1 Issue"**: Local-only development warning, does not
   appear in production builds.
3. **Expense notification for finance**: Fully functional (in-app + email) but
   not visually tested end-to-end in this audit (verified via code review of
   `app/api/v1/expenses/[id]/route.ts` lines 754-786).

---

## Build and Test Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Zero errors |
| Test suite (`vitest run`) | 429 tests pass, 38 files |
| Git status | Clean working tree |
| Push to origin/main | `aecb116` |

---

## Commits Shipped

| SHA | Description |
|---|---|
| `472ed64` | fix(access): migrate /documents nav config to admin-only |
| `8196dc1` | fix(access-control): align admin UI modules with nav restructure |
| `82f66e2` | fix(auth): prevent cross-user cache poisoning on access-config API |
| `f84dcc5` | fix(payroll): resolve approver names instead of showing raw UUIDs |
| `aecb116` | chore(scripts): add multi-role audit account creation script |

---

## Test Accounts

Created via `scripts/auth/create-audit-accounts.ts` for reproducible future
audits. All accounts use TOTP MFA.

| Email | Roles | Purpose |
|---|---|---|
| teamlead@accrue.test | TEAM_LEAD | Solo team lead experience |
| hradmin@accrue.test | HR_ADMIN | Solo HR admin experience |
| financeadmin@accrue.test | FINANCE_ADMIN | Solo finance admin experience |
| ops.associate@accrue.test | EMPLOYEE (new_hire) | Onboarding persona (start_date 5 days ago) |
