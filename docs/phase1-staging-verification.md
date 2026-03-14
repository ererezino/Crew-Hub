# Phase 1: Staging Verification Script

## Prerequisites

- Migration `20260314000000_org_delegation_model.sql` has been applied
- Test org with at least 3 users:
  - **Admin** (SUPER_ADMIN) — e.g., Zino
  - **Manager/Team Lead** — e.g., Clinton
  - **Employee** — e.g., Shalewa

---

## Bug 1: Onboarding → Active

```
1. Log in as Admin
2. Open DevTools → Network tab (preserve log enabled)
3. Go to /people → Create Person
4. Fill required fields, set status = "onboarding"
5. Save → capture the PUT/POST request payload in Network tab
6. Confirm request payload contains "status": "onboarding"
7. Capture the response body → confirm it returns the person with status "onboarding"
8. Confirm person shows status "Onboarding" in the people list

9. Go to /people/{newPersonId} → Edit
10. Change status to "active"
11. Save → capture the PATCH/PUT request payload in Network tab
12. Confirm request payload contains "status": "active"
13. Capture the response body → confirm it returns status "active"
14. Confirm profile page shows status "Active"

15. Hard refresh the page (Cmd+Shift+R)
16. PASS if: status still shows "Active" after refresh (persistence confirmed)
17. PASS if: no errors in Console tab throughout
```

---

## Bug 2: Reset Auth Visibility

The concern: Reset Auth should only appear for employees who have completed account setup (`account_setup_at` is set). It should NOT appear for uninvited or not-yet-setup employees.

```
1. Log in as Admin
2. Go to /people → find an employee who HAS been invited and set up their account
   (i.e., account_setup_at is not null)
3. Open their profile → /people/{id}
4. PASS if: "Reset Auth" button/action IS visible

5. Go to /people → find an employee who has NOT been invited yet
   (i.e., account_setup_at is null, first_invited_at is null)
6. Open their profile → /people/{id}
7. PASS if: "Reset Auth" button/action is NOT visible

8. Go to /people → find an employee who was invited but has NOT completed setup
   (i.e., first_invited_at is set, account_setup_at is null)
9. Open their profile → /people/{id}
10. PASS if: "Reset Auth" button/action is NOT visible

Summary: Reset Auth visibility = account_setup_at IS NOT NULL
```

---

## Bug 3: Create Person vs Invite vs Re-invite Email Flow

```
1. Log in as Admin
2. Go to /people → Create Person
3. Fill fields with a real test email, save
4. PASS if: NO email is sent at creation time (check inbox)

5. Go to /people/{newPersonId} → click "Invite"
6. PASS if: welcome/invite email arrives

7. Go to /people/{newPersonId} → click "Re-invite" (or Invite again)
8. PASS if: re-invite email arrives with fresh link
```

---

## Delegated Leave Approval

### Setup

```sql
-- Set Clinton as team lead for Shalewa
UPDATE profiles SET team_lead_id = '<clinton_id>' WHERE id = '<shalewa_id>';

-- Create a delegation rule (Clinton → Zino as deputy)
INSERT INTO approval_delegates (org_id, principal_id, delegate_id, delegate_type, scope, activation)
VALUES ('<org_id>', '<clinton_id>', '<zino_id>', 'deputy_team_lead', '{leave}', 'when_unavailable');

-- Put Clinton on leave or mark OOO
UPDATE profiles SET availability_status = 'ooo' WHERE id = '<clinton_id>';
```

### Test

```
1. Log in as Shalewa → /time-off → request Annual Leave for any future date
2. Log in as Zino → /time-off/approvals
3. PASS if: delegation banner shows "You are covering for Clinton while they are away."
4. PASS if: Shalewa's request appears with "Covering for Clinton" under her name
5. Approve the request
6. PASS if: Shalewa's request shows "approved"
7. Log in as Shalewa → /time-off
8. PASS if: approver column shows "Zino (on behalf of Clinton)"
```

### Cleanup

```sql
UPDATE profiles SET availability_status = NULL WHERE id = '<clinton_id>';
```

---

## Delegated Schedule Publishing

### Setup

Same team_lead + delegation setup as above, plus:
- Clinton marked OOO
- Shalewa has `schedule_type` set (e.g., `'shift'`)
- Add `schedule` to delegation scope if not already present

### Test

```
1. Log in as Zino (the delegate)
2. Go to /scheduling → create or find a draft schedule
3. Add a shift for Shalewa
4. Click "Publish"
5. PASS if: schedule publishes successfully (no 403)
6. Check notifications for Shalewa
7. PASS if: notification includes "(published by Zino while covering)"
```

### Negative test

```
8. Remove Clinton's OOO status:
   UPDATE profiles SET availability_status = NULL WHERE id = '<clinton_id>';
9. Try to publish a schedule with Shalewa's shifts as Zino
10. PASS if: 403 — Zino is no longer covering (when_unavailable activation)
```

---

## Delegated Manager-Stage Expense Approval

### Setup

Same delegation setup as above (Clinton → Zino, Clinton OOO). Ensure `expense` is in scope:

```sql
UPDATE approval_delegates SET scope = '{leave,expense,schedule}' WHERE ...;
```

### Test

```
1. Log in as Shalewa → /expenses → submit an expense
2. Log in as Zino → /expenses/approvals (manager tab)
3. PASS if: delegation banner shows "You are covering for Clinton while they are away."
4. PASS if: Shalewa's expense appears
5. Select and approve
6. PASS if: approval succeeds, status moves to "manager_approved"
7. Log in as Shalewa → /expenses → view the expense
8. PASS if: timeline shows "Approved by Zino on behalf of Clinton."
9. PASS if: notification says "approved by Zino (covering for Clinton)"
```

---

## Profile Page — Operational Lead

### Setup

Shalewa has `team_lead_id = Clinton`, `manager_id = Zino` (different people).

### Test

```
1. Log in as Admin → /people/{shalewa_id}
2. PASS if: profile shows both:
   - "Reports to: Zino"
   - "Operational lead: Clinton"
3. Both appear in basicInfo section and workInfo section

When team_lead == manager:
4. Set team_lead_id = manager_id for Shalewa
5. PASS if: "Operational lead" label does NOT appear (redundant)
```

---

## Approval Queue — Delegation Banner + Tags

```
1. With active delegation and principal OOO:
   - /time-off/approvals shows banner + per-row "Covering for {name}"
   - /expenses/approvals (manager tab) shows banner + per-row tag

2. Without any delegation:
   - No banner appears
   - Department shows normally under employee name
```

---

## Leave/Expense History — "On Behalf Of"

```
1. After a delegated leave approval:
   - /time-off → history table → approver column shows "{approver} (on behalf of {principal})"

2. After a delegated expense approval:
   - /expenses → expense detail → timeline step shows "Approved by {approver} on behalf of {principal}."

3. After a direct (non-delegated) approval:
   - These labels do NOT appear — just shows the approver name normally
```
