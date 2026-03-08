# Scheduling System Upgrade — PILOT Ready

## Context

Scheduling is at `LIMITED_PILOT` but has critical gaps that prevent a CS Team Lead from completing the core workflow: **create → generate → review → adjust → publish → handle swaps**. The auto-generate UI is hardcoded to "weekday" only (backend supports weekend), there's no way to edit or delete shifts after generation (PUT API exists but no UI), and publishing has no confirmation dialog. These gaps make the Manage tab misleading — it looks functional but breaks down at the "adjust" step.

The goal: make scheduling genuinely strong enough for real internal use by the Customer Success team.

---

## Phase A: Audit Summary (Completed)

### What Is Strong (Preserve)
- **Auto-scheduler algorithm** (`lib/scheduling/auto-scheduler.ts`, 352 lines): 3-phase generation (greedy → weekend rotation → balance pass), hours-based fairness within 10% tolerance, back-to-back prevention, Fisher-Yates randomization
- **API layer** (11 route files): Full auth, Zod validation, audit logging, department scoping, conflict detection on shift create/update/claim
- **Swap lifecycle**: Request → accept/reject → manager approve → shift transfer with conflict checks + notifications
- **Open shift claiming**: Atomic race-condition-protected via `is("employee_id", null)` condition
- **Database schema**: Proper constraints, indexes, RLS policies, cascade deletes
- **Day notes**: Auto-save on blur, per-schedule per-date
- **Type system** (`types/scheduling.ts`): Clean status enums, record types, response envelopes
- **Notification hooks**: Publish notifies all assigned employees, claim notifies manager, swaps notify relevant parties

### What Is Weak (Must Fix)
1. **No shift editing UI** — PUT `/api/v1/scheduling/shifts/[id]` exists but no frontend calls it
2. **No shift deletion** — No cancel/remove action for unwanted shifts
3. **Schedule type hardcoded** — `scheduleType: "weekday"` on line 284 of manage client; backend supports weekday/weekend/holiday
4. **No publish confirmation** — One-click publish with no dialog; dangerous for a schedule affecting the whole team
5. **No schedule deletion** — Can't remove draft schedules created by mistake
6. **Template management incomplete** — Create only; no edit or delete
7. **Swap reason hidden** — Managers can't see why someone requested a swap in the table
8. **"View swaps" action is useless** — Links to generic swaps tab, not filtered by shift
9. **`window.confirm()` in swaps** — Uses browser native confirm instead of ConfirmDialog component

---

## Phase B–D: Implementation Plan

### Change 1: Schedule Type Selector for Auto-Generate
**File:** `app/(shell)/scheduling/manage/scheduling-manage-client.tsx`

Add a `scheduleType` state variable (default: `"weekday"`) and a `<select>` control inside the auto-generate flow. When the user clicks "Auto-generate" on a draft schedule, show a small inline selector for schedule type before triggering generation.

**Approach:** Add state `autoGenScheduleType` (`"weekday" | "weekend"`) and a selector that appears in the auto-generate preview header. Pass `scheduleType: autoGenScheduleType` instead of the hardcoded `"weekday"` on line 284.

- Add state: `const [autoGenScheduleType, setAutoGenScheduleType] = useState<"weekday" | "weekend">("weekday");`
- In `handleAutoGenerate()`, change line 284: `scheduleType: autoGenScheduleType`
- Add a `<select>` in the schedules table action cell, next to the "Auto-generate" button:
  ```
  <select value={autoGenScheduleType} onChange={...}>
    <option value="weekday">Weekday shifts</option>
    <option value="weekend">Weekend shifts</option>
  </select>
  ```
- Reset `autoGenScheduleType` to `"weekday"` in `handleDiscardAutoGen()` and after apply

---

### Change 2: Publish Confirmation Dialog
**File:** `app/(shell)/scheduling/manage/scheduling-manage-client.tsx`

Replace the direct `handlePublishSchedule()` call with a ConfirmDialog flow.

- Import `ConfirmDialog` from `../../../../components/shared/confirm-dialog`
- Add state: `publishConfirmScheduleId: string | null` (null = dialog closed)
- "Publish" button sets `publishConfirmScheduleId` instead of calling `handlePublishSchedule` directly
- Render `<ConfirmDialog>` at bottom of component:
  ```
  title: "Publish schedule?"
  description: "This will notify all assigned team members. Draft shifts become final."
  confirmLabel: "Publish"
  tone: "default"
  isConfirming: isPublishingScheduleId !== null
  onConfirm: () => handlePublishSchedule(publishConfirmScheduleId!)
  onCancel: () => setPublishConfirmScheduleId(null)
  ```
- After publish completes (success or error), set `publishConfirmScheduleId` to `null`

---

### Change 3: Shift Editing
**File:** `app/(shell)/scheduling/manage/scheduling-manage-client.tsx`

Add an "Edit" action to each shift row that populates the existing "Create shift" form with the shift's current values, then submits a PUT instead of POST.

**Approach:** Reuse the existing shift form for editing by tracking an `editingShiftId` state.

- Add state: `editingShiftId: string | null` (null = create mode)
- Add "Edit" action button in the shifts table action cell (alongside "View swaps")
- Clicking "Edit" populates `shiftForm` with the shift's current values and sets `editingShiftId`
- Change form header: "Create shift" → "Edit shift" when `editingShiftId` is set
- Add a "Cancel edit" button that resets form + clears `editingShiftId`
- In `handleCreateShift()` (rename to `handleSubmitShift()`):
  - If `editingShiftId`: PUT to `/api/v1/scheduling/shifts/${editingShiftId}`
  - Else: POST to `/api/v1/scheduling/shifts` (existing behavior)
- After successful edit: reset form, clear `editingShiftId`, refresh queries
- Only show "Edit" for shifts with status `"scheduled"` (not swapped/cancelled)

---

### Change 4: Shift Deletion (Cancel)
**File:** `app/(shell)/scheduling/manage/scheduling-manage-client.tsx`

Add a "Cancel" action to shift rows that sets shift status to `"cancelled"` via PUT.

- Add state: `cancelConfirmShiftId: string | null`
- Add "Cancel" action button in shifts table for shifts with status `"scheduled"` or `"swap_requested"`
- Clicking "Cancel" opens a ConfirmDialog:
  ```
  title: "Cancel shift?"
  description: "This will remove the employee's assignment. This cannot be undone."
  tone: "danger"
  ```
- On confirm: PUT `/api/v1/scheduling/shifts/${shiftId}` with `{ status: "cancelled" }`
- Refresh shifts + schedules after

---

### Change 5: Schedule Deletion (Draft Only)
**Files:**
- `app/api/v1/scheduling/schedules/[id]/route.ts` (NEW — add DELETE handler)
- `app/(shell)/scheduling/manage/scheduling-manage-client.tsx`

**API route (new file):**
Create `app/api/v1/scheduling/schedules/[id]/route.ts` with a DELETE handler:
- Auth: TEAM_LEAD | MANAGER | HR_ADMIN | SUPER_ADMIN
- Validation: Schedule must exist, must be `"draft"` status (reject published/locked)
- Department scoping for team leads
- Cascade delete handles shifts automatically (DB constraint)
- Audit log: schedule deleted
- Response: 200 with `{ data: { deleted: true } }`

**Frontend:**
- Add state: `deleteConfirmScheduleId: string | null`
- Add "Delete" action button in schedules table for draft schedules
- ConfirmDialog with `tone: "danger"`, title "Delete draft schedule?"
- On confirm: DELETE `/api/v1/scheduling/schedules/${scheduleId}`
- Refresh schedules after

---

### Change 6: Template Edit & Delete
**Files:**
- `app/api/v1/scheduling/templates/[id]/route.ts` (NEW — PUT + DELETE)
- `app/(shell)/admin/scheduling/templates/scheduling-templates-admin-client.tsx`

**API route (new file):**
- PUT: Update template fields (name, department, startTime, endTime, breakMinutes, color). Same auth/validation as POST.
- DELETE: Soft-delete template (or hard delete if no shifts reference it). Auth: same roles.

**Frontend:**
- Add `editingTemplateId: string | null` state
- "Edit" action populates existing create form with template values, submits PUT
- "Delete" action with ConfirmDialog, submits DELETE
- Change form header dynamically: "Create template" / "Edit template"
- Add "Cancel edit" link when editing

---

### Change 7: Swap Improvements
**File:** `app/(shell)/scheduling/swaps/scheduling-swaps-client.tsx`

Three improvements:

**7a. Show swap reason to managers:**
- The `reason` field already exists on `ShiftSwapRecord`
- Add a "Reason" column to the swaps table (after "Target" column)
- Display `swap.reason ?? "--"` with text truncation (max 40 chars, full on hover via `title`)

**7b. Replace `window.confirm()` with ConfirmDialog:**
- Import `ConfirmDialog` from shared components
- Add state: `confirmAction: { swapId: string; action: string; label: string } | null`
- Cancel/Reject buttons set `confirmAction` instead of calling `window.confirm()`
- Render `<ConfirmDialog>` at component bottom with dynamic title/description based on action
- Tone: "danger" for cancel/reject

**7c. Fix "View swaps" link in manage shifts table:**
- Replace the generic `/scheduling?tab=swaps` link with a more useful "Edit" / "Cancel" action pair (from Changes 3 & 4)
- Remove the "View swaps" link entirely since the Swaps tab is already a top-level tab

---

### Change 8: Banner Copy Refinement
**File:** `app/(shell)/scheduling/scheduling-tabs-client.tsx`

Update FeatureBanner description to accurately reflect pilot state:
- Current: "Scheduling is available as a limited pilot for Customer Success. Coverage and fairness features are being refined."
- New: "Scheduling is in limited pilot for Customer Success. You can create, generate, edit, and publish weekly schedules."

---

## Phase C: Scope & State Classification

| Capability | State | Rationale |
|---|---|---|
| Create schedule | PILOT | Works correctly |
| Auto-generate (weekday) | PILOT | Algorithm is strong, well-tested |
| Auto-generate (weekend) | PILOT | Algorithm supports it, UI selector added |
| Preview & apply/discard | PILOT | Works correctly |
| Shift editing | PILOT | PUT API exists, adding UI |
| Shift cancellation | PILOT | Using existing PUT to set status |
| Publish with confirmation | PILOT | Adding ConfirmDialog |
| Publish notifications | PILOT | Already works |
| Open shift claiming | PILOT | Atomic, race-protected |
| Swap lifecycle | PILOT | Full workflow exists |
| Day notes | PILOT | Works, auto-save |
| Template create | PILOT | Works |
| Template edit/delete | PILOT | Adding UI + API |
| Schedule deletion (draft) | PILOT | Adding API + UI |
| Multi-week fairness | NOT IN SCOPE | Single-week is sufficient for pilot |
| Employee preferences | NOT IN SCOPE | Not needed for CS team pilot |
| Night shift penalty | NOT IN SCOPE | CS team doesn't have night shifts |
| Calendar/ical export | NOT IN SCOPE | Nice-to-have, not core |

---

## Files Changed Summary

| # | File | Action | Description |
|---|---|---|---|
| 1 | `app/(shell)/scheduling/manage/scheduling-manage-client.tsx` | MODIFY | Schedule type selector, publish confirmation, shift edit/cancel, schedule delete, remove "View swaps" link |
| 2 | `app/(shell)/scheduling/swaps/scheduling-swaps-client.tsx` | MODIFY | Add reason column, ConfirmDialog for actions |
| 3 | `app/(shell)/scheduling/scheduling-tabs-client.tsx` | MODIFY | Banner copy update |
| 4 | `app/(shell)/admin/scheduling/templates/scheduling-templates-admin-client.tsx` | MODIFY | Template edit/delete UI |
| 5 | `app/api/v1/scheduling/schedules/[id]/route.ts` | NEW | DELETE handler for draft schedules |
| 6 | `app/api/v1/scheduling/templates/[id]/route.ts` | NEW | PUT + DELETE handlers for templates |

---

## Verification Plan

1. **TypeScript**: `npx tsc --noEmit` — 0 errors
2. **Build**: `npx next build` — successful
3. **Visual checks via preview server:**
   - [ ] Schedule type selector shows "Weekday shifts" / "Weekend shifts" options
   - [ ] Auto-generate sends selected schedule type to API
   - [ ] Publish button opens ConfirmDialog before publishing
   - [ ] Shift "Edit" populates form, submits PUT, updates table
   - [ ] Shift "Cancel" opens danger dialog, sets status to cancelled
   - [ ] Draft schedule "Delete" opens danger dialog, removes schedule
   - [ ] Template "Edit" populates form, submits PUT
   - [ ] Template "Delete" opens danger dialog, removes template
   - [ ] Swap table shows "Reason" column
   - [ ] Swap cancel/reject uses ConfirmDialog instead of window.confirm()
   - [ ] Banner copy reflects pilot state accurately
   - [ ] All forms reset properly after submit/cancel
   - [ ] Toast messages appear for all actions (success + error)
