# Crew Hub Phase 6: The Definitive Build

## CRITICAL EXECUTION RULES -- READ BEFORE ANYTHING ELSE

```
YOU HAVE FULL PERMISSIONS. DO NOT ASK FOR APPROVAL. DO NOT PAUSE.
DO NOT ASK "should I proceed?" DO NOT ASK "would you like me to..."
DO NOT STOP TO CONFIRM ANYTHING. EXECUTE EVERY TASK IN THIS PROMPT
FROM START TO FINISH WITHOUT ANY HUMAN INTERACTION.

If something is ambiguous, make the best decision and move on.
If a file needs to be created, create it.
If a file needs to be deleted, delete it.
If a command needs to run, run it.
If a migration needs to be written, write it.
If a component needs to be redesigned, redesign it.

THE ONLY REASON TO STOP: if `npm run build` fails. Fix it and continue.

Do not narrate what you are about to do. Do not explain your reasoning.
Do not list options. Do not ask for preferences. JUST BUILD.

Work efficiently. Do not read files you do not need to change.
Commit after each GROUP, not each file. Push after each group.
```

Read docs/NORTH_STAR.md once at the start. Do not re-read it.

---

## QUALITY GATES (apply after EVERY group)

After completing each group, BEFORE committing, run the quality gate
for that group. Do not skip this. Do not commit until every check passes.

You are simultaneously four people:

**THE DESIGNER** audits every UI change by opening the affected pages
and checking: Does this look like Linear/Ramp/Rippling? Is typography
hierarchy correct? Are cards consistent? Is spacing uniform? Are empty
states polished? Would I be embarrassed to show this to a designer at
Stripe? Fix anything that fails before committing.

**THE QA ENGINEER** tests every flow end-to-end: Does the happy path
work? What happens with bad input? What does the error state look like?
What about empty state? What about loading state? Does it work if the
user has no data? Does the button actually call the API? Does the API
actually write to the DB? Does the response actually update the UI?

**THE PRODUCT MANAGER** asks: Does this actually solve the user's
problem? Is the copy clear? Would a new employee understand what to do
without instructions? Is the most important action the most visible?
Are we showing the right data at the right time? Is anything confusing,
redundant, or missing?

**THE ENGINEER** checks: Does `npm run build` pass? Are there type
errors? Is there dead code? Are there console warnings? Is the DB
migration safe? Are RLS policies correct? Is the API returning the
right status codes? Are there any N+1 queries?

Each group below ends with a specific quality gate. Execute it.

---

## DESIGN SPECIFICATION (pixel-level, no interpretation needed)

```
This is not a guideline. This is a specification. Follow it exactly.
If a value is not specified here, match the closest specified value.

LAYOUT:
- Page max-width: 1280px, centered, with 32px horizontal padding
- Sidebar width: 240px (collapsed: 64px)
- Top bar height: 56px
- Page content starts 24px below the page header

CARDS:
- Background: var(--bg-elevated) (white in light mode)
- Border: 1px solid var(--border-default)
- Border-radius: 8px
- Box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)
- Padding: 20px (p-5)
- Gap between cards in a row: 16px
- Gap between card sections vertically: 24px

TYPOGRAPHY:
- Page title: 20px, weight 600, color var(--text-primary), line-height 1.25
- Page description: 14px, weight 400, color var(--text-secondary), margin-top 4px
- Section heading: 14px, weight 600, color var(--text-primary)
- Body text: 14px, weight 400, color var(--text-primary), line-height 1.5
- Caption/label: 12px, weight 500, color var(--text-secondary)
- Table header: 12px, weight 600, color var(--text-secondary), uppercase,
  letter-spacing 0.04em
- Mono text (numbers, currency, dates, IDs): font-family Geist Mono,
  font-variant-numeric tabular-nums

BUTTONS:
- Height: 36px (default), 32px (compact/table actions), 40px (hero CTAs)
- Border-radius: 6px
- Font: 13px, weight 500
- Primary: background var(--accent) #22C55E, color white,
  hover var(--accent-hover) #16A34A. NEVER black or dark gray.
- Secondary: background transparent, border 1px var(--border-default),
  color var(--text-primary), hover bg var(--bg-tertiary)
- Destructive: background var(--status-error-bg), color var(--status-error-text),
  border 1px var(--status-error-border), hover bg red-100
- Ghost: background transparent, color var(--text-secondary),
  hover color var(--text-primary), hover bg var(--bg-tertiary)
- Icon buttons: 32x32px, border-radius 6px, ghost style
- BANNED: bg-black, bg-gray-900, bg-slate-900, bg-neutral-900, bg-zinc-900
  for ANY button anywhere in the app except dark-mode sidebar background

FORM INPUTS:
- Height: 36px
- Border: 1px solid var(--border-default)
- Border-radius: 6px
- Padding: 0 12px
- Font: 14px
- Focus: ring 2px var(--accent) with 2px offset
- Error: border var(--status-error-border), error text 12px below input
- Placeholder: color var(--text-disabled)

SELECT/DROPDOWN:
- Never use native <select> for user-facing selects
- Always use a styled combobox/dropdown with search capability
- Options show avatar + text where relevant (people selectors)

TABLES:
- Header row: bg var(--bg-secondary), 12px uppercase text-secondary,
  padding 8px 16px, border-bottom 1px var(--border-default)
- Data rows: 14px text-primary, padding 12px 16px,
  border-bottom 1px var(--border-subtle)
- Row hover: bg var(--bg-secondary) transition 150ms
- Sort indicator: chevron up/down icon, 12px, text-secondary
- Minimum row height: 48px

STATUS BADGES:
- Height: 22px, border-radius 11px (full pill), padding 0 8px
- Font: 12px, weight 500
- Use status token colors (success/warning/error/info/pending/draft)

METRIC CARDS (dashboard/summary):
- Equal height within a row (use grid, not flex-wrap)
- Label: 12px, weight 500, color text-secondary, uppercase
- Value: 24px (or 28px for hero metrics), weight 600, Geist Mono
- Optional trend indicator: 12px, green up or red down

EMPTY STATES:
- Centered within the parent card/section
- Icon: 48px, color text-tertiary, 16px margin-bottom
- Heading: 16px, weight 600, text-primary
- Body: 14px, text-secondary, max-width 360px, text-center, 12px margin
- CTA: secondary button (outline), 16px margin-top
- NEVER just text. NEVER a black button. NEVER "Back to dashboard" as CTA.

ERROR STATES:
- Background: var(--status-error-bg), border 1px var(--status-error-border),
  border-radius 8px, padding 20px
- Icon: AlertCircle, 24px, color var(--status-error-text)
- Heading: 14px, weight 600, color var(--status-error-text)
- Message: 14px, weight 400, color var(--text-primary). HUMAN LANGUAGE ONLY.
  Never show column names, function signatures, or error codes.
- Action: secondary button "Try again" or specific fix action

LOADING STATES:
- Skeleton loaders that match the shape of actual content
- Animate with a shimmer (left-to-right gradient pulse)
- Card skeletons: match card dimensions
- Table skeletons: 5 rows of rectangular bars matching column widths
- Never bare spinners. Never blank space.

AVATAR:
- Sizes: 24px (inline/compact), 32px (table rows), 40px (cards), 
  64px (profile header), 96px (profile page hero)
- Border-radius: 50% (circle)
- Fallback: colored circle with initials (first + last name initial),
  color derived from name hash for consistency
- Support image upload via Supabase Storage

DARK MODE:
- Toggle in top bar (sun/moon icon)
- Persisted to user preferences
- Every color must use CSS variables (never hardcoded hex in components)
- Test EVERY page in dark mode. Fix invisible text, wrong backgrounds,
  broken contrast.

TRANSITIONS:
- Hover effects: 150ms ease-out
- Panel/modal open: 200ms ease-out
- Page transitions: none (instant, this is an app not a website)

MOBILE (375px+):
- Sidebar: hidden, hamburger menu in top bar
- Cards: single column, full width
- Tables: horizontal scroll, sticky first column
- Modals/SlidePanels: full-screen on mobile
- Touch targets: minimum 44px height
- Employee self-service pages MUST work on mobile
- Admin pages: desktop-only is acceptable

TOP BAR:
- Height: 56px, bg var(--bg-elevated), border-bottom 1px var(--border-default)
- Left: hamburger (mobile) or nothing (desktop, sidebar is always visible)
- Center: search bar with "Cmd/Ctrl + K" hint
- Right: notification bell (with unread count badge), dark mode toggle,
  user avatar dropdown
- Avatar dropdown menu: view profile, preferences, keyboard shortcuts,
  sign out

PROFILE PHOTOS:
- Employees can upload a profile photo from their profile page
- Upload via Supabase Storage bucket 'avatars/'
- Accept: jpg, png, webp. Max 5MB.
- Crop to square on upload (provide a simple crop interface or auto-center-crop)
- Display everywhere: sidebar (if collapsed shows avatar), top bar, people
  directory, employee cards, approval requests, notifications, comments,
  team hub, scheduling pills
- Fallback: colored circle with initials when no photo uploaded

BROWSER TAB:
- Each page sets <title>: "[Page Name] - Crew Hub"
- Favicon: Crew Hub icon
- When notifications are unread: show count in tab title "[3] Dashboard - Crew Hub"

BREADCRUMBS:
- Show on all pages below the top bar, above the page title
- Format: Home > Section > Page (links, text-secondary, 12px)
- Current page is text-primary, not a link

403/404 HANDLING:
- If user navigates to a page they don't have permission for: show a
  centered 403 page with message "You don't have access to this page"
  + "Go to dashboard" button. Not a raw 404.
- If page doesn't exist: proper 404 with Crew Hub branding.

SESSION:
- If session expires while user is on a page: redirect to login with
  a message "Your session expired. Please log in again."
- Do not show errors or blank pages on session expiry.

NO em dashes in any user-facing copy. TypeScript strict. No `any`.
```

---

# ============================================================
# GROUP 0: FIX BROKEN PAGES
# Four pages error out. Nothing else matters until these work.
# ============================================================

**0.1** Performance page crashes: "column review_assignments.shared_at does not exist"

Find every column the performance module code references. Cross-reference with the actual DB table. Create a migration adding ALL missing columns. At minimum: `shared_at TIMESTAMPTZ`, `acknowledged_at TIMESTAMPTZ`, `discussion_summary TEXT`. Check for others.

**0.2** Approvals page: "Could not find function public.approve_leave_request"

Create `approve_leave_request(p_approver_id UUID, p_request_id UUID)` RPC:
- Verify request exists, is pending
- Block self-approval: "You cannot approve your own leave request. It must be approved by your manager or HR."
- Approve, deduct balance, audit log, return success
Create `reject_leave_request(p_rejector_id UUID, p_request_id UUID, p_reason TEXT)` too.

Also: every error toast in the app must show human-readable messages, not raw PostgreSQL errors. Create `lib/errors.ts` with a `humanizeError(raw: string): string` function that maps common patterns (schema cache, column not exist, RLS violation, duplicate key, foreign key) to plain English. Find every toast error call and wrap through it.

**0.3** People page: "Unable to load people records"

Debug the API. Fix RLS or query issue. People loads for MANAGER/TEAM_LEAD/HR_ADMIN/FINANCE_ADMIN/SUPER_ADMIN.

**0.4** Notifications: "Unable to load notifications" despite showing "1 new"

Fix the query. Handle `COALESCE(actions, '[]'::jsonb)` for the recently added column. Check RLS.

```bash
npm run lint && npm run build
```

**QUALITY GATE 0:**
- [ ] Navigate to /performance in the app (or check the API response). Does it load without errors? If not, fix.
- [ ] Navigate to /approvals. Try to approve a request as the same user who created it. Does it show a clear human message (not a PostgreSQL error)? If not, fix.
- [ ] Navigate to /people. Does the directory load? If not, fix.
- [ ] Click the notification bell. Do notifications load? If not, fix.
- [ ] Search the codebase for any raw error string displayed to users: `grep -rn "schema cache\|does not exist\|RLS\|foreign key" app/(shell)/ --include="*.tsx"`. If any appear in rendered JSX (not in error handling logic), wrap them in `humanizeError()`.

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 0 -- fix broken pages"
git push
```

---

# ============================================================
# GROUP 1: NAVIGATION AND INFORMATION ARCHITECTURE
# ============================================================

**1.1 Sidebar redesign**

Current problems: section headers smaller than nav items, redundant items (Schedule vs Scheduling), collapsed sections hiding important pages.

New structure:

```
[Crew Hub logo]

Home
Announcements

MY WORK                          (11px uppercase, text-tertiary, 600)
  Time Off                       (13.5px, text-secondary, 400)
  My Pay
  Documents
  Learning

TEAM                             (MANAGER/TEAM_LEAD+ only)
  Approvals  [count badge]
  People
  Scheduling
  Onboarding
  Team Hub

FINANCE                          (FINANCE_ADMIN+ only)
  Payroll
  Expenses
  Compensation

OPERATIONS                       (HR_ADMIN+ only)
  Performance
  Compliance
  Analytics
  Signatures

ADMIN                            (SUPER_ADMIN only)
  Organization
  Roles & Access
  Audit Log

Settings                         (bottom, always visible -- personal settings only)
```

Rules:
- Section headers MUST be visually distinct: smaller, uppercase, lighter, more top margin
- Remove ALL collapsible chevrons. Sidebar is not long enough to need them.
- Remove redundant nav items. If Schedule and Scheduling both exist, keep only Scheduling.
- Active item: bg-bg-tertiary, text-primary, 3px left border in accent color
- Badge: orange circle, 18px, white text

**1.3 Restructure Settings and Admin pages**

The admin area is a mess. Multiple pages overlap, some are broken, and the organization doesn't make sense. Fix it.

**Problem 1: "Admin Users" and "People" are the same thing.**
"Admin Users" (with Invite User / User List tabs) is just People with a different name. It even shares the same API (both show "Unable to load people records"). REMOVE Admin Users entirely. Everything it does belongs in People:
- Adding people: People > Add person
- Viewing user list: People (the directory)
- Inviting users: People > Add person (which sends the welcome email)
- Managing roles: People > click a person > edit their roles on their profile

**Problem 2: "Payment Details" is a misplaced standalone page.**
Payment details (employee bank accounts, mobile money, payout methods) should NOT be a separate admin page. Two audiences need this:
- The EMPLOYEE needs to set up their own payout method. This belongs in **My Pay** (a "Payout Setup" section where the employee enters their bank/mobile money details).
- FINANCE needs to see payout methods when running payroll. This belongs **inside the Payroll flow** (when reviewing a payroll run, each item shows the employee's payout method inline, with a warning if it's missing).
Remove the standalone Payment Details page. Move the employee self-service part to My Pay. Move the finance-view part into the Payroll run detail.

**Problem 3: Access Control is nonsensical.**
The current grid (screenshot: a table of "Toggle Home for EMPLOYEE", "Toggle Home for TEAM_LEAD", etc. for every nav item and every role) is confusing and unnecessary. The sidebar already respects roles via the code-level checks (FINANCE section shows for FINANCE_ADMIN+, etc.).

Replace the access control page with a simple, clean view:
- **Default role permissions** (read-only display): a clean summary showing what each role can access by default. Not a grid of checkboxes. A card per role showing: "Employee: Time Off, My Pay, Documents, Learning, Expenses" etc. This is for reference, not editing.
- **Per-person overrides** (the only editable part): a table of exceptions. "Give [person] access to [module] even though their role wouldn't normally allow it." This is rare and should feel like an exception, not the primary interface.
- **Remove the checkbox grid entirely.** Role-based access is enforced in code. The admin UI should show what the defaults are, not pretend they're configurable per-checkbox.

**Problem 4: Settings page structure.**
The current Settings has too many tabs that mix personal and admin concerns. Restructure:

**For all users (under avatar dropdown > Settings or the Settings nav item):**
- Profile: photo, name, phone, emergency contact, timezone, pronouns
- Preferences: dark mode, notification settings, email digest frequency
- Security: change password, active sessions

**For SUPER_ADMIN (under the OPERATIONS section in sidebar, or a dedicated Admin page):**
- Organization: company name, logo, countries, currencies
- Departments: list, create, edit, assign leads
- Leave Policies: per-country leave types and entitlements
- Public Holidays: per-country holiday calendars
- Expense Categories: reimbursable types and limits
- Roles & Access: the simplified role view described above (default permissions + per-person overrides)
- Audit Log: who did what when (paginated, filterable)

This means Settings for a regular employee is just 3 tabs (Profile, Preferences, Security). Clean and simple. The admin stuff lives in its own section that only SUPER_ADMIN sees.

**1.4 AFK and availability status for remote teams**

Accrue is fully remote. Nobody clocks in. But the team needs to know who is available right now. Build a lightweight presence/status system:

**Status options:**
- Available (green dot) -- default when online
- In a meeting (yellow dot)
- On a break (yellow dot)
- Focusing (orange dot -- do not disturb)
- AFK (gray dot -- stepped away)
- OOO (red dot -- out of office / on leave)

**How it works:**
- In the top bar, next to the user's avatar: a small colored status dot. Clicking it opens a dropdown to change status.
- When changing to AFK or OOO: optional note field ("Back in 30 min" or "On leave until March 10")
- Status is visible everywhere the person appears: people directory, team hub, scheduling, approval queues, manager's dashboard
- When someone is AFK/OOO, their card in the People directory shows the status and note
- On the manager's dashboard "Team today" card: show who is Available, who is AFK, who is OOO
- If someone sets OOO: suggest they also submit a leave request if they haven't already
- Status auto-resets to Available when the user becomes active again (page load or API call after being AFK). AFK could auto-set after 30 minutes of inactivity (optional, configurable).

**Data model:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'available'
  CHECK (availability_status IN ('available','in_meeting','on_break','focusing','afk','ooo'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
```

**Sidebar update:**
Remove "Hours" / "Attendance" entirely from the sidebar. The status system replaces it for the remote context. For shift-based teams (CS), their shifts are in Scheduling > My Shifts. The status dot in the top bar is the presence indicator.

Updated MY WORK section:
```
MY WORK
  Time Off
  My Pay
  Documents
  Learning
```
No "Attendance." No "Hours." No "My Shifts" as a separate item. If the employee has shifts, they see them in Scheduling.

**1.3 Think about what's missing from navigation**

The sidebar should also account for:
- Surveys (currently exists, should be under MY WORK or LEARNING)
- The employee's own profile (accessible from avatar dropdown in top bar, not sidebar)

Check if Surveys is orphaned. If it exists as a module, add it under Learning or MY WORK.

```bash
npm run lint && npm run build
```

**QUALITY GATE 1 (Designer + PM + QA):**
- [ ] Open the sidebar. Are section headers visually SMALLER, lighter, and uppercase compared to nav items? If they look the same or bigger, fix the typography.
- [ ] Is there any redundancy? No "Schedule" AND "Scheduling." No "Hours" or "Attendance." No "Admin Users" separate from "People." If any exist, remove duplicates.
- [ ] Does every nav item have an icon? Consistent in size and style?
- [ ] Is "Admin Users" page gone? Navigating to its old URL should redirect to People.
- [ ] Is "Payment Details" standalone page gone? Employee payout setup is in My Pay. Finance payout view is in Payroll run detail.
- [ ] Is the Access Control page replaced with the simplified roles view (no checkbox grid)?
- [ ] Click the avatar in the top bar. Is there a colored status dot? Can you change your status (Available, AFK, OOO, etc.)?
- [ ] Open People directory. Do you see status dots next to each person's name?
- [ ] As SUPER_ADMIN, do you see the ADMIN section in the sidebar with Organization, Roles & Access, and Audit Log?
- [ ] As EMPLOYEE, do you see only MY WORK, plus Approvals if you have pending items?
- [ ] Settings page for EMPLOYEE: only Profile, Preferences, Security tabs. No admin tabs.
- [ ] Resize to 375px width. Does the sidebar collapse to a hamburger? Does it work?

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 1 -- sidebar + attendance + nav cleanup"
git push
```

---

# ============================================================
# GROUP 2: GLOBAL DESIGN QUALITY
# ============================================================

**2.1 Replace every black button in the app**

```bash
grep -rn "bg-black\|bg-gray-900\|bg-neutral-900\|bg-slate-900\|bg-zinc-900\|bg-\[#0\|bg-\[#1\|bg-\[#2" app/ components/ --include="*.tsx" | grep -v sidebar | grep -v Sidebar | grep -v dark-mode
```
Replace all. Primary actions = accent green. Secondary = outline. Destructive = red.

**2.2 Compensation Admin page**

Current state: ugly. Native select dropdown, floating cards, heavy black buttons, no visual hierarchy.

Redesign:
- Employee selector: styled searchable combobox with avatar + name + department in each option. Not a native `<select>`.
- Employee card: horizontal layout -- avatar (48px), name (16px/600), role + department (14px/text-secondary), employment type badge (Contractor/Full-time), country flag. One cohesive row.
- Sections (Salary Records, Allowances, Equity Grants): section header row with label left + "Add" outline button right + thin divider below.
- Empty states: EmptyState with icon (DollarSign/Gift/TrendingUp), not black buttons.
- If the employee has records: show them in clean tables with proper formatting.

**2.3 Compliance page**

Current state: misaligned status cards, floating "Local authority guidance" orphan, heavy black buttons.

Redesign:
- Status cards: 4-column grid, EQUAL height, colored left border (4px) + subtle matching bg tint. Label (12px uppercase caption) above, value (28px Geist Mono) below. Red/Amber/Blue/Green for Overdue/This month/Next 30/On track.
- Date filter row: single horizontal flex row, all inputs same height, aligned.
- Local authority guidance: collapsible section or dedicated tab. Not a random floating card.
- Deadline table: the PRIMARY content of the page. Proper DataTable with columns.
- Acknowledgment Tracking: clean section below deadlines with proper heading.

**2.4 Every empty state in the app**

Search for all empty states. Every one must use EmptyState component with icon, heading, body text, and secondary (outline) CTA button. No black buttons. No bare text.

**2.5 Every error state in the app**

Search for all error renders. Every one must use a red-tinted card with human-readable message and actionable suggestion. Wire through `humanizeError()`.

**2.6 Card and spacing consistency across ALL pages**

Walk through every page under `app/(shell)/`. Check:
- Cards have consistent border, radius, shadow, padding
- Spacing between sections is 24px consistently
- Metric card rows are equal height
- Tables use the same header style everywhere
- Page backgrounds use the correct token (--bg-secondary)

**2.7 Dark mode verification**

Toggle dark mode. Walk through major pages. Fix any that break: wrong text colors, invisible elements, contrast issues, hardcoded light-mode colors.

```bash
npm run lint && npm run build
```

**QUALITY GATE 2 (Designer + QA -- this is the most critical gate):**

Run the button audit:
```bash
echo "Remaining black buttons:"
grep -rn "bg-black\|bg-gray-900\|bg-neutral-900\|bg-slate-900" app/ components/ --include="*.tsx" | grep -v sidebar | grep -v Sidebar | grep -v dark | grep -v node_modules
```
Must return ZERO results. If not, fix every remaining one.

Run the native select audit:
```bash
echo "Native selects in UI:"
grep -rn "<select" app/(shell)/ components/ --include="*.tsx" | grep -v node_modules
```
Replace every native `<select>` with a styled combobox/dropdown component.

Run the design spec compliance check on these 5 pages:

**Compensation Admin:**
- [ ] Employee selector is a styled searchable combobox with avatar, not native `<select>`
- [ ] Employee card is a horizontal row: 48px avatar, name 16px/600, role+dept 14px text-secondary, badge, flag
- [ ] Section headers have label left + action button right + divider below
- [ ] Empty states use EmptyState with icon, NOT text + black button
- [ ] All buttons are green (primary) or outline (secondary), ZERO black

**Compliance:**
- [ ] 4 metric cards are EQUAL height (verify they use CSS grid not flex-wrap)
- [ ] Each card has 4px colored left border + subtle bg tint matching status color
- [ ] Label is 12px uppercase text-secondary, value is 28px Geist Mono
- [ ] Date filter row is one horizontal line, all inputs same height, aligned
- [ ] Empty state uses EmptyState component with icon

**People:**
- [ ] "Add person" is a green primary button
- [ ] "Bulk Upload" is a secondary outline button next to it
- [ ] Error state (if triggered) shows red-tinted card with human message
- [ ] Table has proper header styling (12px uppercase text-secondary)

**Dashboard:**
- [ ] Metric cards are equal height, aligned grid
- [ ] Card shadows match spec (subtle, not heavy)
- [ ] Spacing between sections is consistently 24px
- [ ] No bare text floating outside of cards

**Any page with a table:**
- [ ] Header row uses 12px uppercase text-secondary
- [ ] Row hover shows bg-secondary
- [ ] Rows are minimum 48px height
- [ ] Sort indicators are visible on sortable columns

Toggle dark mode. Check the same 5 pages:
- [ ] All text is readable (no dark text on dark bg)
- [ ] Cards use dark elevated bg (not white)
- [ ] Borders and shadows adapt
- [ ] Status badge colors adapt
- [ ] No hardcoded light-mode colors anywhere

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 2 -- design quality overhaul"
git push
```

---

# ============================================================
# GROUP 3: PEOPLE AND ONBOARDING
# ============================================================

**3.1 CSV bulk upload for People**

"Bulk Upload" button next to "Add person". SlidePanel flow:
1. Download CSV template with headers: full_name, email, country_code, department, job_title, employment_type, start_date, manager_email, roles
2. Upload CSV. Preview table with row validation (green=valid, red=error with reason, yellow=warning).
3. "Import [N] employees" creates profiles, auth accounts, sends welcome emails.

**3.2 Auto-generated temporary passwords + welcome email**

Every new employee (single or CSV):
- Auto-generate 16-char password (upper + lower + number + special)
- Create Supabase Auth user
- Set `password_change_required = true` on profile
- Send welcome email via Resend:
  Subject: "Welcome to Accrue, [first name]!"
  Body: their email, temp password, login URL, warm welcome. If new hire: mention onboarding checklist.

**3.3 New hire vs existing employee toggle**

Add Person form: toggle at top "New hire (start onboarding)" / "Existing employee"
- New hire: auto-create onboarding instance from best-matching template (country + department)
- Existing: profile only, no onboarding

**3.4 First-login password change enforcement**

Middleware: if `password_change_required === true`, redirect to `/change-password`. Dedicated full page: current password + new + confirm. Block all other pages until changed.

**3.5 Comprehensive email notifications**

Create email templates. Send at EVERY lifecycle event across ALL modules:

**Expenses:**
- Submitted: email to employee (confirmation) + manager (review needed)
- Manager approves: email to employee + finance team
- Manager rejects: email to employee (with reason)
- Finance disburses: email to employee
- Finance rejects: email to employee (with reason)

**Leave:**
- Requested: email to manager
- Approved: email to employee
- Rejected: email to employee (with reason)
- Cancelled by employee: email to manager

**Onboarding:**
- Instance created: email to new hire + manager
- Task assigned: email to assignee
- Task overdue (3+ days): email to employee + HR
- All tasks complete: email to employee + HR + manager

**Performance:**
- Cycle started: email to all assigned employees
- Self-review due in 3 days: email to employee
- Manager review due in 3 days: email to manager
- Review shared: email to employee
- Review acknowledged: email to manager

**Scheduling:**
- Schedule published: email to all assigned employees
- Shift swap requested: email to target employee
- Swap accepted: email to requester + lead
- Swap confirmed: email to both employees

**Payroll:**
- Run approved: email to finance/admin
- Run completed: email to ALL employees in run ("Payment statement available")

**Documents:**
- Document expiring in 30 days: email to employee
- Document expired: email to employee + HR

**Compliance:**
- Deadline due in 14 days: email to assigned owner
- Deadline overdue: email to owner + HR

For each: include key details + "View in Crew Hub" link. Use a shared email template with Accrue branding.

**3.6 Profile photo upload**

Every employee must be able to upload a profile photo.

- On the employee's own profile page: show current avatar (or initials fallback) at 96px with a camera/edit icon overlay. Clicking opens a file picker (jpg, png, webp, max 5MB).
- After selecting a file: show a simple square crop preview. Confirm to upload.
- Upload to Supabase Storage bucket `avatars/` as `{userId}.{ext}`. Store the URL on the profile record.
- The photo must appear EVERYWHERE the user is referenced:
  - Sidebar collapsed state (small avatar)
  - Top bar avatar dropdown
  - People directory list/grid
  - Employee cards in approvals, scheduling, onboarding
  - Notification items
  - Performance review headers
  - Team Hub page author attribution
  - Compensation admin employee selector
  - Any place that currently shows initials
- When adding a person (single add): allow optional photo upload in the form.
- CSV bulk upload: no photo (employees upload their own after login).
- In the Add Person form and the employee profile page, the photo upload must be a proper upload area (drag-and-drop or click to browse), NOT a text field for a URL.

**3.7 Employee profile page (self-view)**

When an employee views their own profile, they should be able to edit:
- Profile photo (upload)
- Display name
- Phone number
- Emergency contact (name + phone + relationship)
- Bio / about (short text)
- Preferred pronouns (optional)
- Timezone (auto-detected from browser, editable)

They should see but NOT be able to edit:
- Email (set by admin)
- Department
- Job title
- Country
- Employment type
- Manager
- Roles
- Start date
- Compensation (visible in My Pay)

The profile page should be clean, with the photo large at the top, editable fields in a form section below, and read-only info in a separate section. Save button only appears when changes are made.

**3.8 Other details that matter:**

- **Inline department creation**: when adding a person, if the department they type doesn't exist, show a "Create [department name]" option in the dropdown. Creates it on the fly.
- **Country defaults**: selecting a country auto-sets currency and suggests timezone and leave policy.
- **Duplicate detection**: when entering an email in Add Person, check if it already exists. Show a warning before proceeding.
- **Manager search**: the manager field should be a searchable people selector with avatars, not a text field or native dropdown.
- **Role assignment**: multi-select checkboxes for roles on the Add Person form. Default to EMPLOYEE only.

```bash
npm run lint && npm run build
```

**QUALITY GATE 3 (QA + PM):**
- [ ] Go to People > Add person. Is there a "New hire / Existing employee" toggle? Does selecting "New hire" change the form behavior?
- [ ] Go to People > Bulk Upload. Does the SlidePanel open? Can you download a CSV template? Upload a test CSV with 2 valid and 1 invalid row. Does the preview show green/red correctly?
- [ ] Does the department field allow creating a new department inline if the one you type doesn't exist?
- [ ] Check the Resend dashboard (or email logs). When a person is created, is a welcome email sent with temp password?
- [ ] Check: does the profile have `password_change_required = true` after creation?
- [ ] For email notifications: submit an expense, then check: did the employee get a confirmation email? Did the manager get a review-needed email? If not, trace the code path and fix.
- [ ] For leave: request leave, then check: did the manager get an email? Approve it: did the employee get an email?

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 3 -- people, onboarding, emails"
git push
```

---

# ============================================================
# GROUP 4: SCHEDULING SYSTEM
# Replaces the CS team's Notion scheduling entirely.
# ============================================================

**4.1 Data model**

Create all tables in one migration:

```sql
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  template_type VARCHAR(20) NOT NULL CHECK (template_type IN ('weekday','weekend','holiday')),
  slots JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  department_id UUID,
  title VARCHAR(200) NOT NULL,
  schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('weekday','weekend','holiday')),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  template_id UUID REFERENCES shift_templates(id),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(org_id, department_id, schedule_type, month, year)
);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id),
  employee_id UUID NOT NULL REFERENCES profiles(id),
  shift_date DATE NOT NULL,
  slot_name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned','swap_requested','swapped','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedule_day_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id),
  note_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(schedule_id, note_date)
);

CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES shift_assignments(id),
  requester_id UUID NOT NULL REFERENCES profiles(id),
  target_employee_id UUID NOT NULL REFERENCES profiles(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','confirmed')),
  reason TEXT,
  responded_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) DEFAULT 'weekday'
  CHECK (schedule_type IN ('weekday','weekend_primary','weekend_rotation','flexible'));

ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_day_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_requests ENABLE ROW LEVEL SECURITY;
```

**4.2 API routes**

- CRUD for templates, schedules, assignments
- `POST /api/v1/scheduling/schedules/[id]/auto-generate` -- auto-scheduler
- `POST /api/v1/scheduling/schedules/[id]/publish` -- publish + email all
- `GET /api/v1/scheduling/my-shifts` -- employee's shifts
- CRUD for swap requests

**Auto-scheduler** (`lib/scheduling/auto-scheduler.ts`):
- Input: employee list with schedule_type, blocked dates (approved leave + holidays)
- weekend_primary: full Sat+Sun shifts + only 2 weekday slots, 3 weekdays off
- weekday: weekday slots only
- weekend_rotation: distribute weekend hours evenly
- No back-to-back close+open. Balance hours within 10%. Randomize to avoid patterns.
- Returns draft. Confirm to save.

**4.3 Schedule builder UI**

Scheduling page tabs: Schedule | My Shifts | Swap Requests | Templates

**Schedule tab (lead/admin):**
- Top: month picker + type dropdown + "Auto-Generate" + "Publish" buttons
- Grid: rows = dates (grouped by week), columns = time slots from template, cells = draggable employee pills
- Drag-and-drop: pick up a pill, drop in another cell. Warn on conflict but allow override.
- Click empty cell: dropdown to assign employee
- Right column: editable day notes
- Below: hours balance summary per employee

**My Shifts tab (employee):**
- Today hero: current/next shift, countdown
- This Week: day-by-day with shift or "Off"
- This Month: calendar with colored shift dots

**Templates tab:** list of saved templates, create/edit flow

```bash
npm run lint && npm run build
```

**QUALITY GATE 4 (PM + Designer + QA):**
- [ ] Navigate to Scheduling. Are there tabs: Schedule | My Shifts | Swap Requests | Templates?
- [ ] Go to Templates tab. Create a new template with 3 time slots (e.g., 7AM-3PM, 3PM-11PM, 11PM-7AM). Does it save?
- [ ] Go to Schedule tab. Select a month. Click "Auto-Generate" with 5 test employees. Does the grid populate with assignments?
- [ ] Can you drag an employee pill from one cell to another? Does the move persist?
- [ ] Is the grid layout similar to the Notion schedule (dates as rows, time slots as columns, employee pills in cells)?
- [ ] Go to My Shifts tab. As an assigned employee, do you see your upcoming shifts?
- [ ] Does the Schedule grid have a day notes column on the right side?
- [ ] Does "Publish" change the status and would it send notifications?

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 4 -- scheduling system"
git push
```

---

# ============================================================
# GROUP 5: TEAM HUB
# Department-level knowledge base. Replaces ALL Notion team
# workspaces. Every department gets one. Access is scoped.
# ============================================================

**5.1 Data model**

```sql
CREATE TABLE IF NOT EXISTS team_hubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  department_id UUID,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  icon VARCHAR(50),
  visibility VARCHAR(20) DEFAULT 'department'
    CHECK (visibility IN ('department','org_wide','private')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_hub_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID NOT NULL REFERENCES team_hubs(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  cover_image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_hub_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES team_hub_sections(id),
  title VARCHAR(300) NOT NULL,
  content TEXT,
  page_type VARCHAR(20) DEFAULT 'document'
    CHECK (page_type IN ('document','contact_list','reference_list','runbook','table','link')),
  structured_data JSONB,
  cover_image_url TEXT,
  icon VARCHAR(50),
  pinned BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE team_hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_hub_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_hub_pages ENABLE ROW LEVEL SECURITY;
```

**5.2 Access control -- THIS IS CRITICAL**

- `visibility = 'department'`: only employees in that department + HR_ADMIN + SUPER_ADMIN can see it
- `visibility = 'org_wide'`: everyone in the org can see it
- `visibility = 'private'`: only the creator + SUPER_ADMIN
- CS team members CANNOT see Marketing's hub. Marketing CANNOT see CS's hub.
- SUPER_ADMIN can see ALL hubs.
- HR_ADMIN can see all hubs (to help manage content).
- Department leads (TEAM_LEAD/MANAGER of that department) can create/edit content.
- Regular employees in the department can read only.

RLS policies must enforce this. Do not rely on client-side checks.

**5.3 API routes**

- `GET /api/v1/team-hubs` -- list hubs the current user can access
- `POST /api/v1/team-hubs` -- create hub (TEAM_LEAD/MANAGER/HR_ADMIN/SUPER_ADMIN)
- `GET/PUT/DELETE /api/v1/team-hubs/[id]` -- hub CRUD
- `GET/POST /api/v1/team-hubs/[id]/sections` -- sections
- `GET/POST /api/v1/team-hubs/[hubId]/sections/[sectionId]/pages` -- pages
- `GET/PUT/DELETE /api/v1/team-hubs/pages/[pageId]` -- page CRUD

**5.4 UI**

**Hub selector (if user has access to multiple hubs):**
Route: `/team-hub`
- If user belongs to one department: go directly to that hub
- If user is SUPER_ADMIN/HR_ADMIN or in multiple departments: show hub list as cards
- Each card: hub name, department, description, page count

**Hub home page:**
Route: `/team-hub/[hubId]`
- Hub name, description
- Sections as card grid (3 columns desktop, 1 mobile)
- Each section card: icon or cover image + name + page count
- Sections with cover images show them (like Notion's gallery view in the Marketing screenshot)
- Sections without covers show the icon on a subtle colored background

**Section page:**
Route: `/team-hub/[hubId]/[sectionId]`
- Section name, back link
- Two view modes: Gallery (cards with covers, like Marketing's Content & Marketing page) and List (like CS's Internal Help-Docs)
- Toggle between views
- Each page card/row: icon + title + type badge + last updated
- Leads: "Add page" button + reorder

**Page view:**
Route: `/team-hub/[hubId]/[sectionId]/[pageId]`
- Title, author, last updated
- Content rendered by type:
  - `document`/`runbook`: rendered markdown
  - `contact_list`: clean table with search, add/edit for leads
  - `reference_list`: searchable list with tags, add/edit for leads
  - `table`: data table with sort
  - `link`: redirects to an external URL or internal route

**Page editing (leads + admins):**
- Document/runbook: markdown editor with preview
- Contact list/reference list/table: inline editable rows
- All types: title, icon, cover image upload

**5.5 Seed data**

Create hubs for the departments you know exist:

**Customer Success hub:**
```
Sections:
  Internal Help-Docs (icon: BookOpen)
    Pages: Managing Inboxes and Shifts, Handbook For New CS Hires,
    Our KPIs, How To Investigate & Resolve Issues (runbook),
    Communication Channels, Tools and Apps, CX Calls Guide (runbook),
    Guide On Using Metabase, QA/QC Tests, Research
  Help-Docs (icon: FileText) -- empty, for CS to fill
  Reports & Surveys (icon: BarChart3)
    Pages: Monthly/Weekly Check-ins, User Testing Report,
    Customer Retention Reports, Cashramp Agents (reference_list),
    Customer Satisfaction Survey Analysis, App Ratings
  Annex (icon: Archive)
    Pages: Pitches/Idea Dump, Announcements, Video Scripts
  Trusted Cashramp Agents (icon: Shield)
    Page: Agent Directory (reference_list with names from screenshot)
  Work Schedule (icon: Calendar)
    Page: link type pointing to /scheduling
  Support Phone Numbers (icon: Phone)
    Page: Support Contacts (contact_list: Antoinette 0816 152 7390,
    Rayo 07052176801, Raphaela 233266211627, Favour 09022582108,
    Shalewa 0903 989 0140)
```

**Content & Marketing hub:**
```
Sections:
  Content Strategy (icon: Target, cover image)
    Pages: Content Strategy 2025, Content Calendar 2024,
    Content Calendar 2021-2023, Ghana Content Calendar
  Video (icon: Video, cover image)
    Pages: Video editing (multiple entries)
  Projects & Plans (icon: Kanban)
    Pages: Q1 Projects & Timelines, March Marketing Strategy,
    April/May/June Marketing Plans, Ghana Meet & Greet Brief,
    Accrue 7% Interest campaign, July 2025 Marketing & Retention Plan
```

**Engineering hub:** (create empty with placeholder sections)
```
Sections:
  Architecture (icon: Cpu) -- empty
  Runbooks (icon: Terminal) -- empty
  Standards (icon: BookCheck) -- empty
```

**Finance hub:** (create empty with placeholder sections)
```
Sections:
  Processes (icon: Workflow) -- empty
  Templates (icon: FileSpreadsheet) -- empty
```

Document content for seeded pages: "Content migrating from Notion. To be updated by the [department] team."

Structured data (agent names, phone numbers) seeded with real data from screenshots.

**5.6 What else I should have thought about:**

- **Search within Team Hub**: the command palette (Cmd+K) entity search should include team hub pages. When someone searches "KPIs" or "Metabase" they should find the relevant page.
- **Pinned pages**: frequently accessed pages (like Support Phone Numbers) can be pinned to show at the top of the hub home.
- **Recently viewed**: show a "Recently viewed" section at the top of each hub for quick access.
- **Page comments**: employees should be able to leave comments on pages (like Notion). This helps teams discuss content. Simple threaded comments.
- **Version history for pages**: when a page is edited, keep the previous version. Show a "History" button with diff.
- **Notifications for page updates**: when a pinned or bookmarked page is updated, notify subscribers.
- **Mobile access**: Team Hub pages should be readable on mobile. Editing can be desktop-only.
- **Print-friendly**: runbooks and procedures should have a clean print stylesheet.

```bash
npm run lint && npm run build
```

**QUALITY GATE 5 (PM + QA -- access control is critical):**
- [ ] As a CS department employee: navigate to Team Hub. Do you see the Customer Success hub? Can you see any section from Marketing's hub? (Must be NO)
- [ ] As a Marketing department employee: navigate to Team Hub. Do you see Content & Marketing? Can you see CS's Internal Help-Docs? (Must be NO)
- [ ] As SUPER_ADMIN: navigate to Team Hub. Can you see ALL hubs (CS, Marketing, Engineering, Finance)? (Must be YES)
- [ ] Open CS hub. Are the 7 sections showing as cards? Click "Internal Help-Docs". Are the 10 sub-pages listed?
- [ ] Click "Support Phone Numbers". Does it render as a table with names and phone numbers (real data from the seed)?
- [ ] Open Marketing hub. Does it show sections with cover images (gallery view) like the Notion screenshot?
- [ ] As a CS team lead: can you create a new page in Internal Help-Docs? (Must be YES)
- [ ] As a regular CS employee: can you create a new page? (Must be NO, read-only)
- [ ] Does the command palette (Cmd+K) return Team Hub pages when you search for "KPIs" or "Metabase"?

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 5 -- team hub with department scoping"
git push
```

---

# ============================================================
# GROUP 6: SCREEN DESCRIPTIONS
# ============================================================

Find how descriptions are implemented. Update ALL pages:

| Page | Description |
|------|-------------|
| Dashboard | Your personal home in Crew Hub. See what needs attention and jump to your most-used actions. |
| Announcements | Company updates and news since your last visit. |
| Time Off | Request time off, check balances, and track approval status. |
| Attendance | Log work hours, track clock-ins, and review weekly attendance. |
| My Pay | Pay statements, payout setup, and compensation in one view. |
| Documents | Your documents, required records, and expiry reminders. |
| Learning | Courses, certificates, and surveys assigned to you. |
| Approvals | Review and act on pending team requests. |
| People | Find people, review roles, and open full profiles. |
| Scheduling | Build, publish, and manage team shift schedules. |
| Team Hub | Your department's knowledge base: guides, contacts, and resources. |
| Onboarding | Launch onboarding plans, track progress, and resolve blockers. |
| Payroll | Run payroll with staged approvals and clear payout status. |
| Expenses | Submit expenses, upload receipts, and track reimbursement. |
| Compensation | Manage salary, allowances, and equity for team members. |
| Performance | Run review cycles, track completion, and calibrate fairly. |
| Compliance | Statutory filings with due dates, proof, and country tracking. |
| Analytics | Workforce and operations trends with filters and exports. |
| Signatures | Request, sign, and track documents with signer timelines. |
| Settings | Profile, workspace preferences, and admin controls. |

```bash
npm run lint && npm run build
```

**QUALITY GATE 6:**
```bash
echo "Page descriptions found:"
grep -rn 'description' app/(shell)/ --include="*.tsx" | grep -i 'header\|page' | wc -l
```
Must be 20+. If not, find the pages missing descriptions and add them.

Only after check passes:
```bash
git add -A && git commit -m "phase-6: group 6 -- screen descriptions"
git push
```

---

# ============================================================
# GROUP 7: THINGS I SHOULD HAVE THOUGHT ABOUT
# ============================================================

**7.1 Login page polish**

The login page is the first thing every employee sees. It must look exceptional.
- Centered card on a clean background
- Accrue/Crew Hub branding prominent
- Email + password fields with inline validation
- "Forgot password?" link that works
- Loading state on submit button
- Error message below the form (not a toast) for wrong credentials
- If the employee has never logged in, the welcome email tells them to come here

**7.2 Dashboard per role -- make it actually useful**

Think about what each person sees when they log in:

**Employee (CS agent, marketing team member):**
- Greeting with name
- "Your next shift" card if they have one (prominent, shows time + countdown)
- "Pending tasks" if onboarding
- "Time off balance" quick card
- "Recent announcements" (last 3)
- Quick actions: Request time off, Submit expense, View payslip

**Manager / Team Lead (CS lead, Adesuwa):**
- Greeting
- "Needs your attention" section: pending approvals (leave + expense + timesheets) with counts
- "Team today" card: who's working, who's off, who's on leave
- "Onboarding in progress" for direct reports
- "Upcoming compliance deadlines" (if HR_ADMIN)
- Quick actions: View approvals, Open scheduling, Team directory

**Finance (Bolaji):**
- Greeting
- "Payroll status" card: current run status, next run date
- "Expenses awaiting disbursement" with count + total amount
- "Pending approvals" section
- Quick actions: Open payroll, Expense queue

**SUPER_ADMIN (Z):**
- Greeting
- "Organization setup" checklist (if not dismissed)
- "Health alerts" section (missing payout, stale onboarding, overdue compliance, stuck expenses)
- "Needs attention" across all modules
- "Team overview" metrics: headcount by country, department breakdown
- Quick actions: Add person, Run payroll, View analytics

Actually implement these dashboard variations. The current dashboard is too generic.

**7.3 What happens when a department doesn't exist yet?**

When adding a person, if their department doesn't exist, let the user create it inline. A small "Create new department" option in the department dropdown that opens a minimal form (name, optional description) and creates it on the fly.

**7.4 Timezone handling**

Accrue operates across NG (WAT, UTC+1), GH (GMT, UTC+0), KE (EAT, UTC+3), ZA (SAST, UTC+2), CA (multiple). Every time-sensitive display (shift times, clock-in/out, deadlines, "submitted 2 hours ago") must respect the VIEWER's timezone. Store times in UTC, display in local.

**7.5 Keyboard shortcuts**

Beyond Cmd+K, add:
- `g h` = go home (dashboard)
- `g a` = go to approvals
- `g p` = go to people
- `g s` = go to scheduling
- `n` = new (context-sensitive: new expense on expenses page, new leave on time off, etc.)
Show a keyboard shortcut help modal with `?`

**7.6 Onboarding default templates per country**

If no onboarding templates exist for a country, the new-hire toggle won't work well. Seed default onboarding templates:

**Nigeria (NG):**
Tasks: Submit TIN, Provide BVN, PFA enrollment, Sign employment agreement, Read employee handbook, Set up Slack, Meet your manager, Complete first-week checklist

**Ghana (GH):**
Tasks: Submit SSNIT number, Provide Ghana Card, Sign agreement, Read handbook, Set up tools, Meet manager

**Kenya (KE):**
Tasks: NHIF registration, KRA PIN submission, NSSF registration, Sign agreement, Read handbook, Set up tools

**South Africa (ZA):**
Tasks: Submit ID for UIF, Tax reference number, Sign agreement, Read handbook, Set up tools

**Canada (CA):**
Tasks: Submit SIN, Complete TD1, Sign agreement, Read handbook, Set up tools

Each template: onboarding type, linked to country, with reasonable due_days_offset per task.

**7.7 Public holiday calendar**

The system references public holidays for leave calculations and scheduling. Seed the 2026 public holidays for all 5 countries. This should be in the seed data.

**7.8 Audit trail visibility**

HR_ADMIN and SUPER_ADMIN should have an Audit Log page in Settings (or under Admin) showing recent actions: who did what, when, to which entity. This already exists in the DB (audit_logs table). Build a simple paginated view with filters (actor, action type, date range, entity type).

```bash
npm run lint && npm run build
```

**QUALITY GATE 7 (Full team review):**

**Designer:**
- [ ] Open the login page. Is it polished? Centered card, branding, clean fields? Would you be proud to show this to a new hire?
- [ ] Open the dashboard as each role concept (check the persona logic). Does each variant show relevant, role-specific content?

**QA:**
- [ ] Test first-login flow: create a test user with `password_change_required = true`. Log in. Are you redirected to the password change page? Can you access any other page? After changing, are you redirected to dashboard?
- [ ] Press `?` -- does a keyboard shortcut help modal appear?
- [ ] Press `g h` -- does it navigate to dashboard?
- [ ] Check timezone: if an event happened at 14:00 UTC and you're viewing in WAT (UTC+1), does it show 3:00 PM? If it shows 2:00 PM, the timezone handling is wrong.

**PM:**
- [ ] As a brand new employee logging in for the first time with no data: is the experience clear? Do they know what to do? Is the dashboard helpful or empty and confusing?
- [ ] As the CS lead looking at the dashboard: can they immediately see what needs their attention today?
- [ ] As Z (SUPER_ADMIN): does the dashboard surface health issues, pending items, and quick actions for the most common tasks?

**Engineer:**
- [ ] Run `npm run lint` -- 0 errors?
- [ ] Run `npm run build` -- clean?
- [ ] Check for N+1 queries in dashboard API (it aggregates data from many tables -- is it using efficient queries or making 20 sequential calls?)

Only after all checks pass:
```bash
git add -A && git commit -m "phase-6: group 7 -- login, dashboard, timezone, shortcuts, templates, holidays, audit"
git push
```

---

# ============================================================
# GROUP 8: FINAL VERIFICATION
# ============================================================

Run all checks. Fix any failures before pushing.

```bash
echo "=== BUILD ==="
npm run lint 2>&1 | tail -3
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | tail -3

echo "=== FORBIDDEN PATTERNS ==="
echo "black buttons: $(grep -rn 'bg-black\|bg-gray-900\|bg-neutral-900\|bg-slate-900' app/ components/ --include='*.tsx' | grep -v 'sidebar\|Sidebar\|dark' | wc -l)"
echo "Accrue Hub: $(grep -rn 'Accrue Hub' app/ components/ --include='*.ts' --include='*.tsx' | wc -l)"
echo "#1a1a2e: $(grep -rn '1a1a2e' app/ components/ --include='*.ts' --include='*.tsx' | wc -l)"
echo "any types: $(grep -rn ': any' app/ lib/ hooks/ components/ types/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.d.ts' | wc -l)"

echo "=== FEATURES ==="
echo "EmptyState: $(grep -rl 'EmptyState' app/(shell)/ --include='*.tsx' | wc -l)"
echo "humanizeError: $(grep -rl 'humanizeError' app/ --include='*.ts' --include='*.tsx' | wc -l)"
echo "descriptions: $(grep -rn 'description' app/(shell)/ --include='*.tsx' | grep -i 'header\|page' | wc -l)"

echo "=== NEW FEATURES ==="
echo "CSV upload: $(grep -rl 'csv\|CSV\|bulk.*upload' app/(shell)/people/ --include='*.tsx' | wc -l)"
echo "Welcome email: $(grep -rl 'welcome.*email\|Welcome.*Accrue\|temp.*password' lib/ app/api/ --include='*.ts' | wc -l)"
echo "Password change: $(find app/ -path '*change-password*' -name '*.tsx' | wc -l)"
echo "Shift templates: $(grep -rn 'shift_templates' supabase/migrations/ | wc -l)"
echo "Schedules table: $(grep -rn 'CREATE TABLE.*schedules' supabase/migrations/ | wc -l)"
echo "Auto-scheduler: $(find lib/ -name 'auto-scheduler*' | wc -l)"
echo "Team Hub tables: $(grep -rn 'team_hubs\|team_hub_sections\|team_hub_pages' supabase/migrations/ | wc -l)"
echo "Team Hub routes: $(find app/api/ -path '*team-hub*' -name '*.ts' | wc -l)"
echo "Team Hub UI: $(grep -rl 'team-hub\|TeamHub' app/(shell)/ components/ --include='*.tsx' | wc -l)"
echo "Error humanizer: $(find lib/ -name 'errors*' | wc -l)"
echo "Approve leave RPC: $(grep -rn 'approve_leave_request' supabase/migrations/ | wc -l)"
echo "Keyboard shortcuts: $(grep -rl 'useHotkeys\|hotkey\|keyboard.*shortcut' hooks/ lib/ components/ --include='*.ts' --include='*.tsx' | wc -l)"
echo "Audit log UI: $(grep -rl 'audit.*log\|AuditLog' app/(shell)/ --include='*.tsx' | wc -l)"

echo "=== SIDEBAR ==="
echo "Section headers: $(grep -rn 'MY WORK\|TEAM\|FINANCE\|OPERATIONS' components/ app/ --include='*.tsx' | wc -l)"
echo "Team Hub in nav: $(grep -rn 'Team Hub\|team-hub' components/ --include='*.tsx' | grep -i 'nav\|sidebar\|link' | wc -l)"

echo "=== DONE ==="
```

Fix any zeros or issues. Then:

```bash
git add -A && git commit -m "phase-6: group 8 -- final verification fixes"
git push
echo "PHASE 6 COMPLETE"
```
