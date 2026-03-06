Read `docs/brand/crew-hub-brand-guidelines.html` first.

Your task: ensure every button on every page uses the correct brand variant. One CTA (Orange) per page max. Primary (Black) for section actions. Ghost for everything else.

RULES:
- ONE `variant="cta"` per page file. If a page has two orange buttons, the less important one becomes `variant="default"` (Black) or `variant="ghost"`.
- Every button label starts with a verb: "Create", "Save", "Approve", "Export", "Upload", "Send", "Request", "Download", etc.
- Labels like "New survey" are acceptable (implies "Create new survey") but prefer explicit verbs when possible.
- Build after every 5 page changes.

STEP 1: FIND EVERY BUTTON

```bash
# All button usages outside of UI components
grep -rn "Button\|button\|variant=" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -80

# Remaining hardcoded orange/amber/green
grep -rn "bg-orange\|bg-amber\|bg-green\|bg-emerald\|#22C55E\|#F59E0B\|amber-500\|orange-500\|green-500\|emerald-500" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui"

# All pages
find . -name "page.tsx" -path "*/app/*" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | sort
```

STEP 2: PAGE-BY-PAGE BUTTON ASSIGNMENT

Go through each page. Read the file. Fix every button variant.

LOGIN:
- "Sign in" -> cta (done in Phase 3, verify)

DASHBOARD:
- "View all" links -> ghost or plain links (no CTA on dashboard, the dashboard is informational)
- Organization Setup checklist items: not buttons, keep as-is
- Any "View all >" links: ghost or text link style

ANNOUNCEMENTS:
- "Post announcement" or "New announcement" -> cta
- Read status links: ghost

TIME OFF:
- "Request time off" -> cta
- "Log AFK" -> ghost
- "View availability" -> ghost
- Calendar navigation (Previous/Next): ghost

TIME OFF APPROVALS (within Approvals page):
- "Approve" -> default (Black)
- "Decline" or "Reject" -> ghost with destructive text on hover

EXPENSES:
- "Submit expense" -> cta
- "Reports" -> ghost

EXPENSE REPORTS:
- "Export CSV" -> ghost (supporting action)
- Filter dropdowns are selects, not buttons

EXPENSE APPROVALS:
- "Clear filters" -> ghost
- Approve/reject on individual rows: default/ghost

DOCUMENTS (admin):
- "Upload document" -> cta

MY DOCUMENTS (employee):
- "Upload document" -> cta
- "Request travel letter" -> ghost

SIGNATURES:
- "New signature request" -> cta

LEARNING EMPLOYEE:
- No action buttons (empty states only)

LEARNING ADMIN:
- "Create course" -> cta (if it exists as a top-level button)

SURVEY ADMIN:
- "New survey" -> cta
- "Employee view" -> ghost

NEW SURVEY FORM:
- "Create survey" -> cta
- "Survey admin" (back link) -> ghost with ChevronLeft
- "Add rating" / "Add text" / "Add select" / "Add likert" -> ghost
- "Remove" on questions -> ghost with destructive hover

PEOPLE:
- "Add person" -> cta (done in Phase 3, verify)
- "Bulk Upload" -> ghost

ONBOARDING:
- "Start onboarding" -> cta
- "New template" -> ghost

SCHEDULING (all tabs):
- If "Create schedule" or "Create shift" exists -> cta
- Other actions -> ghost

HOURS / ATTENDANCE:
- If "Clock in" exists -> cta
- Others -> ghost

APPROVALS (main page):
- Tab has counts, no CTA. Approve/Decline on rows: default/ghost

PERFORMANCE:
- When working: "Create review cycle" -> cta (admin). No CTA on employee view.

PERFORMANCE ADMIN:
- "Create review cycle" -> cta
- "Back to performance" -> ghost

PAYROLL:
- "Create payroll run" -> cta
- "Withholding settings" -> ghost

PAYROLL NEW RUN:
- "Create payroll run" -> cta

PAYROLL SETTINGS:
- No obvious CTA (configuration page). If "Save" exists -> default.

COMPENSATION ADMIN:
- "Open profile tab" -> ghost
- No CTA (selection page)

COMPENSATION BANDS:
- "New band" -> cta (done in Phase 3, verify)
- "Add benchmark" -> ghost
- "Assign employee" -> ghost
- Section-level "Create band" / "Add benchmark" / "Assign employee" -> default

ANALYTICS:
- "Export CSV" buttons -> ghost
- Time range toggles: the active one gets a filled bg. Use subtle styling (bg-muted or bg-crew-orange/10), NOT the full CTA orange. These are filter controls, not action buttons.

COMPLIANCE:
- "Generate 2026 deadlines" -> cta
- "Apply" -> default (Black)
- "Refresh" -> ghost
- "Clear filters" -> ghost
- Table/Calendar toggle: active state uses subtle bg, not CTA

SETTINGS:
- "Save profile" -> cta (on Profile tab)
- "Save" on other tabs -> cta for that tab
- Tab navigation: not buttons (tabs)

PAY > PAYMENT DETAILS:
- "Save payment details" -> cta

PAY > PAYSLIPS:
- No CTA (informational)

PAY > COMPENSATION:
- No CTA (read-only for employee)

MY ONBOARDING:
- No CTA (read-only for employee)

ROLES & ACCESS:
- No CTA (informational/config display)

STEP 3: VERIFY ONE CTA PER PAGE

```bash
# Count CTA variant per file
echo "=== CTA count per file (all should be 0 or 1) ==="
grep -rn 'variant.*["\x27]cta["\x27]\|variant={.*cta.*}' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20

echo "=== Any file with 2+ CTAs (expect 0 lines) ==="
grep -rn 'variant.*["\x27]cta["\x27]\|variant={.*cta.*}' --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | awk -F: '{print $1}' | sort | uniq -c | awk '$1 > 1'

echo "=== Leftover hardcoded orange/green button classes (expect 0) ==="
grep -rn "bg-orange-\|bg-amber-\|bg-green-\|bg-emerald-" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui\|chart\|Chart\|recharts" | wc -l

echo "=== Build ==="
npm run build 2>&1 | tail -5
```

The "CTA count per file" check must show no file with count > 1. The hardcoded colour class check must be 0 (excluding chart/data visualization colours).
