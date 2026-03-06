Read `docs/brand/crew-hub-brand-guidelines.html` first.

Your task: ensure every page in the app handles three states correctly: loading, empty (no data), and error (API failure). Use the EmptyState and ErrorState components created in Phase 2. Use the StatusChip component for status displays.

RULES:
- Read each file before editing.
- Build after every 3-4 page fixes to catch issues early.
- Empty states use EmptyState (neutral, white card, helpful copy). NEVER red/destructive backgrounds.
- Error states use ErrorState (subtle red tint, sanitized messages, retry button).
- Skeleton loaders must resolve. If data fetch fails, show ErrorState. If data is empty, show EmptyState. If data takes >10 seconds, show ErrorState with retry.
- No em dashes. Crew-first language. Verb-first CTAs.
- Import Lucide icons by name: `import { BookOpen, Users, Bell } from "lucide-react"`

STEP 1: FIND ALL PAGES

```bash
# List every page.tsx in the app
find . -name "page.tsx" -path "*/app/*" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | sort

# Find all current error displays
grep -rn "unavailable\|Unable to load\|is unavailable\|are unavailable\|went wrong\|try again\|Try again\|Retry\|Error:" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -40

# Find all skeleton loaders
grep -rn "Skeleton\|isLoading\|loading" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui" | head -30

# Find remaining red/destructive empty states
grep -rn "bg-red\|bg-destructive\|border-red\|border-destructive" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v "components/ui"
```

STEP 2: FIX EACH PAGE

For each page below, find the component, read it, and ensure it handles empty and error states correctly. The pages already fixed in Phase 3 (Login, Performance, Compensation Bands, People, Notifications) should be verified but not re-done.

Format: PAGE | EMPTY STATE (icon, heading, body) | ERROR STATE (if different from default) | NOTES

ONBOARDING
- Empty: ClipboardList, "No active onboarding plans", "Launch one to guide new crew members through their first weeks."
- Error: default ErrorState
- CTA button at top: "Start onboarding" = cta variant. "New template" = ghost.
- The current red/brown card must be replaced with EmptyState.

HOURS / TIME ATTENDANCE
- Empty: Clock, "Nothing here yet", "Clock-ins will appear once attendance tracking starts."
- Error: default ErrorState
- Remove "Back to dashboard" (should be gone from Phase 4, verify)
- Metric cards at top should still show even when time entries are empty (showing 0 values)

SCHEDULING > MY SHIFTS
- Fix infinite skeleton: add error handling + 10s timeout
- Empty: Calendar, "No shifts scheduled", "Your upcoming shifts will appear here."

SCHEDULING > OPEN SHIFTS
- Fix infinite skeleton
- Empty: CalendarPlus, "No open shifts right now", "Available shifts will show up here."

SCHEDULING > SWAP REQUESTS
- Fix infinite skeleton
- Empty: ArrowLeftRight, "No swap requests", "Requests from the crew will appear here."

SCHEDULING > MANAGE
- Fix infinite skeleton
- Empty: CalendarCog, "No schedules to manage yet", "Create one to get started.", CTA: "Create schedule" (ghost)

SCHEDULING > TEMPLATES
- Fix infinite skeleton
- Empty: LayoutTemplate, "No templates yet", "Create one for common shift patterns.", CTA: "Create template" (ghost)
- Keep the description text above the empty state: "Shift templates are reusable time presets..."

LEARNING ADMIN
- Fix infinite skeleton
- Empty: BookOpen, "No courses created yet", "Build training content for the crew.", CTA: "Create course" (ghost)

LEARNING REPORTS
- Fix infinite skeleton
- Empty: BarChart3, "No learning data yet", "Reports will populate once courses are assigned."

SURVEY ADMIN
- Fix infinite skeleton
- Empty: FileQuestion, "No surveys yet", "Create one to collect feedback from the crew.", CTA: "New survey" (ghost)
- CTA at top: "New survey" = cta variant. "Employee view" = ghost.

LEARNING EMPLOYEE > MY COURSES
- Empty: BookOpen, "No courses assigned yet", "They will appear here when your manager assigns them."

LEARNING EMPLOYEE > CERTIFICATES
- Empty: Award, "No certificates earned yet", "Complete courses to earn them."

LEARNING EMPLOYEE > SURVEYS (employee view, not admin)
- Empty: FileQuestion, "No surveys available", "Assigned surveys will show up here."

DOCUMENTS (admin)
- Error: ErrorState (currently shows "Documents are unavailable")
- Empty: FileText, "No documents uploaded yet", "Upload documents to share policies and records with the crew."
- CTA at top: "Upload document" = cta variant.

MY DOCUMENTS (employee)
- Error: ErrorState (currently shows "My documents are unavailable")
- Empty: FileText, "No documents yet", "Your documents will appear here once they are uploaded."
- CTA at top: "Upload document" = cta variant. "Request travel letter" = ghost.

SIGNATURES
- Error: ErrorState (currently shows "Signatures are unavailable")
- Empty: PenLine, "No signature requests", "Signature requests will appear here."
- CTA at top: "New signature request" = cta variant.

COMPENSATION ADMIN
- After selecting an employee with no data: DollarSign, "No compensation data for this crew member", "Set up their salary, allowances, and equity in the compensation admin."
- Replace native employee <select> (should be done in Phase 4, verify)

PAY > PAYSLIPS (empty state)
- Empty: Receipt, "No payslips yet", "They will appear here after your next pay period."
- Remove "Open dashboard" (should be gone from Phase 4, verify)

PAY > PAYMENT DETAILS (empty banner)
- Empty banner: CreditCard icon or no icon, "No payment details on file", "Add your payout destination below."
- Remove "Go to dashboard" (should be gone from Phase 4, verify)
- CTA: "Save payment details" = cta variant.

PAY > COMPENSATION (employee view)
- Replace all 4 sections (Salary, Allowances, Equity, Timeline) each showing "Open dashboard" with ONE combined empty state: DollarSign, "No compensation details yet", "Your salary, allowances, and equity details will appear here once ops sets them up."
- Remove all "Open dashboard" buttons (should be gone from Phase 4, verify)

MY ONBOARDING
- Empty: ClipboardCheck, "No onboarding assigned", "Your checklist will appear here once your manager assigns it."
- Remove "Open dashboard" (should be gone from Phase 4, verify)

TIME OFF > CALENDAR TAB
- This shows an API error ("Unable to load AFK logs for calendar view"). Replace with ErrorState. The error text should NOT say "AFK logs" (technical jargon). ErrorState's sanitization should catch this, but verify the default message is shown.

APPROVALS > TIMESHEETS TAB (empty)
- Empty: Clock, "No submitted timesheets", "Submitted timesheets from the crew will appear here for review."
- "Open attendance" button: change to ghost variant or remove

COMPLIANCE > ACKNOWLEDGMENTS
- Error: ErrorState. Currently shows "Acknowledgments unavailable / Unable to load policies." Fix the copy in ErrorState or in the page: "Couldn't load policy acknowledgments."

SETTINGS > TIME POLICIES
- Empty: Clock, "No time policies configured", "Create a time policy to enforce breaks and overtime rules.", CTA: "Create time policy" (ghost)
- Remove "Open Hours" button (should be gone from Phase 4, verify)

STEP 3: FIX INFINITE SKELETON PATTERN

For every page that has skeleton loaders (especially Scheduling tabs, Learning Admin, Learning Reports, Survey Admin):

Find the data-fetching logic. Add this pattern if it does not exist:

```tsx
// Add timeout state
const [timedOut, setTimedOut] = useState(false);

useEffect(() => {
  const timer = setTimeout(() => {
    if (isLoading) setTimedOut(true);
  }, 10000); // 10 seconds
  return () => clearTimeout(timer);
}, [isLoading]);

// In the render:
if (isLoading && !timedOut) {
  return <SkeletonLoader />; // keep existing skeleton
}
if (error || timedOut) {
  return (
    <ErrorState
      heading={timedOut ? "Taking too long" : undefined}
      body={timedOut ? "This is taking longer than expected. Try refreshing." : undefined}
      error={error}
      onRetry={() => {
        setTimedOut(false);
        refetch(); // or however the page refetches
      }}
    />
  );
}
if (!data || data.length === 0) {
  return <EmptyState ... />;
}
```

Also check: does the catch/error handler in the data fetch set `isLoading` to false? If not, the skeleton runs forever because the error state never triggers. Fix this.

STEP 4: VERIFY

```bash
echo "=== EmptyState usage (expect 20+) ==="
grep -rn "EmptyState" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui" | wc -l

echo "=== ErrorState usage (expect 8+) ==="
grep -rn "ErrorState" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui" | wc -l

echo "=== Red/destructive bg in pages (expect 0) ==="
grep -rn "bg-red\|bg-destructive" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui\|error-state\|ErrorState" | wc -l

echo "=== "Back to dashboard" remnants (expect 0) ==="
grep -rn "Back to dashboard\|Open dashboard\|Go to dashboard\|Open Hours" --include="*.tsx" . | grep -v node_modules | wc -l

echo "=== "unavailable" in raw strings (should only be in ErrorState defaults) ==="
grep -rn "unavailable" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v "components/ui" | wc -l

echo "=== Build ==="
npm run build 2>&1 | tail -5
```
